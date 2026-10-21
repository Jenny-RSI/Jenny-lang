import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  DelegateDecl,
  FieldDecl,
  FnSpec,
  ModuleAST,
  ParamDecl,
  RequiresClause,
} from "./ast.ts";
import {
  ROOT_DIR,
  createFieldDecl,
  createFnSpec,
  createModuleAST,
  createStructDecl,
  parseParamList,
  parseReturnSpec,
  splitFnHeader,
  stripCommentsAndSemi,
} from "./ast.ts";

function countChar(s: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) count += 1;
  }
  return count;
}

export function extractJennyFencedCode(jniText: string): string {
  const norm = jniText.replace(/\r\n/g, "\n");
  const blocks: string[] = [];
  const re = /```(?:jenny_decl|jenny_test|jenny)[ \t]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    blocks.push(m[1]);
  }
  return blocks.join("\n");
}

function stripInlineTestsFromJennyCode(codeBlock: string): string {
  const outLines: string[] = [];
  let skipBlock = false;
  let braceDepth = 0;
  for (const line of codeBlock.replace(/\r\n/g, "\n").split("\n")) {
    const s = line.trim();
    if (!skipBlock) {
      if (/^(?:@example\b|test\s+"[^"]+"\s*\{)/.test(s)) {
        if (s.includes("{") && !s.split("{")[0].includes("=>")) {
          braceDepth = countChar(s, "{") - countChar(s, "}");
          if (braceDepth > 0) {
            skipBlock = true;
          }
        }
        continue;
      }
      if (
        s.includes("=>") &&
        !s.startsWith("fn ") &&
        !s.startsWith("pub fn ") &&
        !s.startsWith("pkg fn ") &&
        !s.startsWith("//")
      ) {
        if (!/\bfn\s*\(/.test(s)) {
          continue;
        }
      }
      outLines.push(line);
    } else {
      braceDepth += countChar(s, "{") - countChar(s, "}");
      if (braceDepth <= 0) {
        skipBlock = false;
      }
    }
  }
  return outLines.join("\n");
}

export function extractJennyDeclCode(jniText: string): string {
  const norm = jniText.replace(/\r\n/g, "\n");
  const declBlocks: string[] = [];
  const declRe = /```jenny_decl[ \t]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(norm)) !== null) {
    declBlocks.push(m[1]);
  }
  if (declBlocks.length > 0) {
    return declBlocks.join("\n");
  }
  const legacyBlocks: string[] = [];
  const legRe = /```jenny[ \t]*\n([\s\S]*?)```/g;
  while ((m = legRe.exec(norm)) !== null) {
    legacyBlocks.push(m[1]);
  }
  return stripInlineTestsFromJennyCode(legacyBlocks.join("\n"));
}

export function extractJennyTestCode(jniText: string): string {
  const norm = jniText.replace(/\r\n/g, "\n");
  const testBlocks: string[] = [];
  const testRe = /```jenny_test[ \t]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = testRe.exec(norm)) !== null) {
    testBlocks.push(m[1]);
  }
  const legacyTests: string[] = [];
  const legRe = /```jenny[ \t]*\n([\s\S]*?)```/g;
  while ((m = legRe.exec(norm)) !== null) {
    const blk = m[1];
    let inTest = false;
    let braceDepth = 0;
    for (const line of blk.split("\n")) {
      const s = line.trim();
      if (!inTest) {
        if (/^(?:@example\b|test\s+"[^"]+"\s*\{)/.test(s)) {
          legacyTests.push(line);
          if (s.includes("{") && !s.split("{")[0].includes("=>")) {
            braceDepth = countChar(s, "{") - countChar(s, "}");
            if (braceDepth > 0) {
              inTest = true;
            }
          }
        } else if (
          s.includes("=>") &&
          !s.startsWith("fn ") &&
          !s.startsWith("pub fn ") &&
          !s.startsWith("pkg fn ") &&
          !s.startsWith("//") &&
          !/\bfn\s*\(/.test(s)
        ) {
          legacyTests.push(line);
        }
      } else {
        legacyTests.push(line);
        braceDepth += countChar(s, "{") - countChar(s, "}");
        if (braceDepth <= 0) {
          inTest = false;
        }
      }
    }
  }
  return [...testBlocks, ...legacyTests].join("\n");
}

export function stripJennyTestForAgent(jniText: string): string {
  const norm = jniText.replace(/\r\n/g, "\n");
  let stripped = norm.replace(
    /(?:\n#+[^\n]*(?:jenny_test|\u9a8c\u6536|\u6d4b\u8bd5|Test)[^\n]*\n+)?\s*```jenny_test[ \t]*\n[\s\S]*?```/gi,
    "",
  );
  stripped = stripped.replace(/```jenny[ \t]*\n([\s\S]*?)```/g, (_match, inner: string) => {
    const cleaned = stripInlineTestsFromJennyCode(inner);
    return `\`\`\`jenny_decl\n${cleaned.trim()}\n\`\`\``;
  });
  return stripped.trim() + "\n";
}

export function computeJniAbiHash(jniText: string): string {
  const fenced = extractJennyDeclCode(jniText);
  const normLines: string[] = [];
  for (const l of fenced.split(/\r?\n/)) {
    const s = stripCommentsAndSemi(l).trim();
    if (s) {
      normLines.push(s);
    }
  }
  return crypto.createHash("sha256").update(normLines.join("\n"), "utf-8").digest("hex").slice(0, 16);
}

let spindlePatternsCache: Record<string, any> | null = null;

function findJnpFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJnpFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".jnp")) {
      results.push(full);
    }
  }
  return results.sort();
}

export function loadSpindlePatterns(): Record<string, any> {
  if (spindlePatternsCache !== null) {
    return spindlePatternsCache;
  }
  const reg: Record<string, any> = {};
  const patRoot = path.join(ROOT_DIR, "library", "patterns");
  for (const jnpFile of findJnpFiles(patRoot)) {
    try {
      const data = JSON.parse(fs.readFileSync(jnpFile, "utf-8"));
      if (data && typeof data.pattern_id === "string") {
        reg[data.pattern_id] = data;
      }
    } catch {
      // Ignore malformed pattern files
    }
  }
  spindlePatternsCache = reg;
  return reg;
}

export function buildPatternFnSpecs(
  patName: string | Record<string, any>,
  targetStruct: string,
  _structFields?: FieldDecl[],
): FnSpec[] {
  let patternCfg: Record<string, any> | undefined;
  if (typeof patName === "string") {
    const patternsReg = loadSpindlePatterns();
    const patKey = patName.split("(")[0].trim();
    patternCfg = patternsReg[patKey] ?? patternsReg[patName];
  } else {
    patternCfg = patName;
  }
  if (!patternCfg || !Array.isArray(patternCfg.methods)) {
    return [];
  }
  const specs: FnSpec[] = [];
  for (const m of patternCfg.methods) {
    const params: ParamDecl[] = (m.params ?? []).map((p: Record<string, string>) => ({
      mode: p.mode,
      name: p.name,
      ty: p.ty.replaceAll("{Struct}", targetStruct),
    }));
    const retTy = String(m.ret_ty).replaceAll("{Struct}", targetStruct);
    specs.push(
      createFnSpec(m.name, targetStruct, params, retTy, m.err_ty ?? null, {
        ensures: Array.isArray(m.ensures) ? [...m.ensures] : [],
      }),
    );
  }
  return specs;
}

export function parseJniBlueprint(jniText: string): ModuleAST {
  const code = extractJennyFencedCode(jniText);
  const ast = createModuleAST("unnamed");
  const rawLines = code ? code.split(/\r?\n/) : [];
  const lines = rawLines.map((l) => stripCommentsAndSemi(l, ast));

  let i = 0;
  const n = lines.length;
  let currentImpl: string | null = null;
  const pendingAnnotations: string[] = [];
  let pendingReprC = false;
  let pendingExternC: string | null = null;

  while (i < n) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith("module ")) {
      ast.name = line.split(/\s+/)[1].trim().replaceAll("::", "_").replaceAll(".", "_");
      i += 1;
      continue;
    }

    const mCimp = /^import\s+c\s+"([^"]+)"\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(line);
    if (mCimp) {
      ast.c_imports[mCimp[2]] = mCimp[1];
      i += 1;
      continue;
    }

    const mModImp = /^(?:pub\s+)?import\s+([A-Za-z0-9_:]+)(?:::\{[^}]+\})?(?:\s+as\s+[A-Za-z0-9_]+)?$/.exec(line);
    if (mModImp) {
      const impPath = mModImp[1].trim().replace(/:+$/, "");
      if (!ast.imports.includes(impPath)) {
        ast.imports.push(impPath);
      }
      i += 1;
      continue;
    }

    if (line === "@repr(C)") {
      pendingReprC = true;
      i += 1;
      continue;
    }

    const mExtC = /^@extern_c\("([^"]+)"\)$/.exec(line);
    if (mExtC) {
      pendingExternC = mExtC[1].trim();
      i += 1;
      continue;
    }

    if (currentImpl && line === "}") {
      currentImpl = null;
      i += 1;
      continue;
    }

    const mApply = /^@apply\((.+)\)$/.exec(line);
    if (mApply) {
      pendingAnnotations.push(mApply[1].trim());
      i += 1;
      continue;
    }

    const mTrait = /^(?:pub|pkg)\s+trait\s+([A-Za-z0-9_]+)\s*\{/.exec(line);
    if (mTrait) {
      const tname = mTrait[1];
      const tmethods: Record<string, FnSpec> = {};
      i += 1;
      while (i < n && lines[i].trim() !== "}") {
        const tline = lines[i].trim();
        if (tline.startsWith("pub fn ") || tline.startsWith("pkg fn ") || tline.startsWith("fn ")) {
          const mTfn = /^(?:(?:pub|pkg)\s+)?fn\s+([A-Za-z0-9_]+)\s*\((.*)\)\s*->\s*(.+)$/.exec(tline);
          if (mTfn) {
            const tmName = mTfn[1];
            const tmParams = parseParamList(mTfn[2], tname);
            let rawTmRet = mTfn[3].trim();
            const tmEffects: string[] = [];
            const mInlEff = /\beffects\s*\[([^\]]+)\]/.exec(rawTmRet);
            if (mInlEff) {
              for (const e of mInlEff[1].split(",")) {
                if (e.trim()) tmEffects.push(e.trim());
              }
              rawTmRet = rawTmRet.replace(/\beffects\s*\[[^\]]+\]/, "").trim();
            }
            const [tmRet, tmErr] = parseReturnSpec(rawTmRet);
            const tmReqs: RequiresClause[] = [];
            const tmEnss: string[] = [];
            while (i + 1 < n) {
              const nextTl = lines[i + 1].trim();
              if (nextTl.startsWith("effects ")) {
                const mEff = /\[([^\]]+)\]/.exec(nextTl);
                if (mEff) {
                  for (const e of mEff[1].split(",")) {
                    if (e.trim()) tmEffects.push(e.trim());
                  }
                }
                i += 1;
              } else if (nextTl.startsWith("requires ")) {
                const rBody = nextTl.slice("requires ".length).trim();
                const elseIdx = rBody.indexOf(" else ");
                if (elseIdx !== -1) {
                  tmReqs.push({
                    cond: rBody.slice(0, elseIdx).trim(),
                    else_err: rBody.slice(elseIdx + " else ".length).trim(),
                  });
                } else {
                  tmReqs.push({ cond: rBody, else_err: null });
                }
                i += 1;
              } else if (nextTl.startsWith("ensures ")) {
                tmEnss.push(nextTl.slice("ensures ".length).trim());
                i += 1;
              } else {
                break;
              }
            }
            tmethods[tmName] = createFnSpec(tmName, tname, tmParams, tmRet, tmErr, {
              effects: tmEffects,
              requires: tmReqs,
              ensures: tmEnss,
            });
          }
        }
        i += 1;
      }
      ast.traits[tname] = { name: tname, methods: tmethods };
      i += 1;
      continue;
    }

    const mEnum = /^(?:pub|pkg)\s+(?:enum|error)\s+([A-Za-z0-9_]+)\s*\{(.*)$/.exec(line);
    if (mEnum) {
      const ename = mEnum[1];
      const restEnum = mEnum[2].trim();
      let variants: string[] = [];
      if (restEnum.endsWith("}")) {
        const innerV = restEnum.slice(0, -1).trim();
        variants = innerV
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
        ast.enums[ename] = { name: ename, variants };
        i += 1;
        continue;
      }
      i += 1;
      while (i < n && lines[i].trim() !== "}") {
        const v = lines[i].trim().replace(/,+$/, "");
        if (v) {
          variants.push(v);
        }
        i += 1;
      }
      ast.enums[ename] = { name: ename, variants };
      i += 1;
      continue;
    }

    const mStruct = /^(?:pub|pkg)\s+(struct|union)\s+([A-Za-z0-9_]+)\s*\{/.exec(line);
    if (mStruct) {
      const isUnion = mStruct[1] === "union";
      const sname = mStruct[2];
      const fields: FieldDecl[] = [];
      const invariants: string[] = [];
      const delegates: DelegateDecl[] = [];
      i += 1;
      while (i < n && lines[i].trim() !== "}") {
        const sline = lines[i].trim();
        if (!sline) {
          i += 1;
          continue;
        }
        const mDel = /^delegate\s+([A-Za-z0-9_]+)\s+to\s+self\.([A-Za-z0-9_]+)$/.exec(sline);
        if (mDel) {
          delegates.push({ trait_name: mDel[1], target_field: mDel[2] });
          if (!ast.trait_impls.some((ti) => ti.trait_name === mDel[1] && ti.struct_name === sname)) {
            ast.trait_impls.push({ trait_name: mDel[1], struct_name: sname });
          }
          i += 1;
          continue;
        }
        if (sline.startsWith("invariant") && sline.endsWith("{")) {
          i += 1;
          while (i < n && lines[i].trim() !== "}") {
            const inv = lines[i].trim();
            if (inv) {
              invariants.push(inv);
            }
            i += 1;
          }
          i += 1;
          continue;
        }
        if (sline.startsWith("invariant ")) {
          invariants.push(sline.slice("invariant ".length).trim());
          i += 1;
          continue;
        }
        const mField = /^(?:pub\s+)?([A-Za-z0-9_]+)\s*:\s*([^=,]+)(?:=\s*([^,]+))?,?$/.exec(sline);
        if (mField) {
          const fname = mField[1].trim();
          let rawTy = mField[2].trim();
          let bitWidth: number | null = null;
          const mBits = /(?:@bits\((\d+)\)|:\s*(\d+))$/.exec(rawTy);
          if (mBits && mBits.index !== undefined) {
            bitWidth = parseInt(mBits[1] || mBits[2], 10);
            rawTy = rawTy.slice(0, mBits.index).trim();
          }
          fields.push(createFieldDecl(fname, rawTy, mField[3] ? mField[3].trim() : null, bitWidth));
        }
        i += 1;
      }
      const isView = fields.some((f) => f.ty === "str" || f.ty.startsWith("[]"));
      ast.structs[sname] = createStructDecl(sname, {
        fields,
        invariants,
        is_stack_view: isView,
        delegates,
        apply_annotations: [...pendingAnnotations],
        repr_c: pendingReprC,
        is_union: isUnion,
      });
      pendingAnnotations.length = 0;
      pendingReprC = false;
      i += 1;
      continue;
    }

    const mImpl = /^(?:pub\s+)?impl\s+(?:([A-Za-z0-9_]+)\s+for\s+)?([A-Za-z0-9_]+)\s*\{(\s*\})?$/.exec(line);
    if (mImpl) {
      const traitName = mImpl[1] || null;
      const targetName = mImpl[2];
      if (traitName && !ast.trait_impls.some((ti) => ti.trait_name === traitName && ti.struct_name === targetName)) {
        ast.trait_impls.push({ trait_name: traitName, struct_name: targetName });
      }
      currentImpl = mImpl[3] ? null : targetName;
      i += 1;
      continue;
    }

    if (
      line.startsWith("pub fn ") ||
      line.startsWith("@spin pub fn ") ||
      line.startsWith("pub iter fn ") ||
      line.startsWith("iter pub fn ") ||
      line.startsWith("iter fn ")
    ) {
      const isSpinFn = line.startsWith("@spin ");
      const sigLines = [line];
      while (
        sigLines[sigLines.length - 1].endsWith(",") ||
        (!sigLines.join(" ").includes("->") && !sigLines.join(" ").includes(")"))
      ) {
        i += 1;
        sigLines.push(lines[i].trim());
      }
      const fullSig = sigLines.join(" ");
      const parsedSig = splitFnHeader(fullSig);
      if (!parsedSig || !parsedSig[2]) {
        throw new Error(`Cannot parse fn signature in .jni: ${fullSig}`);
      }
      const [fnName, rawParamsS, rawRetS] = parsedSig;
      const params = parseParamList(rawParamsS, currentImpl);
      let rawRet = rawRetS.trim();
      const effectsList: string[] = [];
      const mInlineEff = /\beffects\s*\[([^\]]+)\]/.exec(rawRet);
      if (mInlineEff) {
        for (const e of mInlineEff[1].split(",")) {
          if (e.trim()) effectsList.push(e.trim());
        }
        rawRet = rawRet.replace(/\beffects\s*\[[^\]]+\]/, "").trim();
      }
      let [retTy, errTy] = parseReturnSpec(rawRet);
      if (retTy === "Self" && currentImpl) {
        retTy = currentImpl;
      }
      const reqs: RequiresClause[] = [];
      const enss: string[] = [];
      i += 1;
      while (i < n) {
        const cline = lines[i].trim();
        if (cline.startsWith("effects ")) {
          const mEff = /\[([^\]]+)\]/.exec(cline);
          if (mEff) {
            for (const e of mEff[1].split(",")) {
              if (e.trim()) effectsList.push(e.trim());
            }
          }
          i += 1;
        } else if (cline.startsWith("requires ")) {
          const rBody = cline.slice("requires ".length).trim();
          const elseIdx = rBody.indexOf(" else ");
          if (elseIdx !== -1) {
            const condP = rBody.slice(0, elseIdx).trim();
            const errP = rBody.slice(elseIdx + " else ".length).trim();
            reqs.push({ cond: condP, else_err: errP });
          } else {
            reqs.push({ cond: rBody, else_err: null });
          }
          i += 1;
        } else if (cline.startsWith("ensures ")) {
          enss.push(cline.slice("ensures ".length).trim());
          i += 1;
        } else {
          break;
        }
      }
      const key = currentImpl ? `${currentImpl}.${fnName}` : fnName;
      ast.functions[key] = createFnSpec(fnName, currentImpl, params, retTy, errTy, {
        effects: effectsList,
        requires: reqs,
        ensures: enss,
        extern_c_sym: pendingExternC,
        is_spin_variadic: isSpinFn || params.some((p) => p.mode === "variadic"),
      });
      pendingExternC = null;
      continue;
    }

    const mEx = /^(?:@example\("([^"]+)"\)|test\s+"([^"]+)")\s*\{/.exec(line);
    if (mEx) {
      const title = mEx[1] || mEx[2];
      const body: string[] = [];
      let depth = 1;
      i += 1;
      while (i < n && depth > 0) {
        const rawL = lines[i];
        const noStrL = rawL.replace(/"(?:\\.|[^"\\])*"/g, '""');
        depth += countChar(noStrL, "{") - countChar(noStrL, "}");
        if (depth > 0) {
          body.push(rawL.trim());
        }
        i += 1;
      }
      ast.examples.push({ title, body_lines: body });
      continue;
    }

    const mSingleEx = /^(?:@example\s+)?(.+?)\s*=>\s*(.+)$/.exec(line);
    if (
      mSingleEx &&
      !line.startsWith("pub ") &&
      !line.startsWith("pkg ") &&
      !line.startsWith("fn ") &&
      !line.startsWith("impl ") &&
      !line.startsWith("requires ") &&
      !line.startsWith("ensures ")
    ) {
      const lhsExpr = mSingleEx[1].trim();
      const rhsExp = mSingleEx[2].trim();
      const mErr = /^(?:err|Err)\((.+)\)$/.exec(rhsExp);
      if (mErr) {
        const errVar = mErr[1].trim();
        ast.examples.push({
          title: `${lhsExpr} => ${rhsExp}`,
          body_lines: [`val _res = ${lhsExpr}`, `assert(_res is Err(${errVar}))`],
        });
      } else {
        const mCallFn = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\(/.exec(lhsExpr);
        const isFallibleCall =
          !lhsExpr.endsWith("!") &&
          mCallFn !== null &&
          Boolean(ast.functions[mCallFn[1]]?.err_ty);
        if (isFallibleCall) {
          ast.examples.push({
            title: `${lhsExpr} => ${rhsExp}`,
            body_lines: [`val _ok_val = ${lhsExpr}!`, `assert((_ok_val) == (${rhsExp}))`],
          });
        } else {
          ast.examples.push({
            title: `${lhsExpr} => ${rhsExp}`,
            body_lines: [`assert((${lhsExpr}) == (${rhsExp}))`],
          });
        }
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  // Register delegated trait method signatures and @apply / @spin spindle pattern signatures
  const patternsReg = loadSpindlePatterns();
  for (const [sname, sdecl] of Object.entries(ast.structs)) {
    const fieldNames = new Set(sdecl.fields.map((f) => f.name));
    for (const delDecl of sdecl.delegates) {
      if (fieldNames.has(delDecl.target_field) && delDecl.trait_name in ast.traits) {
        const tdecl = ast.traits[delDecl.trait_name];
        for (const [tmName, tmSpec] of Object.entries(tdecl.methods)) {
          const key = `${sname}.${tmName}`;
          if (!(key in ast.functions)) {
            const clonedParams: ParamDecl[] = tmSpec.params.map((p) => ({
              mode: p.mode,
              name: p.name,
              ty: p.name === "self" ? sname : p.ty,
            }));
            ast.functions[key] = createFnSpec(tmName, sname, clonedParams, tmSpec.ret_ty, tmSpec.err_ty);
          }
        }
      }
    }
    for (const ann of sdecl.apply_annotations) {
      const patKey = ann.split("(")[0].trim();
      if (patKey in patternsReg) {
        for (const pSpec of buildPatternFnSpecs(patternsReg[patKey], sname, sdecl.fields)) {
          const key = `${sname}.${pSpec.name}`;
          if (!(key in ast.functions)) {
            ast.functions[key] = pSpec;
          }
        }
      }
    }
    const fsmPat = patternsReg["fsm::state_machine"];
    if (fsmPat) {
      const tMatch = fsmPat.target_struct_match ?? {};
      if (sname === tMatch.struct && ast.name === tMatch.module) {
        for (const fSpec of buildPatternFnSpecs(fsmPat, sname, sdecl.fields)) {
          const key = `${sname}.${fSpec.name}`;
          if (!(key in ast.functions)) {
            ast.functions[key] = fSpec;
          }
        }
      }
    }
  }

  return ast;
}

export function generateJnSkeleton(jniText: string | ModuleAST): string {
  const ast = typeof jniText === "string" ? parseJniBlueprint(jniText) : jniText;
  const out: string[] = [`module ${ast.name}`, ""];
  const byOwner = new Map<string | null, FnSpec[]>();
  for (const fn of Object.values(ast.functions)) {
    const list = byOwner.get(fn.struct_owner) ?? [];
    list.push(fn);
    byOwner.set(fn.struct_owner, list);
  }

  for (const [owner, fns] of byOwner.entries()) {
    if (owner !== null) {
      const sdeclOwner = ast.structs[owner];
      if (sdeclOwner && sdeclOwner.apply_annotations.length > 0) {
        continue;
      }
      if (owner === "OrderMachine" && ast.name === "spin_fsm_order") {
        continue;
      }
      const delegatedSkip = new Set<string>();
      if (sdeclOwner && sdeclOwner.delegates.length > 0) {
        for (const dDecl of sdeclOwner.delegates) {
          const tDecl = ast.traits[dDecl.trait_name];
          if (tDecl) {
            for (const tmName of Object.keys(tDecl.methods)) {
              const fnCand = ast.functions[`${owner}.${tmName}`];
              if (fnCand && fnCand.ensures.length === 0 && fnCand.requires.length === 0) {
                delegatedSkip.add(tmName);
              }
            }
          }
        }
      }
      out.push(`impl ${owner} {`);
      for (const fn of fns) {
        if (delegatedSkip.has(fn.name)) {
          continue;
        }
        const pList: string[] = [];
        for (const p of fn.params) {
          if (p.name === "self") {
            pList.push(p.mode === "mut" ? "mut self" : p.mode === "own" ? "own self" : "self");
          } else {
            const prefix = p.mode === "mut" ? "mut " : p.mode === "own" ? "own " : "";
            pList.push(`${prefix}${p.name}: ${p.ty}`);
          }
        }
        const retS = !fn.err_ty ? fn.ret_ty : fn.err_ty === "AnyError" ? `${fn.ret_ty}!` : `${fn.ret_ty} ! ${fn.err_ty}`;
        out.push(`    pub fn ${fn.name}(${pList.join(", ")}) -> ${retS} {`);
        if (fn.name === "new" && owner in ast.structs) {
          const sdecl = ast.structs[owner];
          const paramNames = new Set(fn.params.map((p) => p.name));
          for (const fld of sdecl.fields) {
            if (!paramNames.has(fld.name) && fld.ty in ast.structs) {
              out.push(`        val _${fld.name} = ${fld.ty}.new(${fn.params.map((p) => p.name).join(", ")})`);
            }
          }
          out.push(`        return ${owner} {`);
          for (const fld of sdecl.fields) {
            if (paramNames.has(fld.name)) {
              out.push(`            ${fld.name}: ${fld.name},`);
            } else if (fld.ty in ast.structs) {
              out.push(`            ${fld.name}: _${fld.name},`);
            } else if (fld.defaultVal !== null) {
              out.push(`            ${fld.name}: ${fld.defaultVal},`);
            } else if (fld.ty.startsWith("[")) {
              const mA = /^\[(\d+)\]/.exec(fld.ty);
              const cnt = mA ? parseInt(mA[1], 10) : 8;
              out.push(`            ${fld.name}: [0; ${cnt}],`);
            } else {
              out.push(`            ${fld.name}: 0,`);
            }
          }
          out.push("        }");
        } else {
          out.push("        // TODO: implement");
        }
        out.push("    }");
        out.push("");
      }
      out.push("}");
      out.push("");
    } else {
      for (const fn of fns) {
        const pList: string[] = [];
        for (const p of fn.params) {
          const prefix = p.mode === "mut" ? "mut " : p.mode === "own" ? "own " : "";
          pList.push(`${prefix}${p.name}: ${p.ty}`);
        }
        const retS = !fn.err_ty ? fn.ret_ty : fn.err_ty === "AnyError" ? `${fn.ret_ty}!` : `${fn.ret_ty} ! ${fn.err_ty}`;
        out.push(`pub fn ${fn.name}(${pList.join(", ")}) -> ${retS} {`);
        out.push("    // TODO: implement");
        out.push("}");
        out.push("");
      }
    }
  }
  return out.join("\n").trim() + "\n";
}
