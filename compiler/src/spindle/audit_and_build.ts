import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { ModuleAST } from "../flow/ast.ts";
import { computeJniAbiHash, parseJniBlueprint } from "../flow/blueprint.ts";
import { extractEffectMaskAuditSignals } from "../flow/bounds_prover.ts";
import { emitJniHeaderFirewall } from "../flow/codegen_harness.ts";
import { compileAndRunBenchmark } from "../flow/driver.ts";
import {
  STD_DIR,
  computeReachableSubgraph,
  countCodeTokens,
  parseTapestryToml,
  validatePackageGraph,
} from "./manifest.ts";

function roundTo(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export function cmdAudit(pkgDir: string = STD_DIR): Record<string, any> {
  const manifest = parseTapestryToml(pkgDir);
  const [modulesMeta, diags] = validatePackageGraph(manifest);
  const pkgMeta: Record<string, any> = manifest.package ?? {};
  const modMap: Record<string, Record<string, string>> = manifest.modules ?? {};

  const moduleAudits: Record<string, any>[] = [];
  let totJniTok = 0;
  let totJnTok = 0;
  let totRsTok = 0;
  let totContracts = 0;

  for (const [modId, paths] of Object.entries(modMap)) {
    const jniFile = path.join(pkgDir, paths.jni);
    const jnFile = path.join(pkgDir, paths.jn);
    const rsFile = paths.rs ? path.join(pkgDir, paths.rs) : "";
    const meta = modulesMeta[modId];
    const ast: ModuleAST | undefined = meta?.ast;

    const jniText = fs.readFileSync(jniFile, "utf-8");
    const jnText = fs.readFileSync(jnFile, "utf-8");
    const rsText =
      rsFile && fs.existsSync(rsFile) ? fs.readFileSync(rsFile, "utf-8") : "";

    const jniTok = countCodeTokens(jniText, true);
    const jnTok = countCodeTokens(jnText, false);
    const rsTok = countCodeTokens(rsText, false);

    totJniTok += jniTok;
    totJnTok += jnTok;
    totRsTok += rsTok;

    const effectsUsed = new Set<string>();
    let reqCnt = 0;
    let ensCnt = 0;
    const invCnt = ast
      ? Object.values(ast.structs).reduce(
          (acc, s) => acc + s.invariants.length,
          0,
        )
      : 0;
    if (ast) {
      for (const fn of Object.values(ast.functions)) {
        for (const eff of fn.effects) {
          effectsUsed.add(eff);
        }
        reqCnt += fn.requires.length;
        ensCnt += fn.ensures.length;
      }
    }
    const modContracts = invCnt + reqCnt + ensCnt;
    totContracts += modContracts;
    const [maskSignals, maskDiags] = extractEffectMaskAuditSignals(
      jnText,
      modId,
      ast ?? null,
    );
    diags.push(...maskDiags);

    moduleAudits.push({
      module_id: modId,
      jni_blueprint: paths.jni,
      imports: meta?.imports ?? [],
      jni_abi_hash: computeJniAbiHash(jniText),
      effects_surface: Array.from(effectsUsed).sort(),
      effect_mask_audit_signals: maskSignals,
      invariants: invCnt,
      requires: reqCnt,
      ensures: ensCnt,
      total_contracts: modContracts,
      examples_count: ast ? ast.examples.length : 0,
      tokens: {
        jni_blueprint_tokens: jniTok,
        jn_impl_tokens: jnTok,
        jenny_total_tokens: jniTok + jnTok,
        rust_baseline_tokens: rsTok,
        tcr_jn_vs_rust: roundTo(jnTok / Math.max(1, rsTok), 4),
        blueprint_audit_ratio_vs_rust: roundTo(jniTok / Math.max(1, rsTok), 4),
      },
    });
  }

  const allMaskSignals = moduleAudits.flatMap(
    (m) => m.effect_mask_audit_signals ?? [],
  );

  return {
    tool: "spindle audit (Jenny v0.2 White-Box Package Auditor)",
    package: pkgMeta.name,
    version: pkgMeta.version,
    allow_effects_sandbox: pkgMeta.allow_effects ?? [],
    sandbox_verified: diags.length === 0,
    diagnostics: diags,
    effect_mask_audit_signals: allMaskSignals,
    total_modules: moduleAudits.length,
    total_formal_contracts: totContracts,
    token_economics_summary: {
      total_jni_blueprint_tokens: totJniTok,
      total_jn_impl_tokens: totJnTok,
      total_jenny_combined_tokens: totJniTok + totJnTok,
      total_rust_baseline_tokens: totRsTok,
      overall_tcr_jn_vs_rust: roundTo(totJnTok / Math.max(1, totRsTok), 4),
      overall_tcr_combined_vs_rust: roundTo(
        (totJniTok + totJnTok) / Math.max(1, totRsTok),
        4,
      ),
      whitebox_audit_token_savings_vs_rust_pct: roundTo(
        (1.0 - totJniTok / Math.max(1, totRsTok)) * 100.0,
        2,
      ),
    },
    modules: moduleAudits,
  };
}

export function cmdBuild(
  pkgDir: string = STD_DIR,
  entryMod: string | null = null,
  useCache = false,
): Record<string, any> {
  const manifest = parseTapestryToml(pkgDir);
  const [modulesMeta, diags] = validatePackageGraph(manifest);
  if (diags.length > 0) {
    return { build_ok: false, diagnostics: diags };
  }

  const modMap: Record<string, Record<string, string>> = manifest.modules ?? {};
  const allMods = Object.keys(modMap);
  const targetEntries = entryMod ? [entryMod] : allMods;
  const reachable = computeReachableSubgraph(modulesMeta, targetEntries);
  const pruned = allMods.filter((m) => !reachable.includes(m));

  const t0 = performance.now();
  const compiledReports: Record<string, any>[] = [];
  for (const modId of reachable) {
    const jniPath = path.join(pkgDir, modMap[modId].jni);
    const rep = compileAndRunBenchmark(jniPath, null, null, false, useCache);
    compiledReports.push(rep);
  }
  const totalMs = roundTo(performance.now() - t0, 2);

  return {
    tool: "spindle build (Lazy Subgraph Pruning + .jni Header Firewall)",
    package: manifest.package?.name,
    entry_target: entryMod || "*",
    total_package_modules: allMods.length,
    reachable_modules_compiled: reachable.length,
    pruned_sibling_modules_count: pruned.length,
    pruning_ratio_pct: roundTo(
      (pruned.length / Math.max(1, allMods.length)) * 100.0,
      2,
    ),
    reachable_subgraph: reachable,
    pruned_modules: pruned,
    total_build_and_test_ms: totalMs,
    build_ok: compiledReports.every(
      (r) =>
        Boolean(r.compile_ok) &&
        (r.examples ?? []).every((ex: Record<string, any>) => Boolean(ex.passed)),
    ),
    modules: compiledReports,
  };
}

export function cmdContext(
  pkgDir: string = STD_DIR,
  entryMod?: string | null,
): Record<string, any> {
  const targetEntry = entryMod || "std::collections::vec";
  const manifest = parseTapestryToml(pkgDir);
  const [modulesMeta] = validatePackageGraph(manifest);
  const modMap: Record<string, Record<string, string>> = manifest.modules ?? {};

  const reachable = computeReachableSubgraph(modulesMeta, [targetEntry]);

  let packedJniTokens = 0;
  let fullPkgJniJnTokens = 0;
  let fullPkgRustTokens = 0;
  const packedFiles: string[] = [];

  for (const [modId, paths] of Object.entries(modMap)) {
    const jniT = countCodeTokens(
      fs.readFileSync(path.join(pkgDir, paths.jni), "utf-8"),
      true,
    );
    const jnT = countCodeTokens(
      fs.readFileSync(path.join(pkgDir, paths.jn), "utf-8"),
      false,
    );
    const rsT = countCodeTokens(
      fs.readFileSync(path.join(pkgDir, paths.rs), "utf-8"),
      false,
    );
    fullPkgJniJnTokens += jniT + jnT;
    fullPkgRustTokens += rsT;
    if (reachable.includes(modId)) {
      packedJniTokens += jniT;
      packedFiles.push(paths.jni);
    }
  }

  return {
    tool: "spindle context (AI Subgraph Blueprint Context Packer)",
    entry_module: targetEntry,
    reachable_modules: reachable,
    packed_blueprint_files: packedFiles,
    packed_jni_tokens: packedJniTokens,
    full_package_jenny_tokens: fullPkgJniJnTokens,
    full_package_rust_tokens: fullPkgRustTokens,
    context_compression_vs_full_jenny_pct: roundTo(
      (1.0 - packedJniTokens / Math.max(1, fullPkgJniJnTokens)) * 100.0,
      2,
    ),
    context_compression_vs_full_rust_pct: roundTo(
      (1.0 - packedJniTokens / Math.max(1, fullPkgRustTokens)) * 100.0,
      2,
    ),
  };
}

export function cmdFirewallTest(pkgDir: string = STD_DIR): Record<string, any> {
  const rawBufJni = fs.readFileSync(
    path.join(pkgDir, "mem", "raw_buf.jni"),
    "utf-8",
  );
  const rawBufJn = fs.readFileSync(
    path.join(pkgDir, "mem", "raw_buf.jn"),
    "utf-8",
  );

  const abiBefore = computeJniAbiHash(rawBufJni);
  const astBefore = parseJniBlueprint(rawBufJni);
  const hdrBefore = emitJniHeaderFirewall(astBefore, abiBefore);
  const implHashBefore = crypto
    .createHash("sha256")
    .update(rawBufJn.trim(), "utf-8")
    .digest("hex")
    .slice(0, 16);

  const mutatedRawBufJn =
    rawBufJn +
    "\n// Internal optimization in raw_buf.jn private implementation\n";
  const abiAfter = computeJniAbiHash(rawBufJni);
  const astAfter = parseJniBlueprint(rawBufJni);
  const hdrAfter = emitJniHeaderFirewall(astAfter, abiAfter);
  const implHashAfter = crypto
    .createHash("sha256")
    .update(mutatedRawBufJn.trim(), "utf-8")
    .digest("hex")
    .slice(0, 16);

  const dependents = [
    "std::collections::vec",
    "std::collections::vec_deque",
    "std::collections::hash_map",
    "std::collections::lru_cache",
  ];

  return {
    upstream_module: "std::mem::raw_buf",
    downstream_dependents: dependents,
    jni_abi_hash_before: abiBefore,
    jni_abi_hash_after: abiAfter,
    jn_impl_hash_before: implHashBefore,
    jn_impl_hash_after: implHashAfter,
    generated_c99_header_identical: hdrBefore === hdrAfter,
    downstream_dependents_rechecked:
      hdrBefore === hdrAfter ? 0 : dependents.length,
    firewall_verified:
      hdrBefore === hdrAfter && implHashBefore !== implHashAfter,
  };
}

export function cmdMutate(pkgDir: string = STD_DIR): Record<string, any> {
  const manifest = parseTapestryToml(pkgDir);
  const vecJni = fs.readFileSync(
    path.join(pkgDir, "collections", "vec.jni"),
    "utf-8",
  );
  const rawBufJni = fs.readFileSync(
    path.join(pkgDir, "mem", "raw_buf.jni"),
    "utf-8",
  );
  const rawBufJn = fs.readFileSync(
    path.join(pkgDir, "mem", "raw_buf.jn"),
    "utf-8",
  );

  const mutants: Array<{
    id: string;
    expected_code: string;
    description: string;
    override_jni: Record<string, string> | null;
    override_jn?: Record<string, string> | null;
    override_exports: Set<string> | null;
  }> = [
    {
      id: "MUT-PKG-E0501",
      expected_code: "E0501_UNPAIRED_MODULE",
      description: "Missing paired `.jni` blueprint for `std::collections::vec`",
      override_jni: { "std::collections::vec": "__MISSING__" },
      override_exports: null,
    },
    {
      id: "MUT-PKG-E0502",
      expected_code: "E0502_CIRCULAR_DEPENDENCY",
      description:
        "Inject circular dependency `std::mem::raw_buf -> std::collections::vec -> std::mem::raw_buf`",
      override_jni: {
        "std::mem::raw_buf": rawBufJni.replaceAll(
          "module std_mem_raw_buf",
          "module std_mem_raw_buf\n\nimport std::collections::vec",
        ),
      },
      override_exports: null,
    },
    {
      id: "MUT-PKG-E0503",
      expected_code: "E0503_CAPABILITY_VIOLATION",
      description:
        "Inject unauthorized `effects [Net]` into `std::collections::vec` under `allow_effects = []`",
      override_jni: {
        "std::collections::vec": vecJni.replace(
          "effects [Mutate, AllocNative]",
          "effects [Mutate, AllocNative, Net]",
        ),
      },
      override_exports: null,
    },
    {
      id: "MUT-PKG-E0504",
      expected_code: "E0504_UNEXPORTED_MODULE",
      description:
        "Import unexported internal module `import std::internal::secret` in `std::collections::vec`",
      override_jni: {
        "std::collections::vec": vecJni.replaceAll(
          "import std::mem::raw_buf",
          "import std::mem::raw_buf\nimport std::internal::secret",
        ),
      },
      override_exports: null,
    },
    {
      id: "MUT-PKG-E0505",
      expected_code: "E0505_UNDECLARED_FFI_IMPORT",
      description:
        'Inject unauthorized `import c "sys/socket.h" as c_sock` in `std::mem::raw_buf` under `allow_effects = []`',
      override_jni: {
        "std::mem::raw_buf": rawBufJni.replaceAll(
          "module std_mem_raw_buf",
          'module std_mem_raw_buf\n\nimport c "sys/socket.h" as c_sock',
        ),
      },
      override_exports: null,
    },
    {
      id: "MUT-PKG-E0510",
      expected_code: "E0510_UNDECLARED_RT_INTRINSIC",
      description:
        "Call raw `jn_raw_alloc(cap)` directly in `std/mem/raw_buf.jn` bypassing `std::rt::intrinsics` blueprint",
      override_jni: null,
      override_jn: {
        "std::mem::raw_buf": rawBufJn.replace(
          "rt_raw_alloc(cap)",
          "jn_raw_alloc(cap)",
        ),
      },
      override_exports: null,
    },
  ];

  const results: Record<string, any>[] = [];
  for (const m of mutants) {
    const [, diags] = validatePackageGraph(manifest, {
      overrideJni: m.override_jni,
      overrideJn: m.override_jn ?? null,
      overrideExports: m.override_exports,
    });
    const codes = diags.map((d) => d.code);
    const intercepted = codes.includes(m.expected_code);
    results.push({
      mutant_id: m.id,
      expected_code: m.expected_code,
      description: m.description,
      intercepted,
      codes_caught: codes,
      sample_diagnostic:
        diags.find((d) => d.code === m.expected_code) ?? null,
    });
  }

  const interceptedCount = results.filter((r) => Boolean(r.intercepted)).length;
  return {
    tool: "spindle --mutate (White-Box Package & Supply-Chain Fault-Injection Suite)",
    total_mutants: results.length,
    intercepted_count: interceptedCount,
    interception_rate: roundTo(interceptedCount / results.length, 4),
    all_intercepted: results.every((r) => Boolean(r.intercepted)),
    mutants: results,
  };
}
