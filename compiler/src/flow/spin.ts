import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FnSpec, ModuleAST, ParamDecl } from "./ast.ts";
import { ROOT_DIR, createFnSpec, stripCommentsAndSemi } from "./ast.ts";
import { loadSpindlePatterns, parseJniBlueprint } from "./blueprint.ts";
import { attachJnImplementations, stripSynthesizedStructReimpls } from "./parser.ts";

function countChar(s: string, ch: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ch) count += 1;
  }
  return count;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function expandStage3SpinAndDelegate(
  ast: ModuleAST,
  jnText: string,
): [string, string | null] {
  const patternsReg = loadSpindlePatterns();
  const fsmCfg = patternsReg["fsm::state_machine"] ?? {};
  const fsmMatch = fsmCfg.target_struct_match ?? {};
  let curJnText = stripSynthesizedStructReimpls(ast, jnText);
  const hasStage3 =
    curJnText.includes("@spin ") ||
    Object.values(ast.structs).some(
      (s) => s.delegates.length > 0 || s.apply_annotations.length > 0,
    ) ||
    ast.name === fsmMatch.module;
  if (!hasStage3) {
    return [curJnText, ast.spun_path];
  }

  if (ast.name === fsmMatch.module && !curJnText.includes("@spin fsm::state_machine")) {
    const fsmDefaultBlock = (fsmCfg.default_dsl_block ?? []).join("\n");
    if (fsmDefaultBlock) {
      curJnText = curJnText.trimEnd() + "\n\n" + fsmDefaultBlock + "\n";
    }
  }

  // 1. Expand `@spin if true/false { ... }` blocks inside jn_text
  const rawLines = curJnText.replace(/\r\n/g, "\n").split("\n");
  const afterSpinIf: string[] = [];
  let idx = 0;
  while (idx < rawLines.length) {
    const stripped = rawLines[idx].trim();
    const mSif = /^@spin\s+if\s+(true|false)\s*\{$/.exec(stripped);
    if (mSif) {
      const keep = mSif[1] === "true";
      let depth = 1;
      idx += 1;
      while (idx < rawLines.length && depth > 0) {
        const lCur = rawLines[idx];
        depth += countChar(lCur, "{") - countChar(lCur, "}");
        if (depth > 0 && keep) {
          afterSpinIf.push(lCur);
        }
        idx += 1;
      }
      continue;
    }
    afterSpinIf.push(rawLines[idx]);
    idx += 1;
  }

  // 2. Expand `@spin fsm::state_machine(StructName) { ... }` blocks
  const expandedLines: string[] = [];
  idx = 0;
  while (idx < afterSpinIf.length) {
    const stripped = afterSpinIf[idx].trim();
    const mFsm = /^@spin\s+fsm::state_machine\(([A-Za-z0-9_]+)\)\s*\{$/.exec(stripped);
    if (mFsm) {
      const sname = mFsm[1];
      idx += 1;
      const transitions: [number, number, number, string | null][] = [];
      while (idx < afterSpinIf.length && afterSpinIf[idx].trim() !== "}") {
        const tline = stripCommentsAndSemi(afterSpinIf[idx]).trim();
        const mTr = /^(\d+)\s*--\[(\d+)\]-->\s*(\d+)(?:\s+guard\s*\((.+)\))?$/.exec(tline);
        if (mTr) {
          transitions.push([
            parseInt(mTr[1], 10),
            parseInt(mTr[2], 10),
            parseInt(mTr[3], 10),
            mTr[4] ? mTr[4].trim() : null,
          ]);
        }
        idx += 1;
      }
      idx += 1; // consume closing `}`

      const srcStates = new Set(transitions.map((tr) => tr[0]));
      const dstStates = new Set(transitions.map((tr) => tr[2]));
      const terminalStates = [...dstStates]
        .filter((s) => !srcStates.has(s))
        .sort((a, b) => a - b);

      expandedLines.push(`impl ${sname} {`);
      expandedLines.push(`    pub fn new(amount_cents: i64) -> ${sname} {`);
      expandedLines.push(
        `        return ${sname} { state: 0, amount_cents: amount_cents, transitions: 0 }`,
      );
      expandedLines.push("    }");
      expandedLines.push("    pub fn can_fire(self, ev: i64) -> bool {");
      for (const [src, evId, _dst, gcond] of transitions) {
        if (gcond) {
          expandedLines.push(`        if self.state == ${src} && ev == ${evId} { return ${gcond} }`);
        } else {
          expandedLines.push(`        if self.state == ${src} && ev == ${evId} { return true }`);
        }
      }
      expandedLines.push("        return false");
      expandedLines.push("    }");
      expandedLines.push("    pub fn step(mut self, ev: i64) -> i64 ! FsmError {");
      for (const [src, evId, dst, gcond] of transitions) {
        expandedLines.push(`        if self.state == ${src} && ev == ${evId} {`);
        if (gcond) {
          expandedLines.push(`            guard ${gcond} else { raise FsmError.GuardRejected }`);
        }
        expandedLines.push("            self.transitions += 1");
        expandedLines.push(`            self.state = ${dst}`);
        expandedLines.push("            return self.state");
        expandedLines.push("        }");
      }
      expandedLines.push("        raise FsmError.InvalidTransition");
      expandedLines.push("    }");
      expandedLines.push("    pub fn is_terminal(self) -> bool {");
      if (terminalStates.length > 0) {
        const termCond = terminalStates.map((ts) => `self.state == ${ts}`).join(" || ");
        expandedLines.push(`        return ${termCond}`);
      } else {
        expandedLines.push("        return false");
      }
      expandedLines.push("    }");
      expandedLines.push("}");
      continue;
    }

    expandedLines.push(afterSpinIf[idx]);
    idx += 1;
  }

  const joinedSoFar = expandedLines.join("\n");

  function hasManualMethod(structName: string, methodName: string): boolean {
    const implRe = new RegExp(
      `impl\\s+(?:[A-Za-z0-9_]+\\s+for\\s+)?${escapeRegExp(structName)}\\s*\\{([\\s\\S]*?)\\n\\}`,
      "g",
    );
    const fnRe = new RegExp(
      `\\b(?:pub\\s+)?fn\\s+${escapeRegExp(methodName)}\\s*\\([^)]*\\)\\s*(?:->\\s*[^{\n]+)?\\s*\\{`,
    );
    let mBlk: RegExpExecArray | null;
    while ((mBlk = implRe.exec(joinedSoFar)) !== null) {
      if (fnRe.test(mBlk[1])) {
        return true;
      }
    }
    return false;
  }

  // 3. Synthesize `delegate <Trait> to self.<field>` forwarding methods
  for (const [sname, sdecl] of Object.entries(ast.structs)) {
    const fieldNames = new Set(sdecl.fields.map((f) => f.name));
    for (const delDecl of sdecl.delegates) {
      if (!fieldNames.has(delDecl.target_field) || !(delDecl.trait_name in ast.traits)) {
        continue;
      }
      const tdecl = ast.traits[delDecl.trait_name];
      const synthMethods: string[] = [];
      for (const [tmName, tmSpec] of Object.entries(tdecl.methods)) {
        if (hasManualMethod(sname, tmName)) {
          continue;
        }
        const pStrs: string[] = [];
        const callArgs: string[] = [];
        for (const p of tmSpec.params) {
          if (p.name === "self") {
            pStrs.push(p.mode === "mut" ? "mut self" : "self");
          } else {
            const prefix = p.mode === "mut" ? "mut " : p.mode === "own" ? "own " : "";
            pStrs.push(`${prefix}${p.name}: ${p.ty}`);
            callArgs.push(`${prefix}${p.name}`);
          }
        }
        const retS = tmSpec.err_ty ? `${tmSpec.ret_ty} ! ${tmSpec.err_ty}` : tmSpec.ret_ty;
        synthMethods.push(`    pub fn ${tmName}(${pStrs.join(", ")}) -> ${retS} {`);
        let callExpr = `self.${delDecl.target_field}.${tmName}(${callArgs.join(", ")})`;
        if (tmSpec.err_ty) {
          callExpr = `${callExpr}?`;
        }
        if (tmSpec.ret_ty === "void") {
          synthMethods.push(`        ${callExpr}`);
        } else {
          synthMethods.push(`        return ${callExpr}`);
        }
        synthMethods.push("    }");
      }
      if (synthMethods.length > 0) {
        expandedLines.push("");
        expandedLines.push(
          `// @spin synthesized from \`delegate ${delDecl.trait_name} to self.${delDecl.target_field}\``,
        );
        expandedLines.push(`impl ${sname} {`);
        expandedLines.push(...synthMethods);
        expandedLines.push("}");
      }
    }
  }

  // 4. Synthesize `@apply(<pattern>)` methods from `library/patterns/**/*.jnp`
  for (const [sname, sdecl] of Object.entries(ast.structs)) {
    const wireBytes = sdecl.fields.length * 8;
    for (const ann of sdecl.apply_annotations) {
      const patKey = ann.split("(")[0].trim();
      const patCfg = patternsReg[patKey];
      if (!patCfg) {
        continue;
      }
      const synthPatLines: string[] = [];
      for (const mCfg of patCfg.methods ?? []) {
        const mname = mCfg.name;
        if (!hasManualMethod(sname, mname)) {
          for (const tline of mCfg.body_template ?? []) {
            synthPatLines.push(
              String(tline)
                .replaceAll("{Struct}", sname)
                .replaceAll("{wire_bytes}", String(wireBytes)),
            );
          }
        }
      }
      if (synthPatLines.length > 0) {
        expandedLines.push("");
        expandedLines.push(`// @spin synthesized from \`@apply(${ann})\` on \`${sname}\``);
        expandedLines.push(`impl ${sname} {`);
        expandedLines.push(...synthPatLines);
        expandedLines.push("}");
      }
    }
  }

  const finalExpanded = expandedLines.join("\n").trim() + "\n";
  const spunDir = path.join(ROOT_DIR, ".spun");
  fs.mkdirSync(spunDir, { recursive: true });
  const spunFile = path.join(spunDir, `${ast.name}.spun.jn`);
  const header =
    `// Auto-generated white-box expansion by Jenny-Spin v0.4 (.spun/${ast.name}.spun.jn)\n` +
    "// 100% standard Jenny v2.0 code — directly inspectable for debugging & contract verification.\n\n";
  fs.writeFileSync(spunFile, header + finalExpanded, "utf-8");
  ast.spun_path = `.spun/${ast.name}.spun.jn`;
  return [finalExpanded, ast.spun_path];
}

function splitTopLevelCallArgs(rawArgs: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let pDepth = 0;
  let inStr = false;
  let esc = false;
  for (const ch of rawArgs) {
    if (esc) {
      cur += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      cur += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (!inStr) {
      if (ch === "(") {
        pDepth += 1;
      } else if (ch === ")") {
        pDepth -= 1;
      } else if (ch === "," && pDepth === 0) {
        parts.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) {
    parts.push(tail);
  }
  return parts;
}

type SpinTemplate =
  | { kind: "forward"; targetFnName: string; fwdArgTemplates: string[] }
  | {
      kind: "loop";
      preLines: string[];
      itemVar: string;
      branches: [string, string[]][];
      postLines: string[];
    };

function parseSpinForTemplate(bodyLines: string[], packName: string): SpinTemplate {
  const strippedLines = bodyLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (strippedLines.length === 1) {
    const mFwd = /^return\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(
      strippedLines[0],
    );
    if (mFwd && mFwd[2].includes(`...${packName}`)) {
      return {
        kind: "forward",
        targetFnName: mFwd[1],
        fwdArgTemplates: splitTopLevelCallArgs(mFwd[2]),
      };
    }
  }

  const preLines: string[] = [];
  const loopInner: string[] = [];
  const postLines: string[] = [];
  let itemVar = "arg";
  let state: "pre" | "in_for" | "post" = "pre";
  let forDepth = 0;
  const forRe = new RegExp(
    `^@spin\\s+for\\s+([A-Za-z_][A-Za-z0-9_]*)\\s+in\\s+${escapeRegExp(packName)}\\s*\\{$`,
  );

  for (const line of strippedLines) {
    if (state === "pre") {
      const mFor = forRe.exec(line);
      if (mFor) {
        itemVar = mFor[1];
        state = "in_for";
        forDepth = 1;
        continue;
      }
      preLines.push(line);
    } else if (state === "in_for") {
      forDepth += countChar(line, "{") - countChar(line, "}");
      if (forDepth <= 0) {
        state = "post";
      } else {
        loopInner.push(line);
      }
    } else {
      postLines.push(line);
    }
  }

  const branches: [string, string[]][] = [];
  let curCond: string | null = null;
  let curStmts: string[] = [];
  for (const lIn of loopInner) {
    const mIf = /^@spin\s+if\s+(.+?)\s*\{$/.exec(lIn);
    const mElif = /^(?:\}\s*)?else\s+if\s+(.+?)\s*\{$/.exec(lIn);
    const mElse = /^(?:\}\s*)?else\s*\{$/.exec(lIn);
    if (mIf) {
      curCond = mIf[1].trim();
      curStmts = [];
    } else if (mElif) {
      if (curCond !== null) {
        branches.push([curCond, curStmts]);
      }
      curCond = mElif[1].trim();
      curStmts = [];
    } else if (mElse) {
      if (curCond !== null) {
        branches.push([curCond, curStmts]);
      }
      curCond = "else";
      curStmts = [];
    } else if (lIn === "}") {
      if (curCond !== null) {
        branches.push([curCond, curStmts]);
        curCond = null;
        curStmts = [];
      }
    } else if (curCond !== null) {
      curStmts.push(lIn);
    }
  }

  return { kind: "loop", preLines, itemVar, branches, postLines };
}

export function monomorphizeSpinVariadicFunctions(
  ast: ModuleAST,
  jnText = "",
): [string, string | null] {
  const spinFns: Record<string, FnSpec> = {};
  for (const fn of Object.values(ast.functions)) {
    if (fn.is_spin_variadic && fn.body_lines.length > 0) {
      spinFns[fn.name] = fn;
    }
  }
  if (Object.keys(spinFns).length === 0) {
    return [jnText, ast.spun_path];
  }

  const parsedTemplates: Record<string, SpinTemplate> = {};
  for (const [name, fn] of Object.entries(spinFns)) {
    const packParam = fn.params.find((p) => p.mode === "variadic");
    parsedTemplates[name] = parseSpinForTemplate(fn.body_lines, packParam ? packParam.name : "args");
  }

  const instCache = new Map<string, string>();
  const monomorphizedSpecs: Record<string, FnSpec> = {};
  const spunSourceBlocks: string[] = [];

  const fnNamesPat = Object.keys(spinFns)
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const callPat = new RegExp(`\\b(?:[A-Za-z_][A-Za-z0-9_]*(?:::|\\.))?(${fnNamesPat})\\s*\\(`);

  function instantiateCall(
    initialCalledName: string,
    initialRawArgs: string[],
    localVarTypes: Record<string, string>,
  ): string {
    let calledName = initialCalledName;
    let rawArgs = initialRawArgs;
    let tmpl = parsedTemplates[calledName];
    let targetFn = spinFns[calledName];
    if (tmpl.kind === "forward") {
      const packParam = targetFn.params.find((p) => p.mode === "variadic");
      const packName = packParam ? packParam.name : "args";
      const expandedArgs: string[] = [];
      for (const ft of tmpl.fwdArgTemplates) {
        if (ft === `...${packName}`) {
          expandedArgs.push(...rawArgs);
        } else {
          expandedArgs.push(ft);
        }
      }
      calledName = tmpl.targetFnName;
      targetFn = spinFns[calledName];
      tmpl = parsedTemplates[calledName];
      rawArgs = expandedArgs;
    }

    if (tmpl.kind !== "loop") {
      return `${calledName}(${rawArgs.join(", ")})`;
    }
    const { preLines, itemVar, branches, postLines } = tmpl;
    const fixedParams = targetFn.params.filter((p) => p.mode !== "variadic");
    const varParam = targetFn.params.find((p) => p.mode === "variadic") ?? null;
    const boundTrait = varParam && varParam.ty !== "..." ? varParam.ty : null;
    const fixedArgs = rawArgs.slice(0, fixedParams.length);
    const varArgs = rawArgs.slice(fixedParams.length);

    const instParams: ParamDecl[] = [...fixedParams];
    const instCallArgs: string[] = [...fixedArgs];
    const unrolledBody: string[] = [...preLines];

    for (let idx = 0; idx < varArgs.length; idx++) {
      const a = varArgs[idx].trim();
      let argKind = "";
      let sTy = "";
      if (a.startsWith("(") && a.endsWith(")")) {
        const tParts = splitTopLevelCallArgs(a.slice(1, -1).trim());
        const valPart = tParts[0] ? tParts[0].trim() : "";
        const specPart = tParts.length >= 2 ? tParts[1].trim() : "";
        const isValidSpec =
          specPart.startsWith("FmtSpec.") || localVarTypes[specPart] === "FmtSpec";
        const isBadVal =
          valPart.startsWith('"') ||
          localVarTypes[valPart] === "str" ||
          localVarTypes[valPart] === "String" ||
          localVarTypes[valPart] === "bool" ||
          Boolean(localVarTypes[valPart] && localVarTypes[valPart] in ast.structs);
        if ((tParts.length !== 2 && tParts.length !== 3) || !isValidSpec || isBadVal) {
          ast.spin_bound_diagnostics.push({
            code: "E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED",
            severity: "error",
            module: ast.name,
            line: 1,
            function: targetFn.name,
            offending_token: a,
            message: `Variadic format tuple \`${a}\` in call to \`${targetFn.name}\` violates \`...${varParam ? varParam.name : "args"}: ${boundTrait ?? "Formattable"}\`! Expected \`(val_item: FmtSpecInto, spec: FmtSpec, ...params: i64)\`.`,
            suggested_replacement: "(0, FmtSpec.Dec)",
          });
        }
        if (tParts.length === 3) {
          argKind = "tuple3";
          sTy = "(i64, FmtSpec, i64)";
          instParams.push({ mode: "borrow", name: `_arg${idx}`, ty: sTy });
          instCallArgs.push(a);
        } else if (tParts.length === 2) {
          argKind = "tuple2";
          sTy = "(i64, FmtSpec)";
          instParams.push({ mode: "borrow", name: `_arg${idx}`, ty: sTy });
          instCallArgs.push(a);
        }
      } else if (
        localVarTypes[a] === "(i64, FmtSpec, i64)" ||
        localVarTypes[a] === "(i64, FmtSpec)"
      ) {
        sTy = localVarTypes[a];
        argKind = sTy === "(i64, FmtSpec, i64)" ? "tuple3" : "tuple2";
        instParams.push({ mode: "borrow", name: `_arg${idx}`, ty: sTy });
        instCallArgs.push(a);
      }

      if (!argKind) {
        if (
          (a.startsWith('"') && a.endsWith('"')) ||
          localVarTypes[a] === "str" ||
          a.includes(".sub_str(") ||
          a.includes(".slice_str(")
        ) {
          sTy = "str";
        } else if (
          localVarTypes[a] === "String" ||
          a.startsWith("String.") ||
          a.includes("__spin_")
        ) {
          sTy = "String";
        } else if (a === "true" || a === "false" || localVarTypes[a] === "bool") {
          sTy = "bool";
        } else if (a in localVarTypes && localVarTypes[a] in ast.structs) {
          sTy = localVarTypes[a];
        } else {
          const mSc = /^([A-Za-z_][A-Za-z0-9_]*)\./.exec(a);
          if (mSc && mSc[1] in ast.structs) {
            sTy = mSc[1];
          } else {
            sTy = "i64";
          }
        }

        const isFmtInto =
          sTy === "i64" ||
          sTy === "i32" ||
          sTy === "u32" ||
          sTy === "u64" ||
          sTy === "usize" ||
          `${sTy}.fmt_into` in ast.functions;
        const isToStr =
          sTy === "str" ||
          sTy === "String" ||
          sTy === "bool" ||
          sTy in ast.enums ||
          `${sTy}.to_str` in ast.functions;
        if (sTy in ast.structs && boundTrait && !(isFmtInto || isToStr)) {
          ast.spin_bound_diagnostics.push({
            code: "E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED",
            severity: "error",
            module: ast.name,
            line: 1,
            function: targetFn.name,
            offending_token: a,
            message: `Argument \`${a}\` of type \`${sTy}\` in call to \`${targetFn.name}\` does not satisfy variadic trait bound \`...${varParam ? varParam.name : "args"}: ${boundTrait}\` (implement \`FmtInto.fmt_into\` or \`ToStr.to_str\` on \`${sTy}\`)!`,
            suggested_replacement: `impl ToStr for ${sTy} { pub fn to_str(self) -> str { ... } }`,
          });
        }
        argKind = isFmtInto ? "FmtInto" : isToStr ? "ToStr" : `type:${sTy}`;
        instParams.push({ mode: "borrow", name: `_arg${idx}`, ty: sTy });
        instCallArgs.push(a);
      }

      const tupleCondRe = new RegExp(
        `^${escapeRegExp(itemVar)}\\s+is\\s+\\(\\s*([A-Za-z_0-9]+)\\s*,\\s*([A-Za-z_0-9]+)\\s*,\\s*\\.\\.\\.([A-Za-z_0-9]+)\\s*\\)$`,
      );
      const tyCondRe = new RegExp(`^${escapeRegExp(itemVar)}\\s+is\\s+([A-Za-z_0-9]+)$`);
      const itemVarWordRe = new RegExp(`\\b${escapeRegExp(itemVar)}\\b`, "g");

      for (const [bCond, bStmts] of branches) {
        const mTVar = tupleCondRe.exec(bCond);
        if (mTVar && (argKind === "tuple3" || argKind === "tuple2")) {
          const [, vItem, vSpec, vRest] = mTVar;
          const vItemRe = new RegExp(`\\b${escapeRegExp(vItem)}\\b`, "g");
          const vSpecRe = new RegExp(`\\b${escapeRegExp(vSpec)}\\b`, "g");
          const vRest3Re = new RegExp(`\\.\\.\\.${escapeRegExp(vRest)}\\b`, "g");
          const vRest2Re = new RegExp(`,\\s*\\.\\.\\.${escapeRegExp(vRest)}\\b`, "g");
          for (const st of bStmts) {
            let sSub = st.replace(vItemRe, `_arg${idx}.0`).replace(vSpecRe, `_arg${idx}.1`);
            if (argKind === "tuple3") {
              sSub = sSub.replace(vRest3Re, `_arg${idx}.2`);
            } else {
              sSub = sSub.replace(vRest2Re, "");
            }
            unrolledBody.push(sSub);
          }
          break;
        }
        const mTy = tyCondRe.exec(bCond);
        if (mTy) {
          const condTarget = mTy[1];
          if (
            (condTarget === "FmtInto" && argKind === "FmtInto") ||
            (condTarget === "ToStr" && argKind === "ToStr") ||
            sTy === condTarget
          ) {
            for (const st of bStmts) {
              unrolledBody.push(st.replace(itemVarWordRe, `_arg${idx}`));
            }
            break;
          }
        }
        if (bCond === "else") {
          for (const st of bStmts) {
            unrolledBody.push(st.replace(itemVarWordRe, `_arg${idx}`));
          }
          break;
        }
      }
    }

    unrolledBody.push(...postLines);
    const canonSig = `${targetFn.name}(${instParams.map((p) => p.ty).join(",")})->${targetFn.ret_ty}`;
    let instName = instCache.get(canonSig);
    if (!instName) {
      const sigHash = crypto.createHash("sha256").update(canonSig, "utf-8").digest("hex").slice(0, 8);
      instName = `${targetFn.name}__spin_${sigHash}`;
      instCache.set(canonSig, instName);
      monomorphizedSpecs[instName] = createFnSpec(
        instName,
        null,
        instParams,
        targetFn.ret_ty,
        targetFn.err_ty,
        {
          effects: [...targetFn.effects],
          requires: [...targetFn.requires],
          ensures: [...targetFn.ensures],
          body_lines: unrolledBody,
        },
      );
      const pSigStr = instParams.map((p) => `${p.name}: ${p.ty}`).join(", ");
      const spunLines = [
        `// @spin monomorphized from \`${targetFn.name}\` [signature: (${instParams.map((p) => p.ty).join(", ")})]`,
        `pub fn ${instName}(${pSigStr}) -> ${targetFn.ret_ty} {`,
        ...unrolledBody.map((ub) => `    ${ub}`),
        "}",
      ];
      const blockText = spunLines.join("\n");
      spunSourceBlocks.push(blockText);
      const spinPoolDir = path.join(ROOT_DIR, ".jenny-cache", "spin");
      fs.mkdirSync(spinPoolDir, { recursive: true });
      fs.writeFileSync(path.join(spinPoolDir, `${instName}.spun.jn`), blockText + "\n", "utf-8");
    }

    return `${instName}(${instCallArgs.join(", ")})`;
  }

  function expandLinesInScope(linesList: string[], initVars: Record<string, string>): string[] {
    const localVars: Record<string, string> = { ...initVars };
    const newLines: string[] = [];
    for (const line of linesList) {
      let cur = line;
      while (true) {
        const m = callPat.exec(cur);
        if (!m || m.index === undefined) {
          break;
        }
        const calledFnName = m[1];
        const startI = m.index;
        const openP = m.index + m[0].length - 1;
        let pDepth = 0;
        let inS = false;
        let esc = false;
        let closeP = -1;
        for (let idxC = openP; idxC < cur.length; idxC++) {
          const ch = cur[idxC];
          if (esc) {
            esc = false;
            continue;
          }
          if (ch === "\\") {
            esc = true;
            continue;
          }
          if (ch === '"') {
            inS = !inS;
            continue;
          }
          if (!inS) {
            if (ch === "(") {
              pDepth += 1;
            } else if (ch === ")") {
              pDepth -= 1;
              if (pDepth === 0) {
                closeP = idxC;
                break;
              }
            }
          }
        }
        if (closeP === -1) {
          break;
        }
        const innerS = cur.slice(openP + 1, closeP).trim();
        const rawCallArgs = innerS ? splitTopLevelCallArgs(innerS) : [];
        const replCall = instantiateCall(calledFnName, rawCallArgs, localVars);
        cur = cur.slice(0, startI) + replCall + cur.slice(closeP + 1);
      }

      const mDecl = /^\s*(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(cur);
      if (mDecl) {
        const vname = mDecl[1];
        const rhsS = mDecl[2].trim().replace(/[!?]+$/, "");
        if (rhsS.startsWith("(") && rhsS.endsWith(")")) {
          const tElems = splitTopLevelCallArgs(rhsS.slice(1, -1).trim());
          if (tElems.length === 3 && tElems[0].trim().startsWith('"')) {
            ast.spin_bound_diagnostics.push({
              code: "E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED",
              severity: "error",
              module: ast.name,
              line: 1,
              function: "format",
              offending_token: rhsS,
              message: `Format tuple \`${rhsS}\` violates \`Formattable\` bound (\`FmtSpecInto\` requires numeric value, got \`str\`)!`,
              suggested_replacement: "(0, FmtSpec.Dec, 4)",
            });
          }
          localVars[vname] = tElems.length === 3 ? "(i64, FmtSpec, i64)" : "(i64, FmtSpec)";
        } else if (
          rhsS.includes("__spin_") ||
          rhsS.includes(".to_sso_string(") ||
          rhsS.startsWith("String.")
        ) {
          localVars[vname] = "String";
        } else if (rhsS.startsWith('"')) {
          localVars[vname] = "str";
        } else if (rhsS === "true" || rhsS === "false") {
          localVars[vname] = "bool";
        } else {
          for (const snameCand of Object.keys(ast.structs)) {
            const structLitRe = new RegExp(`^${escapeRegExp(snameCand)}\\s*\\{`);
            if (rhsS.startsWith(`${snameCand}.`) || structLitRe.test(rhsS)) {
              localVars[vname] = snameCand;
              break;
            }
          }
        }
      }
      newLines.push(cur);
    }
    return newLines;
  }

  for (const fn of Object.values(ast.functions)) {
    if (fn.is_spin_variadic || fn.body_lines.length === 0) {
      continue;
    }
    const initV: Record<string, string> = {};
    for (const p of fn.params) {
      initV[p.name] = p.ty;
    }
    fn.body_lines = expandLinesInScope(fn.body_lines, initV);
  }

  for (const ex of ast.examples) {
    ex.body_lines = expandLinesInScope(ex.body_lines, {});
  }

  let outJnText = jnText;
  if (Object.keys(monomorphizedSpecs).length > 0) {
    Object.assign(ast.functions, monomorphizedSpecs);
    const blocksJoined = spunSourceBlocks.join("\n\n");
    if (outJnText) {
      outJnText = outJnText.trimEnd() + "\n\n" + blocksJoined + "\n";
    }
    if (ast.spun_path) {
      const spunFile = path.join(ROOT_DIR, ast.spun_path);
      if (fs.existsSync(spunFile)) {
        const existing = fs.readFileSync(spunFile, "utf-8").trimEnd();
        fs.writeFileSync(spunFile, existing + "\n\n" + blocksJoined + "\n", "utf-8");
      }
    }
  }

  return [outJnText, ast.spun_path];
}

export function distillBoilerplate(targetPath: string): Record<string, any> {
  const resolved = path.resolve(targetPath);
  const s3Root =
    fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
      ? resolved
      : path.dirname(resolved);
  const bdirs = fs.existsSync(path.join(s3Root, "B18_trait_delegate_decorator"))
    ? fs
        .readdirSync(s3Root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(s3Root, d.name))
        .sort()
    : [s3Root];

  const reports: Record<string, any>[] = [];
  for (const bdir of bdirs) {
    const entries = fs.readdirSync(bdir);
    const jniName = entries.find((e) => e.endsWith(".jni"));
    const jnName = entries.find((e) => e.endsWith(".jn"));
    const rsName = entries.find((e) => e.endsWith(".rs"));
    if (!jniName || !jnName || !rsName) {
      continue;
    }
    const jniFile = path.join(bdir, jniName);
    const jnFile = path.join(bdir, jnName);
    const rsFile = path.join(bdir, rsName);
    const modName = path.basename(jnName, ".jn");

    const jniText = fs.readFileSync(jniFile, "utf-8");
    const jnText = fs.readFileSync(jnFile, "utf-8");
    const rsText = fs.readFileSync(rsFile, "utf-8");

    const ast = parseJniBlueprint(jniText);
    attachJnImplementations(ast, jnText);

    const spunFile = path.join(ROOT_DIR, ".spun", `${modName}.spun.jn`);
    const nonCommentLines = (txt: string) =>
      txt
        .replace(/\r\n/g, "\n")
        .split("\n")
        .filter((l) => l.trim().length > 0 && !l.trim().startsWith("//"));

    const jnLines = nonCommentLines(jnText);
    const spunLines = fs.existsSync(spunFile)
      ? nonCommentLines(fs.readFileSync(spunFile, "utf-8"))
      : jnLines;
    const rsLines = nonCommentLines(rsText);

    let patternDetected = "delegate Trait to self.field";
    if (jnText.includes("@spin fsm::state_machine")) {
      patternDetected = "@spin fsm::state_machine";
    } else if (jniText.includes("@apply(codec::binary)")) {
      patternDetected = "@apply(codec::binary) + @spin if";
    } else if (jniText.includes("@apply(crud::service")) {
      patternDetected = "@apply(crud::service(...))";
    }

    reports.push({
      benchmark: path.basename(bdir),
      module: modName,
      spindle_pattern: patternDetected,
      spun_expanded_lines: spunLines.length,
      rust_baseline_lines: rsLines.length,
      distilled_jn_lines: jnLines.length,
      line_compression_vs_spun: Number((jnLines.length / Math.max(1, spunLines.length)).toFixed(4)),
      line_compression_vs_rust: Number((jnLines.length / Math.max(1, rsLines.length)).toFixed(4)),
      spun_file: `.spun/${modName}.spun.jn`,
    });
  }

  return {
    tool: "jenny --distill (Stage 3 AST Boilerplate Distiller)",
    modules_analyzed: reports.length,
    reports,
  };
}
