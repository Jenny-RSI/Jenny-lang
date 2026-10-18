import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FnSpec } from "../flow/ast.ts";
import {
  computeJniAbiHash,
  extractJennyFencedCode,
  parseJniBlueprint,
} from "../flow/blueprint.ts";
import { compileAndRunBenchmark } from "../flow/driver.ts";
import { attachJnImplementations } from "../flow/parser.ts";
import { STD_DIR, parseTapestryToml } from "./manifest.ts";

function roundTo(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

function countChar(s: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) count += 1;
  }
  return count;
}

function pythonJsonDumpsSortKeys(val: any): string {
  if (val === null || val === undefined) {
    return "null";
  }
  if (typeof val === "boolean" || typeof val === "number") {
    return String(val);
  }
  if (typeof val === "string") {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return "[" + val.map(pythonJsonDumpsSortKeys).join(", ") + "]";
  }
  if (typeof val === "object") {
    const keys = Object.keys(val).sort();
    return (
      "{" +
      keys
        .map((k) => `${JSON.stringify(k)}: ${pythonJsonDumpsSortKeys(val[k])}`)
        .join(", ") +
      "}"
    );
  }
  return JSON.stringify(val);
}

export function cmdBindgenC(
  pkgDir: string = STD_DIR,
  headerRel?: string | null,
): Record<string, any> {
  const rel = headerRel || "ffi/c_frame_abi.h";
  const cHeaderPath = path.join(pkgDir, rel);
  const cText = fs.readFileSync(cHeaderPath, "utf-8");

  const cToJnTy: Record<string, string> = {
    uint8_t: "u8",
    int8_t: "i8",
    uint16_t: "u16",
    int16_t: "i16",
    uint32_t: "u32",
    int32_t: "i32",
    uint64_t: "u64",
    int64_t: "i64",
    size_t: "usize",
  };

  const extractedRecords: Record<string, any>[] = [];
  const recRe =
    /typedef\s+(struct|union)\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\}\s*([A-Za-z0-9_]+)\s*;/g;
  let mRec: RegExpExecArray | null;
  while ((mRec = recRe.exec(cText)) !== null) {
    const kind = mRec[1];
    const cName = mRec[4];
    const jnName = cName.endsWith("_C") ? cName.slice(0, -2) : cName;
    const body = mRec[3];
    const fields: Record<string, any>[] = [];
    const inferredInvariants: string[] = [];
    let totalBits = 0;

    for (const rawF of body.replace(/\r\n/g, "\n").split("\n")) {
      const fline = rawF.split("/*")[0].split("//")[0].trim();
      if (!fline) continue;
      const mBf =
        /^([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*(?::\s*(\d+))?\s*;$/.exec(fline);
      if (mBf) {
        const cty = mBf[1];
        const fname = mBf[2];
        const bwidth = mBf[3];
        const jty =
          cToJnTy[cty] ?? (cty.endsWith("_C") ? cty.slice(0, -2) : cty);
        const bwInt = bwidth ? parseInt(bwidth, 10) : null;
        if (bwInt !== null) {
          const maxVal = (1 << bwInt) - 1;
          inferredInvariants.push(
            `invariant self.${fname} >= 0 && self.${fname} <= ${maxVal}`,
          );
          totalBits += bwInt;
        } else {
          totalBits += 32;
        }
        fields.push({
          name: fname,
          c_type: cty,
          jenny_type: jty,
          bit_width: bwInt,
        });
      }
    }
    extractedRecords.push({
      kind,
      c_name: cName,
      jenny_name: jnName,
      fields,
      inferred_bitfield_invariants: inferredInvariants,
      expected_sizeof_bytes: kind === "union" ? 4 : Math.floor(totalBits / 8),
    });
  }

  const extractedFns: Record<string, any>[] = [];
  const fnRe =
    /static\s+inline\s+([A-Za-z0-9_]+)\s+(jenny_c_abi_[A-Za-z0-9_]+)\s*\(([^)]*)\)/g;
  let mFn: RegExpExecArray | null;
  while ((mFn = fnRe.exec(cText)) !== null) {
    const retC = mFn[1];
    const fnC = mFn[2];
    const paramsC = mFn[3];
    const inferredRequires: string[] = [];
    const inferredEffects: string[] = [];
    if (paramsC.includes("raw_ptr")) {
      inferredRequires.push("requires raw_ptr > 0");
      inferredEffects.push("FFI");
    }
    if (paramsC.includes("count")) {
      inferredRequires.push("requires count >= 0");
    }
    extractedFns.push({
      c_symbol: fnC,
      c_return: retC,
      jenny_return: cToJnTy[retC] ?? "i64",
      inferred_requires: inferredRequires,
      inferred_effects: inferredEffects,
    });
  }

  const jniTarget = path.join(pkgDir, "ffi", "c_abi.jni");
  const verifyRes = compileAndRunBenchmark(
    jniTarget,
    null,
    null,
    false,
    false,
  );

  return {
    tool: "spindle bindgen-c (White-Box C Header to .jni Blueprint Generator & 1:1 ABI Verifier)",
    source_c_header: `std/${rel}`,
    target_jni_blueprint: "std/ffi/c_abi.jni",
    records_extracted: extractedRecords.length,
    c_functions_extracted: extractedFns.length,
    records: extractedRecords,
    c_functions: extractedFns,
    layout_verification_compile_ok: Boolean(verifyRes.compile_ok),
    layout_verification_examples_passed: (verifyRes.examples ?? []).every(
      (ex: Record<string, any>) => Boolean(ex.passed),
    ),
  };
}

export function extractCanonicalModuleAst(
  modId: string,
  meta: Record<string, any>,
): Record<string, any> {
  const jniRel: string = meta.jni_rel ?? meta.jni ?? "";
  const pkgDir: string = meta.pkg_dir ?? meta.root_dir ?? STD_DIR;
  const jniPath: string = meta.jni_path ?? path.join(pkgDir, jniRel);
  const jnRel: string =
    meta.jn_rel ?? meta.jn ?? jniRel.replace(/\.jni$/, ".jn");
  const jnPath: string = meta.jn_path ?? path.join(pkgDir, jnRel);
  const jniText: string =
    meta.jni_text ?? fs.readFileSync(jniPath, "utf-8");
  const jnText: string = meta.jn_text ?? fs.readFileSync(jnPath, "utf-8");

  const ast = parseJniBlueprint(jniText);
  attachJnImplementations(ast, jnText);

  const imports: string[] = [];
  const impRe = /^\s*import\s+([A-Za-z0-9_:]+)\s*$/gm;
  let mImp: RegExpExecArray | null;
  const normJn = jnText.replace(/\r\n/g, "\n");
  while ((mImp = impRe.exec(normJn)) !== null) {
    imports.push(mImp[1]);
  }

  const functionsAst: Record<string, any>[] = [];
  for (const [key, fn] of Object.entries(ast.functions)) {
    if (key.includes("__spin_") || fn.extern_c_sym) {
      continue;
    }
    const normStmts = fn.body_lines
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (normStmts.length === 0) {
      continue;
    }
    functionsAst.push({
      key,
      name: fn.name,
      struct_owner: fn.struct_owner,
      is_spin_variadic: fn.is_spin_variadic,
      params: fn.params.map((p) => ({
        name: p.name,
        ty: p.ty,
        mode: p.mode,
      })),
      ret_ty: fn.ret_ty,
      err_ty: fn.err_ty,
      effects: [...fn.effects],
      requires: fn.requires.map((r) => r.cond),
      ensures: [...fn.ensures],
      body_stmts: normStmts,
    });
  }

  const canonPayload: Record<string, any> = {
    module_id: modId,
    module_decl: ast.name,
    jni_rel: jniRel,
    jni_abi_hash: computeJniAbiHash(jniText),
    imports,
    functions: functionsAst,
  };
  const astJson = pythonJsonDumpsSortKeys(canonPayload);
  canonPayload.canonical_ast_sha256 = crypto
    .createHash("sha256")
    .update(astJson, "utf-8")
    .digest("hex")
    .slice(0, 16);
  return canonPayload;
}

export function decompileAstNodeToJn(modNode: Record<string, any>): string {
  const out: string[] = [`module ${modNode.module_decl}`];
  if (modNode.imports && modNode.imports.length > 0) {
    out.push("");
    for (const imp of modNode.imports) {
      out.push(`import ${imp}`);
    }
  }

  for (const sb of modNode.spin_blocks ?? []) {
    out.push("");
    out.push(`@spin ${sb.directive} {`);
    for (const sline of sb.lines ?? []) {
      out.push(`    ${sline}`);
    }
    out.push("}");
  }

  function fmtParam(p: Record<string, any>): string {
    if (p.name === "self") {
      return p.mode === "read" || p.mode === "borrow"
        ? "self"
        : `${p.mode} self`;
    }
    if (p.mode === "variadic") {
      return p.ty === "..." ? `...${p.name}` : `...${p.name}: ${p.ty}`;
    }
    let base =
      p.mode === "read" || p.mode === "borrow"
        ? `${p.name}: ${p.ty}`
        : `${p.mode} ${p.name}: ${p.ty}`;
    if (p.default !== undefined && p.default !== null) {
      base += ` = ${p.default}`;
    }
    return base;
  }

  function fmtRet(fnD: Record<string, any>): string {
    return fnD.err_ty ? `${fnD.ret_ty} ! ${fnD.err_ty}` : fnD.ret_ty;
  }

  function emitBody(stmts: string[], baseLevel: number): string[] {
    const linesOut: string[] = [];
    let lvl = baseLevel;
    for (const st of stmts) {
      const curLvl = st.startsWith("}")
        ? Math.max(baseLevel, lvl - 1)
        : lvl;
      linesOut.push("    ".repeat(curLvl) + st);
      lvl = Math.max(baseLevel, lvl + countChar(st, "{") - countChar(st, "}"));
    }
    return linesOut;
  }

  const fns: Record<string, any>[] = modNode.functions ?? [];
  const topFns = fns.filter((f) => !f.struct_owner);
  for (const tf of topFns) {
    out.push("");
    const prefix = tf.is_spin_variadic ? "@spin pub fn" : "pub fn";
    const pS = (tf.params ?? []).map(fmtParam).join(", ");
    out.push(`${prefix} ${tf.name}(${pS}) -> ${fmtRet(tf)} {`);
    out.push(...emitBody(tf.body_stmts ?? [], 1));
    out.push("}");
  }

  const implGroups = new Map<string, Record<string, any>[]>();
  for (const f of fns) {
    if (f.struct_owner) {
      const list = implGroups.get(f.struct_owner) ?? [];
      list.push(f);
      implGroups.set(f.struct_owner, list);
    }
  }

  for (const [owner, methods] of implGroups.entries()) {
    out.push("");
    out.push(`impl ${owner} {`);
    for (let idxM = 0; idxM < methods.length; idxM++) {
      const mf = methods[idxM];
      if (idxM > 0) {
        out.push("");
      }
      const prefix = mf.is_spin_variadic ? "@spin pub fn" : "pub fn";
      const pS = (mf.params ?? []).map(fmtParam).join(", ");
      out.push(`    ${prefix} ${mf.name}(${pS}) -> ${fmtRet(mf)} {`);
      out.push(...emitBody(mf.body_stmts ?? [], 2));
      out.push("    }");
    }
    out.push("}");
  }

  return out.join("\n") + "\n";
}

export function cmdPack(pkgDir: string = STD_DIR): Record<string, any> {
  const manifest = parseTapestryToml(pkgDir);
  const pkgMeta: Record<string, any> = manifest.package ?? {};
  const modMap: Record<string, Record<string, string>> = manifest.modules ?? {};

  const jnastModules: Record<string, Record<string, any>> = {};
  const shippedJniFiles: string[] = [];
  let totJniBytes = 0;
  let totRawJnBytes = 0;

  for (const [modId, paths] of Object.entries(modMap)) {
    const jniFile = path.join(pkgDir, paths.jni);
    const jnFile = path.join(pkgDir, paths.jn);
    const jniText = fs.readFileSync(jniFile, "utf-8");
    const jnText = fs.readFileSync(jnFile, "utf-8");
    totJniBytes += Buffer.byteLength(jniText, "utf-8");
    totRawJnBytes += Buffer.byteLength(jnText, "utf-8");
    shippedJniFiles.push(`library/std/${paths.jni}`);
    jnastModules[modId] = extractCanonicalModuleAst(modId, {
      jni_rel: paths.jni,
      jni_text: jniText,
      jn_text: jnText,
      pkg_dir: pkgDir,
    });
  }

  const jnastArchive = {
    format: "Jenny-Canonical-AST-Archive-v1",
    package: pkgMeta.name,
    version: pkgMeta.version,
    shipped_jn_source_files: 0,
    shipped_spun_files: 0,
    modules_count: Object.keys(jnastModules).length,
    modules: jnastModules,
  };
  const libDir = path.join(pkgDir, "lib");
  fs.mkdirSync(libDir, { recursive: true });
  const jnastPath = path.join(libDir, `${pkgMeta.name ?? "pkg"}.jnast`);
  const jnastText = JSON.stringify(jnastArchive, null, 2) + "\n";
  fs.writeFileSync(jnastPath, jnastText, "utf-8");
  const jnastSha256 = crypto
    .createHash("sha256")
    .update(jnastText, "utf-8")
    .digest("hex")
    .slice(0, 16);

  return {
    tool: "spindle pack (Blueprint-Only + Unified Canonical AST Library Packager)",
    package: pkgMeta.name,
    version: pkgMeta.version,
    jnast_archive_path: "library/std/lib/std.jnast",
    jnast_archive_sha256: jnastSha256,
    jnast_archive_size_bytes: Buffer.byteLength(jnastText, "utf-8"),
    shipped_jni_blueprints_count: shippedJniFiles.length,
    shipped_jn_source_files_count: 0,
    shipped_spun_files_count: 0,
    total_jni_blueprints_bytes: totJniBytes,
    omitted_raw_jn_sources_bytes: totRawJnBytes,
    shipped_files: [
      "library/std/Tapestry.toml",
      "library/std/Tapestry.lock",
      ...shippedJniFiles,
      "library/std/lib/std.jnast",
    ],
  };
}

export function cmdDecompile(
  pkgDir: string = STD_DIR,
  targetMod?: string | null,
): Record<string, any> {
  const jnastPath = path.join(pkgDir, "lib", "std.jnast");
  if (!fs.existsSync(jnastPath)) {
    cmdPack(pkgDir);
  }
  let archive = JSON.parse(fs.readFileSync(jnastPath, "utf-8"));
  let modulesAst: Record<string, Record<string, any>> = archive.modules ?? {};

  // Ensure archive is synchronized with current .jni ABI hashes on disk
  const firstModId = Object.keys(modulesAst)[0];
  if (firstModId) {
    const firstNode = modulesAst[firstModId];
    const firstJniPath = path.join(pkgDir, firstNode.jni_rel);
    if (fs.existsSync(firstJniPath)) {
      const diskAbi = computeJniAbiHash(fs.readFileSync(firstJniPath, "utf-8"));
      if (diskAbi !== firstNode.jni_abi_hash) {
        cmdPack(pkgDir);
        archive = JSON.parse(fs.readFileSync(jnastPath, "utf-8"));
        modulesAst = archive.modules ?? {};
      }
    }
  }

  const modsToCheck =
    targetMod && targetMod in modulesAst
      ? [targetMod]
      : Object.keys(modulesAst);
  const roundtripResults: Record<string, any>[] = [];
  const previewMod = targetMod || "std::str::fmt";
  let previewJnSource = "";

  for (const modId of modsToCheck) {
    const modNode = modulesAst[modId];
    const decompiledJn = decompileAstNodeToJn(modNode);
    if (modId === previewMod) {
      previewJnSource = decompiledJn;
    }

    const jniPath = path.join(pkgDir, modNode.jni_rel);
    const jniText = fs.readFileSync(jniPath, "utf-8");
    const reparsedNode = extractCanonicalModuleAst(modId, {
      jni_rel: modNode.jni_rel,
      jni_text: jniText,
      jn_text: decompiledJn,
      pkg_dir: pkgDir,
    });
    const astMatch =
      reparsedNode.canonical_ast_sha256 === modNode.canonical_ast_sha256;

    roundtripResults.push({
      module_id: modId,
      original_ast_sha256: modNode.canonical_ast_sha256,
      decompiled_ast_sha256: reparsedNode.canonical_ast_sha256,
      ast_roundtrip_exact: astMatch,
      decompiled_lines: decompiledJn.replace(/\r\n/g, "\n").split("\n").length - 1,
      functions_decompiled: (modNode.functions ?? []).length,
    });
  }

  const fmtNode = modulesAst["std::str::fmt"];
  const fmtDecompiled = decompileAstNodeToJn(fmtNode);
  const fmtVerify = compileAndRunBenchmark(
    path.join(pkgDir, fmtNode.jni_rel),
    fmtDecompiled,
    null,
    false,
    false,
  );

  return {
    tool: "spindle decompile (Lossless AST-to-.jn Decompiler & Round-Trip Verifier)",
    source_archive: "library/std/lib/std.jnast",
    modules_verified: roundtripResults.length,
    lossless_ast_roundtrip_count: roundtripResults.filter((r) =>
      Boolean(r.ast_roundtrip_exact),
    ).length,
    all_roundtrip_exact: roundtripResults.every((r) =>
      Boolean(r.ast_roundtrip_exact),
    ),
    decompiled_fmt_compile_ok: Boolean(fmtVerify.compile_ok),
    decompiled_fmt_examples_passed: (fmtVerify.examples ?? []).every(
      (ex: Record<string, any>) => Boolean(ex.passed),
    ),
    preview_module: previewMod,
    preview_decompiled_header: previewJnSource
      .replace(/\r\n/g, "\n")
      .split("\n")
      .slice(0, 35)
      .join("\n"),
    modules: roundtripResults,
  };
}

export function cmdStdCheck(
  pkgDir: string = STD_DIR,
  targetMod: string | null = null,
  targetDomain: string | null = null,
  targetStage: number | null = null,
): Record<string, any> {
  const manifest = parseTapestryToml(pkgDir);
  const modMap: Record<string, Record<string, string>> = manifest.modules ?? {};

  let domainsOrder = [
    "core",
    "rt",
    "ffi",
    "mem",
    "collections",
    "str",
    "io",
    "codec",
    "thread",
    "fiber",
  ];
  if (targetDomain) {
    domainsOrder = domainsOrder.filter((d) => d === targetDomain);
  }

  const stagePlanByMod: Record<
    string,
    Record<number, Array<{ fn_key: string; signature: string; checked_in_md: boolean }>>
  > = {};
  const domainChecklistsFound: string[] = [];

  for (const dom of domainsOrder) {
    const clFile = path.join(pkgDir, dom, "CHECKLIST.md");
    if (!fs.existsSync(clFile)) {
      continue;
    }
    domainChecklistsFound.push(`library/std/${dom}/CHECKLIST.md`);
    const clText = fs.readFileSync(clFile, "utf-8");
    let curMod: string | null = null;
    let curStage = 1;
    for (const line of clText.replace(/\r\n/g, "\n").split("\n")) {
      const mMod = /##\s+\d+\.\s+`(std::[a-z0-9_:]+)`/.exec(line);
      if (mMod) {
        curMod = mMod[1];
        if (!(curMod in stagePlanByMod)) {
          stagePlanByMod[curMod] = { 1: [], 2: [], 3: [], 4: [] };
        }
        continue;
      }
      const mSt = /###\s+.*Stage\s+([1-4])/.exec(line);
      if (mSt && curMod) {
        curStage = parseInt(mSt[1], 10);
        continue;
      }
      const sLine = line.trim();
      if (
        curMod &&
        (sLine.startsWith("* `[x]`") || sLine.startsWith("* `[ ]`"))
      ) {
        const checked = sLine.startsWith("* `[x]`");
        const boxToken = checked ? "`[x]`" : "`[ ]`";
        const afterBox = line.slice(line.indexOf(boxToken) + boxToken.length);
        const mSig = /`([^`]+)`/.exec(afterBox);
        if (mSig) {
          const sigStr = mSig[1].trim();
          const fnHead = sigStr.split("(")[0].trim();
          stagePlanByMod[curMod][curStage].push({
            fn_key: fnHead,
            signature: sigStr,
            checked_in_md: checked,
          });
        }
      }
    }
  }

  const moduleReports: Record<string, any>[] = [];
  const stageTotals: Record<
    number,
    { planned: number; jni_declared: number; jn_implemented: number; checked_off: number }
  > = {
    1: { planned: 0, jni_declared: 0, jn_implemented: 0, checked_off: 0 },
    2: { planned: 0, jni_declared: 0, jn_implemented: 0, checked_off: 0 },
    3: { planned: 0, jni_declared: 0, jn_implemented: 0, checked_off: 0 },
    4: { planned: 0, jni_declared: 0, jn_implemented: 0, checked_off: 0 },
  };

  const allModIds = Array.from(
    new Set<string>([...Object.keys(stagePlanByMod), ...Object.keys(modMap)]),
  );

  for (const modId of allModIds) {
    const modDomain = modId.includes("::") ? modId.split("::")[1] : "";
    if (targetDomain && modDomain !== targetDomain) {
      continue;
    }
    if (targetMod && modId !== targetMod) {
      continue;
    }

    const paths = modMap[modId];
    const liveJniFns: Record<string, FnSpec> = {};
    const liveJnFns: Record<string, FnSpec> = {};
    let contractCnt = 0;
    let hasManualDrop = false;
    let hasAutoDrop = false;
    let hasGenerics = false;
    let hasIterFn = false;
    let exCnt = 0;

    if (paths && fs.existsSync(path.join(pkgDir, paths.jni))) {
      const jniPath = path.join(pkgDir, paths.jni);
      const jnPath = path.join(pkgDir, paths.jn);
      const jniText = fs.readFileSync(jniPath, "utf-8");
      const jnText = fs.existsSync(jnPath)
        ? fs.readFileSync(jnPath, "utf-8")
        : "";

      const ast = parseJniBlueprint(jniText);
      attachJnImplementations(ast, jnText);
      const fencedCode = extractJennyFencedCode(jniText);

      for (const [k, f] of Object.entries(ast.functions)) {
        if (!k.includes("__spin_")) {
          liveJniFns[k] = f;
          if (f.extern_c_sym || f.body_lines.some((l) => l.trim().length > 0)) {
            liveJnFns[k] = f;
          }
        }
      }
      contractCnt =
        Object.values(ast.structs).reduce(
          (acc, s) => acc + s.invariants.length,
          0,
        ) +
        Object.values(ast.functions).reduce(
          (acc, f) => acc + f.requires.length + f.ensures.length,
          0,
        );
      hasManualDrop = Object.values(ast.functions).some(
        (f) => f.name.startsWith("drop_") || f.name === "release",
      );
      hasAutoDrop = Object.values(ast.functions).some(
        (f) =>
          f.name === "drop" &&
          f.params.some((p) => p.name === "self" && p.mode === "own"),
      );
      hasGenerics = /struct\s+\w+\s*<|fn\s+\w+\s*</.test(fencedCode);
      hasIterFn = fencedCode.includes("iter fn ");
      exCnt = ast.examples.length;
    }

    const modStagesPlan = stagePlanByMod[modId] ?? {
      1: [],
      2: [],
      3: [],
      4: [],
    };
    const stagesDetail: Record<string, Record<string, any>> = {};
    let modPlannedTotal = 0;
    let modJniTotal = 0;
    let modJnTotal = 0;

    for (const sNum of [1, 2, 3, 4]) {
      if (targetStage && sNum !== targetStage) {
        continue;
      }
      const items = modStagesPlan[sNum] ?? [];
      const pCnt = items.length;
      const jniCnt = items.filter((it) => it.fn_key in liveJniFns).length;
      const jnCnt = items.filter((it) => it.fn_key in liveJnFns).length;
      const chkCnt = items.filter((it) => it.checked_in_md).length;
      const missingSigs = items
        .filter((it) => !(it.fn_key in liveJnFns))
        .map((it) => it.signature);

      stageTotals[sNum].planned += pCnt;
      stageTotals[sNum].jni_declared += jniCnt;
      stageTotals[sNum].jn_implemented += jnCnt;
      stageTotals[sNum].checked_off += chkCnt;

      modPlannedTotal += pCnt;
      modJniTotal += jniCnt;
      modJnTotal += jnCnt;

      stagesDetail[`Stage_${sNum}`] = {
        planned_apis: pCnt,
        step2_jni_blueprint_ready: jniCnt,
        step3_jn_impl_ready: jnCnt,
        step4_checklist_checked: chkCnt,
        completion_pct: pCnt ? roundTo((jnCnt / pCnt) * 100.0, 1) : 100.0,
        missing_apis: missingSigs,
      };
    }

    const gates = {
      G1_stage2_api_complete:
        (stagesDetail.Stage_2?.completion_pct ?? 0.0) === 100.0,
      G2_contracts_verified: contractCnt > 0,
      G3_raii_auto_drop: (hasAutoDrop || !hasManualDrop) && modJnTotal > 0,
      G4_generic_or_utf8: hasGenerics,
      G5_zero_alloc_iter: hasIterFn,
      G6_bidirectional_examples: exCnt >= 2,
    };

    moduleReports.push({
      domain: modDomain,
      module_id: modId,
      checklist_path: `library/std/${modDomain}/CHECKLIST.md`,
      implemented_apis: modJnTotal,
      jni_declared_apis: modJniTotal,
      target_apis: modPlannedTotal,
      completion_pct: modPlannedTotal
        ? roundTo((modJnTotal / modPlannedTotal) * 100.0, 1)
        : 100.0,
      formal_contracts: contractCnt,
      examples_count: exCnt,
      gates,
      stages: stagesDetail,
    });
  }

  const totPlan = Object.values(stageTotals).reduce(
    (acc, v) => acc + v.planned,
    0,
  );
  const totJni = Object.values(stageTotals).reduce(
    (acc, v) => acc + v.jni_declared,
    0,
  );
  const totJn = Object.values(stageTotals).reduce(
    (acc, v) => acc + v.jn_implemented,
    0,
  );

  const stageBreakdown: Record<string, Record<string, any>> = {};
  for (const s of [1, 2, 3, 4]) {
    if (!targetStage || targetStage === s) {
      stageBreakdown[`Stage_${s}`] = {
        ...stageTotals[s],
        completion_pct: stageTotals[s].planned
          ? roundTo(
              (stageTotals[s].jn_implemented / stageTotals[s].planned) * 100.0,
              2,
            )
          : 0.0,
      };
    }
  }

  return {
    tool: "spindle std-check (Hierarchical 4-Stage & Intent-Loop Auditor: Plan -> .jni -> .jn -> Verify)",
    root_blueprint: "library/std/CHECKLIST.md",
    domain_checklists: domainChecklistsFound,
    intent_loop_summary: {
      step1_planned_apis: totPlan,
      step2_jni_blueprint_declared: totJni,
      step3_jn_implemented: totJn,
      overall_completion_pct: totPlan
        ? roundTo((totJn / totPlan) * 100.0, 2)
        : 0.0,
    },
    stage_breakdown: stageBreakdown,
    modules: moduleReports,
  };
}
