import type { FnSpec, ModuleAST } from "./ast.ts";
import {
  createFnSpec,
  parseParamList,
  parseReturnSpec,
  splitFnHeader,
  stripCommentsAndSemi,
} from "./ast.ts";
import { loadSpindlePatterns } from "./blueprint.ts";
import { expandStage3SpinAndDelegate, monomorphizeSpinVariadicFunctions } from "./spin.ts";

function countChar(s: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) count += 1;
  }
  return count;
}

export function stripSynthesizedStructReimpls(ast: ModuleAST, jnText: string): string {
  const patternsReg = loadSpindlePatterns();
  const fsmMatch = patternsReg["fsm::state_machine"]?.target_struct_match ?? {};
  const synthStructs = new Set<string>();
  for (const [sname, sdecl] of Object.entries(ast.structs)) {
    if (
      sdecl.apply_annotations.length > 0 ||
      (sname === fsmMatch.struct && ast.name === fsmMatch.module)
    ) {
      synthStructs.add(sname);
    }
  }
  if (synthStructs.size === 0) {
    return jnText;
  }
  const outLines: string[] = [];
  const lines = jnText.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const s = lines[i].trim();
    let skipBlk = false;
    for (const ss of synthStructs) {
      const implRe = new RegExp(`^(?:pub\\s+)?impl\\s+(?:[A-Za-z0-9_]+\\s+for\\s+)?${ss}\\b`);
      const fnRe = new RegExp(`^(?:pub\\s+)?fn\\s+${ss}(?:\\.|::)[A-Za-z0-9_]+\\b`);
      if (implRe.test(s) || fnRe.test(s)) {
        skipBlk = true;
        break;
      }
    }
    if (skipBlk) {
      let depth = countChar(lines[i], "{") - countChar(lines[i], "}");
      i += 1;
      while (i < lines.length && depth > 0) {
        depth += countChar(lines[i], "{") - countChar(lines[i], "}");
        i += 1;
      }
      continue;
    }
    outLines.push(lines[i]);
    i += 1;
  }
  return outLines.join("\n");
}

export function attachJnImplementations(ast: ModuleAST, jnText: string): void {
  const [expandedJn] = expandStage3SpinAndDelegate(ast, jnText);
  const rawLines = expandedJn ? expandedJn.replace(/\r\n/g, "\n").split("\n") : [];
  const lines = rawLines.map((l) => stripCommentsAndSemi(l, ast));
  let i = 0;
  const n = lines.length;
  let currentImpl: string | null = null;

  while (i < n) {
    const line = lines[i].trim();
    if (!line || line.startsWith("module ") || line.startsWith("import ") || line === "@repr(C)") {
      i += 1;
      continue;
    }

    const mImpl = /^impl\s+(?:[A-Za-z0-9_]+\s+for\s+)?([A-Za-z0-9_]+)\s*\{/.exec(line);
    if (mImpl) {
      const implTarget = mImpl[1];
      currentImpl = implTarget in ast.structs ? implTarget : null;
      i += 1;
      continue;
    }

    if (line === "}") {
      currentImpl = null;
      i += 1;
      continue;
    }

    if (
      line.startsWith("pub fn ") ||
      line.startsWith("fn ") ||
      line.startsWith("@spin pub fn ") ||
      line.startsWith("@spin fn ")
    ) {
      const isPub = line.includes("pub fn ");
      const isSpinFn = line.startsWith("@spin ");
      const sigLines = [line];
      let isBodylessDecl = false;
      while (i + 1 < n && !sigLines[sigLines.length - 1].endsWith("{")) {
        const peekL = lines[i + 1].trim();
        if (!peekL) {
          i += 1;
          continue;
        }
        if (
          peekL.startsWith("pub fn ") ||
          peekL.startsWith("fn ") ||
          peekL.startsWith("@spin pub fn ") ||
          peekL.startsWith("@spin fn ") ||
          peekL === "}" ||
          peekL.startsWith("impl ")
        ) {
          isBodylessDecl = true;
          break;
        }
        if (
          peekL.startsWith("val ") ||
          peekL.startsWith("var ") ||
          peekL.startsWith("return ") ||
          peekL.startsWith("if ") ||
          peekL.startsWith("guard ") ||
          peekL.startsWith("match ") ||
          peekL.startsWith("self.")
        ) {
          sigLines[sigLines.length - 1] = sigLines[sigLines.length - 1] + " {";
          break;
        }
        i += 1;
        if (peekL.startsWith("requires ") || peekL.startsWith("ensures ")) {
          if (peekL.endsWith("{")) {
            sigLines[sigLines.length - 1] = sigLines[sigLines.length - 1] + " {";
          }
          continue;
        }
        sigLines.push(peekL);
      }
      if (isBodylessDecl || !sigLines[sigLines.length - 1].endsWith("{")) {
        i += 1;
        continue;
      }
      let fullSig = sigLines.join(" ");
      const fnMaskedEffs: string[] = [];
      const maskRe = /\bmask\s*\[([^\]]*)\]/g;
      let mMk: RegExpExecArray | null;
      while ((mMk = maskRe.exec(fullSig)) !== null) {
        for (const e of mMk[1].split(",")) {
          if (e.trim()) {
            fnMaskedEffs.push(e.trim());
          }
        }
      }
      // Tolerantly strip inline effects/mask/requires/ensures before '{'
      fullSig = fullSig.replace(/\b(?:effects|mask)\s*\[[^\]]*\]/g, "");
      fullSig = fullSig.replace(/\b(?:requires|ensures)\b[^{]*\{$/, "{");
      const parsedSig = splitFnHeader(fullSig);
      if (!parsedSig) {
        throw new Error(`Cannot parse fn header in .jn: ${fullSig}`);
      }
      const [fnName, rawParamsS, rawRetS] = parsedSig;
      const retSpecStr = rawRetS ? rawRetS : "void";
      const key = currentImpl ? `${currentImpl}.${fnName}` : fnName;
      if (!(key in ast.functions)) {
        if (isPub) {
          throw new Error(`Public function \`${key}\` in .jn is missing from .jni blueprint!`);
        }
        const params = parseParamList(rawParamsS, currentImpl);
        const [retTy, errTy] = parseReturnSpec(retSpecStr);
        const newFn: FnSpec = createFnSpec(fnName, currentImpl, params, retTy, errTy, {
          masked_effects: fnMaskedEffs,
          is_spin_variadic: isSpinFn || params.some((p) => p.mode === "variadic"),
        });
        ast.functions = { [key]: newFn, ...ast.functions };
      } else if (fnMaskedEffs.length > 0) {
        ast.functions[key].masked_effects = fnMaskedEffs;
      }

      const body: string[] = [];
      let depth = 1;
      const maskBlockDepths: number[] = [];
      i += 1;
      while (i < n && depth > 0) {
        const rawL = lines[i];
        const sL = rawL.trim();
        if (/^mask\s*\[[^\]]+\]\s*\{$/.test(sL)) {
          const bMaskRe = /\bmask\s*\[([^\]]*)\]/g;
          let mBmk: RegExpExecArray | null;
          while ((mBmk = bMaskRe.exec(sL)) !== null) {
            for (const me of mBmk[1].split(",")) {
              const trimmed = me.trim();
              if (trimmed && !ast.functions[key].masked_effects.includes(trimmed)) {
                ast.functions[key].masked_effects.push(trimmed);
              }
            }
          }
          depth += 1;
          maskBlockDepths.push(depth);
          i += 1;
          continue;
        }
        if (sL === "}" && maskBlockDepths.length > 0 && depth === maskBlockDepths[maskBlockDepths.length - 1]) {
          maskBlockDepths.pop();
          depth -= 1;
          i += 1;
          continue;
        }
        depth += countChar(rawL, "{") - countChar(rawL, "}");
        if (depth > 0 && sL) {
          body.push(rawL);
        }
        i += 1;
      }
      ast.functions[key].body_lines = body;
      continue;
    }

    i += 1;
  }

  // Auto-synthesize default constructor `Struct.new` from `.jni` field defaults if omitted in `.jn`
  for (const fspec of Object.values(ast.functions)) {
    if (fspec.body_lines.length === 0 && fspec.name === "new" && fspec.struct_owner && fspec.struct_owner in ast.structs) {
      const sdecl = ast.structs[fspec.struct_owner];
      const paramNames = new Set(fspec.params.map((p) => p.name));
      const synth = [`return ${fspec.struct_owner} {`];
      for (const fld of sdecl.fields) {
        if (paramNames.has(fld.name)) {
          synth.push(`    ${fld.name}: ${fld.name},`);
        } else if (fld.defaultVal !== null) {
          synth.push(`    ${fld.name}: ${fld.defaultVal},`);
        } else if (fld.ty.startsWith("[")) {
          const mA = /^\[(\d+)\]/.exec(fld.ty);
          const cnt = mA ? parseInt(mA[1], 10) : 8;
          synth.push(`    ${fld.name}: [0; ${cnt}],`);
        } else {
          synth.push(`    ${fld.name}: 0,`);
        }
      }
      synth.push("}");
      fspec.body_lines = synth;
    } else if (fspec.body_lines.length === 0 && fspec.extern_c_sym) {
      const argList = fspec.params
        .filter((p) => p.name !== "self")
        .map((p) => p.name)
        .join(", ");
      if (fspec.ret_ty === "void") {
        fspec.body_lines = [`${fspec.extern_c_sym}(${argList})`];
      } else {
        fspec.body_lines = [`return ${fspec.extern_c_sym}(${argList})`];
      }
    }
  }

  monomorphizeSpinVariadicFunctions(ast, expandedJn);
}
