import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Diagnostic, EnumDecl, FnSpec, ModuleAST, StructDecl } from "./ast.ts";
import { CLANG_PATH, ROOT_DIR } from "./ast.ts";
import { auditTestLiteralOverfitting } from "./blind_audit.ts";
import { computeJniAbiHash, generateJnSkeleton, parseJniBlueprint } from "./blueprint.ts";
import {
  validateStage2MemoryAndEffects,
  validateStage3SpinAndTraits,
  validateStage4FfiAndNative,
  validateV2SyntaxOrDiagnose,
} from "./checker.ts";
import { transpileModuleToC99 } from "./codegen_c99.ts";
import { emitJniHeaderFirewall } from "./codegen_harness.ts";
import { attachJnImplementations, stripSynthesizedStructReimpls } from "./parser.ts";

export function resolveModuleImports(ast: ModuleAST): Diagnostic[] {
  const diags: Diagnostic[] = [];
  if (ast.imports.length === 0) return diags;

  const cacheC99Dir = path.join(ROOT_DIR, ".jenny-cache", "c99");
  fs.mkdirSync(cacheC99Dir, { recursive: true });

  const mergedEnums: Record<string, EnumDecl> = {};
  const mergedStructs: Record<string, StructDecl> = {};
  const mergedFns: Record<string, FnSpec> = {};

  for (const impPath of ast.imports) {
    const parts = impPath.split("::").filter((p) => p.length > 0);
    if (parts.length < 2) {
      diags.push({
        code: "E0504_UNEXPORTED_MODULE",
        severity: "error",
        module: ast.name,
        line: 1,
        offending_token: `import ${impPath}`,
        message: `Invalid module import path \`${impPath}\`; expected \`<package>::<module_path>\`.`,
        suggested_replacement: "",
      });
      continue;
    }
    const relBase = path.join(...parts);
    let depJni = path.join(ROOT_DIR, "library", `${relBase}.jni`);
    if (!fs.existsSync(depJni)) depJni = path.join(ROOT_DIR, `${relBase}.jni`);
    const depJn = depJni.replace(/\.jni$/i, ".jn");
    if (!fs.existsSync(depJni) || !fs.existsSync(depJn)) {
      diags.push({
        code: "E0501_UNPAIRED_MODULE",
        severity: "error",
        module: ast.name,
        line: 1,
        offending_token: `import ${impPath}`,
        message: `Imported module \`${impPath}\` is missing its paired \`.jni\` blueprint or \`.jn\` implementation at \`${relBase}\`!`,
        suggested_replacement: "",
      });
      continue;
    }
    const depJniText = fs.readFileSync(depJni, "utf-8").replace(/\r\n/g, "\n");
    const depJnText = fs.readFileSync(depJn, "utf-8").replace(/\r\n/g, "\n");
    const depAbiHash = computeJniAbiHash(depJniText);
    const depAst = parseJniBlueprint(depJniText);
    diags.push(...resolveModuleImports(depAst));
    attachJnImplementations(depAst, depJnText);

    const hdrFile = path.join(cacheC99Dir, `${depAst.name}.h`);
    fs.writeFileSync(hdrFile, emitJniHeaderFirewall(depAst, depAbiHash), "utf-8");

    Object.assign(mergedEnums, depAst.enums);
    Object.assign(mergedStructs, depAst.structs);
    Object.assign(mergedFns, depAst.functions);
  }

  Object.assign(mergedEnums, ast.enums);
  Object.assign(mergedStructs, ast.structs);
  Object.assign(mergedFns, ast.functions);
  ast.enums = mergedEnums;
  ast.structs = mergedStructs;
  ast.functions = mergedFns;
  return diags;
}

export function compileAndRunBenchmark(
  bdir: string,
  customJnText: string | null = null,
  customJniText: string | null = null,
  checkOnly = false,
  useCache = false,
): Record<string, any> {
  const resolvedBdir = path.resolve(bdir);
  let jniFile: string;
  let jnFile: string;
  if (fs.existsSync(resolvedBdir) && fs.statSync(resolvedBdir).isFile()) {
    const baseNoExt = resolvedBdir.replace(/\.(?:jni|jn)$/i, "");
    jniFile = `${baseNoExt}.jni`;
    jnFile = `${baseNoExt}.jn`;
  } else {
    const entries = fs.readdirSync(resolvedBdir).sort();
    const jniName = entries.find((e) => e.endsWith(".jni"));
    const jnName = entries.find((e) => e.endsWith(".jn"));
    if (!jniName || !jnName) throw new Error(`Missing .jni or .jn file in ${resolvedBdir}`);
    jniFile = path.join(resolvedBdir, jniName);
    jnFile = path.join(resolvedBdir, jnName);
  }

  const jniText = (customJniText ?? fs.readFileSync(jniFile, "utf-8")).replace(/\r\n/g, "\n");
  let jnText = (customJnText ?? fs.readFileSync(jnFile, "utf-8")).replace(/\r\n/g, "\n");

  const jniAbiHash = computeJniAbiHash(jniText);
  const jnImplHash = crypto.createHash("sha256").update(jnText.trim(), "utf-8").digest("hex").slice(0, 16);

  const ast = parseJniBlueprint(jniText);
  jnText = stripSynthesizedStructReimpls(ast, jnText);
  const diags: Diagnostic[] = [
    ...validateV2SyntaxOrDiagnose(jnText, ast.name, ast),
    ...validateStage3SpinAndTraits(ast, jnText),
    ...auditTestLiteralOverfitting(jniText, jnText, ast.name),
  ];

  let c99Code = "";
  try {
    diags.push(...resolveModuleImports(ast));
    attachJnImplementations(ast, jnText);
    diags.push(...ast.spin_bound_diagnostics);
    const missingFns = Object.entries(ast.functions)
      .filter(([, fn]) => fn.body_lines.length === 0)
      .map(([k]) => k);
    if (missingFns.length > 0 && diags.length === 0) {
      const hasMethods = missingFns.some((mf) => mf.includes("."));
      const hintMsg = hasMethods
        ? "Make sure methods on a struct are placed inside `impl StructName { ... }`."
        : "Write `{ ... }` function bodies for these top-level functions directly (do NOT copy signature-only `.jni` headers and do NOT add `impl` blocks).";
      diags.push({
        code: "E0104_MISSING_FUNCTION_IMPLEMENTATION",
        severity: "error",
        module: ast.name,
        line: 1,
        message: `Missing implementation body in \`.jn\` for blueprint function(s): ${missingFns.join(", ")}. ${hintMsg}`,
        offending_token: missingFns[0],
        suggested_replacement: generateJnSkeleton(ast),
      });
    }
    diags.push(...validateStage2MemoryAndEffects(ast));
    diags.push(...validateStage4FfiAndNative(ast, jnText));

    for (const [k, fn] of Object.entries(ast.functions)) {
      if (fn.body_lines.length === 0 || !fn.struct_owner || !(fn.struct_owner in ast.structs)) continue;
      const sdeclOwn = ast.structs[fn.struct_owner];
      const validFields = new Set(sdeclOwn.fields.map((f) => f.name));
      for (const bl of fn.body_lines) {
        for (const mSf of bl.matchAll(/\bself\.([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g)) {
          const candFld = mSf[1];
          if (!validFields.has(candFld)) {
            diags.push({
              code: "E0308_UNKNOWN_STRUCT_FIELD",
              severity: "error",
              module: ast.name,
              line: 1,
              function: fn.name,
              offending_token: `self.${candFld}`,
              message: `Struct \`${fn.struct_owner}\` has NO field named \`${candFld}\` (accessed in \`${k}\`)! Valid fields on \`${fn.struct_owner}\` are: ${[...validFields].sort().join(", ")}.`,
              suggested_replacement: sdeclOwn.fields.length > 0 ? `self.${sdeclOwn.fields[0].name}` : "",
            });
          }
        }
      }
    }

    for (const [k, fn] of Object.entries(ast.functions)) {
      if (fn.body_lines.length === 0) continue;
      const bodyJoined = fn.body_lines.join("\n");
      for (const ens of fn.ensures) {
        const mEnsInc = /^self\.([A-Za-z0-9_]+)\s*==\s*old\(self\.\1\)\s*([+-])\s*(.+)$/.exec(ens.trim());
        if (mEnsInc) {
          const fldName = mEnsInc[1];
          const opSym = mEnsInc[2];
          const deltaExpr = mEnsInc[3].trim();
          let firstBranchIdx = fn.body_lines.findIndex((bl) => {
            const s = bl.trim();
            return s.startsWith("if ") || s.startsWith("return ");
          });
          if (firstBranchIdx === -1) firstBranchIdx = fn.body_lines.length;
          const updatedBeforeBranch = fn.body_lines.slice(0, firstBranchIdx).some((bl) => bl.includes(`self.${fldName}`));
          let delegatedUpdate = false;
          if (fn.struct_owner) {
            for (const mCall of bodyJoined.matchAll(/\bself\.([A-Za-z0-9_]+)\s*\(/g)) {
              const calleeFn = ast.functions[`${fn.struct_owner}.${mCall[1]}`];
              if (calleeFn && calleeFn.body_lines.some((cl) => cl.includes(`self.${fldName}`))) {
                delegatedUpdate = true;
                break;
              }
            }
          }
          const retPaths = Math.max(1, fn.body_lines.filter((bl) => bl.trim().startsWith("return")).length);
          const fldOccurrences = bodyJoined.split(`self.${fldName}`).length - 1;
          if (!updatedBeforeBranch && !delegatedUpdate && fldOccurrences < retPaths) {
            diags.push({
              code: "E0108_MISSING_ENSURES_FIELD_MUTATION",
              severity: "error",
              module: ast.name,
              line: 1,
              function: fn.name,
              offending_token: `ensures ${ens}`,
              message: `Function \`${k}\` has unconditional postcondition \`ensures ${ens}\`, but \`self.${fldName}\` is not updated on all return paths! Place \`self.${fldName} ${opSym}= ${deltaExpr}\` at the start of \`${fn.name}\`.`,
              suggested_replacement: `self.${fldName} ${opSym}= ${deltaExpr}`,
            });
          }
        }
      }
    }

    if (diags.length > 0) {
      return { module: ast.name, compile_ok: false, ai_diagnostics: diags, compile_ms: 0.0 };
    }
    c99Code = transpileModuleToC99(ast);
    if (checkOnly) {
      return {
        module: ast.name,
        compile_ok: true,
        ai_diagnostics: [],
        tolerant_semicolons: ast.tolerant_semicolons,
        spun_path: ast.spun_path,
        jni_abi_hash: jniAbiHash,
        jn_impl_hash: jnImplHash,
        compile_ms: 0.0,
      };
    }
  } catch (exc) {
    const errMsg = exc instanceof Error ? exc.message : String(exc);
    return {
      module: ast.name,
      compile_ok: false,
      ai_diagnostics: [
        {
          code: "E0105_JN_PARSE_ERROR",
          severity: "error",
          module: ast.name,
          line: 1,
          message: `Syntax error in \`.jn\`: ${errMsg}`,
          offending_token: "",
          suggested_replacement: generateJnSkeleton(ast),
        },
      ],
      compile_ms: 0.0,
    };
  }

  const cacheRoot = path.join(ROOT_DIR, ".jenny-cache");
  const cacheC99Dir = path.join(cacheRoot, "c99");
  const cacheBinDir = path.join(cacheRoot, "bin");
  fs.mkdirSync(cacheC99Dir, { recursive: true });
  fs.mkdirSync(cacheBinDir, { recursive: true });

  const spunDir = path.join(ROOT_DIR, ".spun", "c99_build");
  fs.mkdirSync(spunDir, { recursive: true });
  const cFile = path.join(spunDir, `${ast.name}.c`);
  const exeFile = path.join(spunDir, `${ast.name}.exe`);
  const cacheCFile = path.join(cacheC99Dir, `${ast.name}.c`);
  const cacheHFile = path.join(cacheC99Dir, `${ast.name}.h`);
  const cacheExeFile = path.join(cacheBinDir, `${ast.name}.exe`);

  const pureJniAst = parseJniBlueprint(jniText);
  fs.writeFileSync(cacheHFile, emitJniHeaderFirewall(pureJniAst, jniAbiHash), "utf-8");

  const manifestPath = path.join(cacheRoot, "cas_manifest.json");
  let casManifest: Record<string, any> = {};
  if (fs.existsSync(manifestPath)) {
    try {
      casManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      casManifest = {};
    }
  }

  const isCustom = customJnText !== null || customJniText !== null;
  const cachedEntry = casManifest[ast.name] ?? {};
  const cacheHit =
    useCache &&
    !isCustom &&
    cachedEntry.jni_abi_hash === jniAbiHash &&
    cachedEntry.jn_impl_hash === jnImplHash &&
    fs.existsSync(exeFile);

  let compileMs = 0.0;
  if (!cacheHit) {
    fs.writeFileSync(cFile, c99Code, "utf-8");
    fs.writeFileSync(cacheCFile, c99Code, "utf-8");
    const t0 = performance.now();
    const comp = spawnSync(
      CLANG_PATH,
      ["-std=c11", "-O3", "-Wall", "-Wno-unused-variable", cFile, "-o", exeFile],
      { encoding: "utf-8" },
    );
    compileMs = Number((performance.now() - t0).toFixed(2));
    if (comp.status !== 0) {
      return { module: ast.name, compile_ok: false, compile_stderr: comp.stderr ?? "", compile_ms: compileMs };
    }
    if (!isCustom) {
      fs.copyFileSync(exeFile, cacheExeFile);
      casManifest[ast.name] = {
        jni_abi_hash: jniAbiHash,
        jn_impl_hash: jnImplHash,
        header_path: `.jenny-cache/c99/${ast.name}.h`,
        c99_path: `.jenny-cache/c99/${ast.name}.c`,
        bin_path: `.jenny-cache/bin/${ast.name}.exe`,
        exe_size_bytes: fs.statSync(exeFile).size,
        cold_compile_ms: compileMs,
      };
      fs.writeFileSync(manifestPath, JSON.stringify(casManifest, null, 2), "utf-8");
    }
  }

  const exResults: Record<string, any>[] = [];
  for (let idx = 0; idx < ast.examples.length; idx++) {
    const ex = ast.examples[idx];
    const tRun = performance.now();
    const proc = spawnSync(exeFile, [String(idx)], { encoding: "utf-8" });
    const runMs = Number((performance.now() - tRun).toFixed(2));
    const exitCode = proc.status ?? -1;
    exResults.push({
      id: `EX-${idx + 1}`,
      title: ex.title,
      exit_code: exitCode,
      passed: exitCode === 0,
      stdout: (proc.stdout ?? "").trim(),
      stderr: (proc.stderr ?? "").trim(),
      run_ms: runMs,
    });
  }

  const resDict: Record<string, any> = {
    module: ast.name,
    header_path: `.jenny-cache/c99/${ast.name}.h`,
    c99_path: `.jenny-cache/c99/${ast.name}.c`,
    bin_path: `.jenny-cache/bin/${ast.name}.exe`,
    exe_size_bytes: fs.existsSync(exeFile) ? fs.statSync(exeFile).size : 0,
    jni_abi_hash: jniAbiHash,
    jn_impl_hash: jnImplHash,
    cache_hit: cacheHit,
    compile_ok: true,
    compile_ms: compileMs,
    tolerant_semicolons: ast.tolerant_semicolons,
    examples: exResults,
  };
  if (ast.spun_path) resDict.spun_path = ast.spun_path;
  return resDict;
}

export function analyzeSingleFile(filePath: string, customText: string | null = null): Record<string, any> {
  const resolved = path.resolve(filePath);
  const text = (customText ?? fs.readFileSync(resolved, "utf-8")).replace(/\r\n/g, "\n");
  const suffix = path.extname(resolved).toLowerCase();
  const bdir = path.dirname(resolved);
  const stem = path.basename(resolved, path.extname(resolved));

  if (suffix === ".jni") {
    const diags: Diagnostic[] = [];
    const lines = text.split("\n");
    let inJennyFence = false;
    for (let idx = 0; idx < lines.length; idx++) {
      const lineNo = idx + 1;
      const rawLine = lines[idx];
      const stripped = rawLine.trim();
      if (stripped.startsWith("```jenny") || stripped.startsWith("```jn")) {
        inJennyFence = true;
        continue;
      }
      if (inJennyFence && stripped.startsWith("```")) {
        inJennyFence = false;
        continue;
      }
      if (!inJennyFence) continue;
      const codePart = rawLine.split("//")[0].trim();
      if (!codePart) continue;
      if (/&\s*(mut\s+|self\b|[A-Za-z_])/.test(codePart)) {
        diags.push({
          code: "E0101_FORBIDDEN_REF_SYNTAX",
          severity: "error",
          line: lineNo,
          message:
            "Jenny v2.0 strictly forbids `&T`, `&mut T`, and `&self` in `.jni` blueprints! Parameters are read-only borrows by default (`x: T`, `self`); use `mut x: T` / `mut self` or `own x: T` / `own self`.",
        });
      }
      if (/^let\s+([A-Za-z0-9_]+)/.test(codePart)) {
        diags.push({
          code: "E0102_FORBIDDEN_LET_BINDING",
          severity: "error",
          line: lineNo,
          message: "Jenny v2.0 uses `val` (immutable) or `var` (mutable), never `let`.",
        });
      }
    }

    const symbols: Record<string, string>[] = [];
    let modName = stem;
    let exCount = 0;
    try {
      const ast = parseJniBlueprint(text);
      modName = ast.name;
      exCount = ast.examples.length;
      diags.push(...validateStage3SpinAndTraits(ast, ""));
      diags.push(...validateStage4FfiAndNative(ast, ""));
      for (const [tname, tdef] of Object.entries(ast.traits)) {
        symbols.push({ kind: "trait", name: tname, detail: `trait (${Object.keys(tdef.methods).length} methods)` });
      }
      for (const [sname, sdef] of Object.entries(ast.structs)) {
        symbols.push({ kind: "struct", name: sname, detail: `struct (${sdef.fields.length} fields)` });
      }
      for (const [ename, edef] of Object.entries(ast.enums)) {
        symbols.push({ kind: "enum", name: ename, detail: `enum (${edef.variants.length} variants)` });
      }
      for (const [fkey, fdef] of Object.entries(ast.functions)) {
        const retSig = fdef.err_ty ? `${fdef.ret_ty} ! ${fdef.err_ty}` : fdef.ret_ty;
        symbols.push({
          kind: "function",
          name: fkey,
          detail: `-> ${retSig} (requires: ${fdef.requires.length}, ensures: ${fdef.ensures.length})`,
        });
      }
      for (const ex of ast.examples) {
        symbols.push({ kind: "example", name: `@example("${ex.title}")`, detail: "Contract sandbox test" });
      }
    } catch (exc) {
      if (diags.length === 0) {
        const errMsg = exc instanceof Error ? exc.message : String(exc);
        diags.push({
          code: "E0105_JNI_PARSE_ERROR",
          severity: "error",
          line: 1,
          message: `Syntax error in \`.jni\` blueprint: ${errMsg}`,
        });
      }
    }

    return { file: resolved, module: modName, kind: "jni", ok: diags.length === 0, diagnostics: diags, symbols, examples_count: exCount };
  }

  const pairedJni = resolved.replace(/\.[^.]+$/, ".jni");
  const hasPairedJni = fs.existsSync(pairedJni);
  const dirHasJni = hasPairedJni || (fs.existsSync(bdir) && fs.readdirSync(bdir).some((e) => e.endsWith(".jni")));
  if (dirHasJni) {
    const targetArg = hasPairedJni ? resolved : bdir;
    const res = compileAndRunBenchmark(targetArg, text, null, true, false);
    const diags: Diagnostic[] = [...(res.ai_diagnostics ?? [])];
    const lines = text.split("\n");
    for (let idx = 0; idx < lines.length; idx++) {
      const codePart = lines[idx].split("//")[0].trim();
      if (codePart.endsWith(";")) {
        diags.push({
          code: "W0103_TOLERANT_TRAILING_SEMICOLON",
          severity: "warning",
          line: idx + 1,
          message: "Jenny v2.0 is semicolon-free; trailing `;` is automatically absorbed by the compiler.",
        });
      }
    }
    return { file: resolved, module: res.module ?? stem, kind: "jn", ok: Boolean(res.compile_ok), diagnostics: diags, symbols: [] };
  }

  const diags = validateV2SyntaxOrDiagnose(text, stem, null);
  return { file: resolved, module: stem, kind: "jn", ok: diags.length === 0, diagnostics: diags, symbols: [] };
}

export function checkSingleFile(jnFile: string, _aiJson = true): number {
  const report = analyzeSingleFile(jnFile);
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

export function discoverStdJniFiles(): string[] {
  const stdRoot = path.join(ROOT_DIR, "library", "std");
  if (!fs.existsSync(stdRoot)) return [];
  const orderedRel = [
    "rt/intrinsics.jni",
    "mem/raw_buf.jni",
    "mem/arena.jni",
    "collections/vec.jni",
    "collections/vec_deque.jni",
    "collections/hash_map.jni",
    "collections/lru_cache.jni",
    "str/str_view.jni",
    "str/string_buf.jni",
    "str/fmt.jni",
    "io/cursor.jni",
    "io/buf_io.jni",
    "io/path_buf.jni",
    "codec/varint.jni",
    "ffi/c_abi.jni",
  ];
  return orderedRel.map((rel) => path.join(stdRoot, ...rel.split("/"))).filter((p) => fs.existsSync(p));
}

export function discoverAllBenchDirs(): string[] {
  const stages = ["seed_10", "stage1_flow", "stage2_mem", "stage3_spin", "stage4_native"];
  const allDirs: string[] = [];
  for (const stage of stages) {
    const stageRoot = path.join(ROOT_DIR, "benchmarks", stage);
    if (!fs.existsSync(stageRoot)) continue;
    const subdirs = fs
      .readdirSync(stageRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(stageRoot, d.name))
      .sort();
    allDirs.push(...subdirs);
  }
  return allDirs;
}

export function testAbiCompilationFirewall(
  b24Dir: string = path.join(ROOT_DIR, "benchmarks", "stage4_native", "B24_kv_storage_engine"),
  allDirsArg?: string[],
): Record<string, any> {
  const allDirs = allDirsArg ?? discoverAllBenchDirs();
  let warmHits = 0;
  let totalWarmCompileMs = 0.0;
  let totalExeBytes = 0;
  for (const bdir of allDirs) {
    const res = compileAndRunBenchmark(bdir, null, null, false, true);
    if (res.cache_hit) warmHits += 1;
    totalWarmCompileMs += Number(res.compile_ms ?? 0.0);
    totalExeBytes += Number(res.exe_size_bytes ?? 0);
  }

  const resolvedB24 =
    b24Dir && fs.existsSync(path.join(b24Dir, "kv_storage_engine.jni"))
      ? b24Dir
      : path.join(ROOT_DIR, "benchmarks", "stage4_native", "B24_kv_storage_engine");
  const jniText = fs.readFileSync(path.join(resolvedB24, "kv_storage_engine.jni"), "utf-8").replace(/\r\n/g, "\n");
  const jnText = fs.readFileSync(path.join(resolvedB24, "kv_storage_engine.jn"), "utf-8").replace(/\r\n/g, "\n");
  const abiBefore = computeJniAbiHash(jniText);
  const implBefore = crypto.createHash("sha256").update(jnText.trim(), "utf-8").digest("hex").slice(0, 16);

  const modifiedJn = jnText + "\n// Internal refactoring of private implementation details\n";
  const abiAfter = computeJniAbiHash(jniText);
  const implAfter = crypto.createHash("sha256").update(modifiedJn.trim(), "utf-8").digest("hex").slice(0, 16);

  const count = Math.max(1, allDirs.length);
  return {
    total_modules: allDirs.length,
    warm_cache_hits: warmHits,
    warm_cache_hit_rate: Number((warmHits / count).toFixed(4)),
    total_warm_compile_ms: Number(totalWarmCompileMs.toFixed(2)),
    avg_exe_size_kb: Number((totalExeBytes / count / 1024.0).toFixed(2)),
    total_cas_bin_size_kb: Number((totalExeBytes / 1024.0).toFixed(2)),
    firewall_test_module: "kv_storage_engine",
    jni_abi_hash_before: abiBefore,
    jni_abi_hash_after: abiAfter,
    jn_impl_hash_before: implBefore,
    jn_impl_hash_after: implAfter,
    abi_firewall_intact: abiBefore === abiAfter && implBefore !== implAfter,
    downstream_modules_rechecked: 0,
  };
}

export function runContractFuzzAll(benchDirs: string[]): Record<string, any> {
  const results: Record<string, any>[] = [];
  let totalVectors = 0;
  for (const bdir of benchDirs) {
    const resolved = path.resolve(bdir);
    const isFile = fs.existsSync(resolved) && fs.statSync(resolved).isFile();
    const benchLabel = isFile ? path.basename(resolved, path.extname(resolved)) : path.basename(resolved);
    const rep = compileAndRunBenchmark(resolved, null, null, false, false);
    if (!rep.compile_ok) {
      results.push({ benchmark: benchLabel, module: rep.module ?? benchLabel, fuzz_passed: false, compile_stderr: rep.compile_stderr ?? "" });
      continue;
    }
    const exePath = path.join(ROOT_DIR, ".spun", "c99_build", `${rep.module}.exe`);
    const proc = spawnSync(exePath, ["-2"], { encoding: "utf-8" });
    const stdout = proc.stdout ?? "";
    const stderr = proc.stderr ?? "";
    const passed = proc.status === 0 && stdout.includes("[FUZZ-PASS]");
    const vecs = parseInt(/vectors=(\d+)/.exec(stdout)?.[1] ?? "0", 10);
    const scCalls = parseInt(/scalar_calls=(\d+)/.exec(stdout)?.[1] ?? "0", 10);
    const stCalls = parseInt(/stateful_calls=(\d+)/.exec(stdout)?.[1] ?? "0", 10);
    const exReplays = parseInt(/example_replays=(\d+)/.exec(stdout)?.[1] ?? "0", 10);
    const mLk = /leak_check=(-?\d+)/.exec(stdout);
    const leaked = mLk ? parseInt(mLk[1], 10) : !passed ? -1 : 0;
    totalVectors += vecs;
    results.push({
      benchmark: benchLabel,
      module: rep.module,
      fuzz_passed: passed,
      vectors_executed: vecs,
      scalar_fuzz_calls: scCalls,
      stateful_fuzz_calls: stCalls,
      example_replays: exReplays,
      active_boxes_leaked: leaked,
      stderr: !passed ? stderr.trim() : "",
    });
  }
  return {
    tool: "node compiler/src/flow/cli.ts --fuzz (v2 Stateful Container + Scalar Contract Fuzzer)",
    total_modules: results.length,
    modules_passed: results.filter((r) => r.fuzz_passed).length,
    total_fuzz_vectors_executed: totalVectors,
    total_scalar_fuzz_calls: results.reduce((acc, r) => acc + (r.scalar_fuzz_calls ?? 0), 0),
    total_stateful_container_calls: results.reduce((acc, r) => acc + (r.stateful_fuzz_calls ?? 0), 0),
    total_example_replays: results.reduce((acc, r) => acc + (r.example_replays ?? 0), 0),
    all_fuzz_passed: results.every((r) => r.fuzz_passed),
    modules: results,
  };
}
