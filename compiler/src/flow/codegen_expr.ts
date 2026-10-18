import fs from "node:fs";
import path from "node:path";
import type { FnSpec, ModuleAST } from "./ast.ts";
import { ROOT_DIR } from "./ast.ts";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isClosureType(ty: string): boolean {
  return /^(\*|\^)?fn\s*\(/.test(ty.trim());
}

export function isStructPtrType(ty: string): boolean {
  const s = ty.trim();
  return (s.startsWith("*") || s.startsWith("^")) && !isClosureType(s);
}

export function mapCType(ty: string): string {
  const jnTy = ty.trim();
  if (jnTy.startsWith("(") && jnTy.endsWith(")")) {
    const tElems = jnTy
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return "JnTuple_" + tElems.map((x) => x.replace(/[^A-Za-z0-9_]/g, "")).join("_");
  }
  if (/^fn\s*\(/.test(jnTy)) {
    return "JnFn_i64_to_i64";
  }
  if (/^\*fn\s*\(/.test(jnTy)) {
    return "JnBoxFn_i64_to_i64";
  }
  if (/^\^fn\s*\(/.test(jnTy)) {
    return "JnGcFn_i64_to_i64";
  }
  if (jnTy.startsWith("dyn ")) {
    const tname = jnTy.slice(4).trim();
    return `JnDyn_${tname}`;
  }
  if (jnTy.startsWith("*")) {
    const inner = jnTy.slice(1).trim();
    return `struct ${inner}*`;
  }
  if (jnTy.startsWith("^")) {
    const inner = jnTy.slice(1).replace(/\?+$/, "").trim();
    return `struct ${inner}*`;
  }
  if (jnTy.endsWith("?")) {
    const base = jnTy.slice(0, -1).trim();
    return `JnOpt_${base}`;
  }
  const mArr = /^\[(\d+)\](.+)$/.exec(jnTy);
  if (mArr) {
    return mapCType(mArr[2]);
  }
  const mapping: Record<string, string> = {
    i8: "int8_t",
    u8: "uint8_t",
    i16: "int16_t",
    u16: "uint16_t",
    i32: "int32_t",
    i64: "int64_t",
    u32: "uint32_t",
    u64: "uint64_t",
    usize: "size_t",
    f64: "double",
    bool: "bool",
    str: "jn_str",
    String: "JnString",
    void: "int32_t",
    Arena: "JnArena",
  };
  return mapping[jnTy] ?? jnTy;
}

export function cFnName(fn: FnSpec): string {
  if (fn.struct_owner) {
    return `${fn.struct_owner}_${fn.name}`;
  }
  return fn.name;
}

export function resultTypedefName(fn: FnSpec): string {
  return `Res_${cFnName(fn)}`;
}

/**
 * Expand left-to-right pipe chains `lhs |> fn1(a) |> fn2(b, c)`
 * into standard nested calls `fn2(fn1(lhs, a), b, c)`.
 */
export function expandPipeOperator(s: string): string {
  if (!s.includes("|>")) {
    return s;
  }
  const stages = s.split("|>").map((st) => st.trim());
  let acc = stages[0];
  for (const stage of stages.slice(1)) {
    const mCall = /^([A-Za-z_][A-Za-z0-9_.]*)\((.*)\)$/.exec(stage);
    if (mCall) {
      const fname = mCall[1];
      const argsStr = mCall[2].trim();
      if (!argsStr) {
        acc = `${fname}(${acc})`;
      } else {
        const splitArgs = argsStr.split(",").map((a) => a.trim());
        if (splitArgs.includes("_")) {
          const replacedArgs = splitArgs.map((a) => (a === "_" ? acc : a));
          acc = `${fname}(${replacedArgs.join(", ")})`;
        } else {
          acc = `${fname}(${acc}, ${argsStr})`;
        }
      }
    } else {
      acc = `${stage}(${acc})`;
    }
  }
  return acc;
}

/**
 * Verify and normalize named arguments at call sites `fn_name(k1: v1, k2: v2)`
 * against the parameter order declared in `.jni`.
 */
export function normalizeNamedArgsInCall(s: string, ast: ModuleAST): string {
  return s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\(((?:[^()]|\([^()]*\))*)\)/g,
    (fullMatch, fname: string, rawArgs: string) => {
      const argsBody = rawArgs.trim();
      if (!argsBody || !argsBody.includes(":")) {
        return fullMatch;
      }
      const fspec = ast.functions[fname];
      if (!fspec) {
        return fullMatch;
      }
      const rawParts = argsBody.split(",").map((p) => p.trim());
      const argMap: Record<string, string> = {};
      const positional: string[] = [];
      for (const p of rawParts) {
        if (p.includes(":") && !p.startsWith('"')) {
          const colonIdx = p.indexOf(":");
          const k = p.slice(0, colonIdx).trim();
          const v = p.slice(colonIdx + 1).trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            argMap[k] = v;
          } else {
            positional.push(p);
          }
        } else {
          positional.push(p);
        }
      }
      if (Object.keys(argMap).length === 0) {
        return fullMatch;
      }
      const nonSelfParams = fspec.params.filter((param) => param.name !== "self").map((param) => param.name);
      const orderedVals: string[] = [];
      for (let idx = 0; idx < nonSelfParams.length; idx++) {
        const pname = nonSelfParams[idx];
        if (pname in argMap) {
          orderedVals.push(argMap[pname]);
        } else if (idx < positional.length) {
          orderedVals.push(positional[idx]);
        } else {
          throw new Error(`Missing argument \`${pname}\` in call to \`${fname}\``);
        }
      }
      return `${fname}(${orderedVals.join(", ")})`;
    },
  );
}

let builtinDispatchCache: Record<string, any> | null = null;
let stdFuzzHarnessCache: Record<string, string[]> | null = null;

export function loadBuiltinDispatch(): Record<string, any> {
  if (builtinDispatchCache !== null) {
    return builtinDispatchCache;
  }
  const p = path.join(ROOT_DIR, "library", "std", "rt", "builtin_dispatch.json");
  if (fs.existsSync(p)) {
    try {
      builtinDispatchCache = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, any>;
      return builtinDispatchCache;
    } catch {
      // fall through
    }
  }
  builtinDispatchCache = {};
  return builtinDispatchCache;
}

export function loadStdFuzzHarnesses(): Record<string, string[]> {
  if (stdFuzzHarnessCache !== null) {
    return stdFuzzHarnessCache;
  }
  const p = path.join(ROOT_DIR, "library", "std", "fuzz_harnesses.json");
  if (fs.existsSync(p)) {
    try {
      stdFuzzHarnessCache = JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, string[]>;
      return stdFuzzHarnessCache;
    } catch {
      // fall through
    }
  }
  stdFuzzHarnessCache = {};
  return stdFuzzHarnessCache;
}

export function translateExpr(
  expr: string,
  ast: ModuleAST,
  currentFn: FnSpec | null = null,
  oldMap: Record<string, string> | null = null,
  ptrVars: Set<string> | null = null,
  varTypes: Record<string, string> | null = null,
): string {
  let s = expr.trim();
  const pVars = ptrVars ?? new Set<string>();
  const vTypes = varTypes ?? {};

  // 1. Expand pipe operator `|>`
  s = expandPipeOperator(s);

  // 2. Normalize named arguments `f(k: v, ...)` before expanding inner call macros
  s = normalizeNamedArgsInCall(s, ast);

  // 3. Replace `old(...)` snapshots
  if (oldMap) {
    for (const [origOld, snapVar] of Object.entries(oldMap)) {
      s = s.replaceAll(`old(${origOld})`, snapVar);
    }
  }

  // 4. Replace inline `if cond { a } else if cond2 { b } else { c }` or `if cond { a } else { b }` expression with C ternary
  const mIfElifExpr =
    /^if\s+(.+?)\s*\{\s*(.+?)\s*\}\s*else\s+if\s+(.+?)\s*\{\s*(.+?)\s*\}\s*else\s*\{\s*(.+?)\s*\}$/.exec(s);
  if (mIfElifExpr) {
    const cCond1 = translateExpr(mIfElifExpr[1], ast, currentFn, oldMap, pVars, vTypes);
    const cA = translateExpr(mIfElifExpr[2], ast, currentFn, oldMap, pVars, vTypes);
    const cCond2 = translateExpr(mIfElifExpr[3], ast, currentFn, oldMap, pVars, vTypes);
    const cB = translateExpr(mIfElifExpr[4], ast, currentFn, oldMap, pVars, vTypes);
    const cC = translateExpr(mIfElifExpr[5], ast, currentFn, oldMap, pVars, vTypes);
    return `((${cCond1}) ? (${cA}) : ((${cCond2}) ? (${cB}) : (${cC})))`;
  }

  const mIfExpr = /^if\s+(.+?)\s*\{\s*(.+?)\s*\}\s*else\s*\{\s*(.+?)\s*\}$/.exec(s);
  if (mIfExpr) {
    const cCond = translateExpr(mIfExpr[1], ast, currentFn, oldMap, pVars, vTypes);
    const cA = translateExpr(mIfExpr[2], ast, currentFn, oldMap, pVars, vTypes);
    const cB = translateExpr(mIfExpr[3], ast, currentFn, oldMap, pVars, vTypes);
    return `((${cCond}) ? (${cA}) : (${cB}))`;
  }

  // 5. Handle null-coalescing `a ?? b` -> `jn_coalesce_i64(a, b)`
  if (s.includes("??")) {
    const qIdx = s.indexOf("??");
    const lhsOpt = s.slice(0, qIdx).trim();
    const rhsDef = s.slice(qIdx + 2).trim();
    const cLhs = translateExpr(lhsOpt, ast, currentFn, oldMap, pVars, vTypes);
    const cRhs = translateExpr(rhsDef, ast, currentFn, oldMap, pVars, vTypes);
    return `jn_coalesce_i64(${cLhs}, ${cRhs})`;
  }

  // 5c. Handle `match <scrut> { pat1 => val1, pat2 => val2, _ => default }`
  const mMatch = /^(?:return\s+)?match\s+([^{]+)\s*\{(.+)\}$/.exec(s);
  if (mMatch) {
    const scrut = mMatch[1].trim();
    const armsRaw = mMatch[2]
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const arms: Array<[string, string]> = [];
    let defaultArm = "0";
    for (const arm of armsRaw) {
      if (!arm.includes("=>")) {
        continue;
      }
      const arrowIdx = arm.indexOf("=>");
      const pat = arm.slice(0, arrowIdx).trim();
      let rhsV = arm.slice(arrowIdx + 2).trim();
      if (rhsV.includes("unreachable")) {
        rhsV = "0";
      }
      if (pat === "_") {
        defaultArm = rhsV;
      } else {
        arms.push([pat, rhsV]);
      }
    }
    let tern = defaultArm;
    for (let i = arms.length - 1; i >= 0; i--) {
      const [pat, rhsV] = arms[i];
      tern = `((${scrut}) == (${pat}) ? (${rhsV}) : (${tern}))`;
    }
    s = tern;
  }

  // 6. Handle `some(v)` and `null`
  s = s.replace(/\bsome\(([^)]+)\)/g, "jn_some_i64($1)");
  const hasI64Opt = Object.values(ast.functions).some((f) => f.params.some((p) => p.ty.includes("i64?")));
  s = s.replace(/\bnull\b/g, hasI64Opt ? "jn_null_i64()" : "NULL");

  // 7. Handle built-in runtime functions & static constructors via `library/std/rt/builtin_dispatch.json`
  const bdisp = loadBuiltinDispatch();
  for (const [gCall, cCall] of Object.entries((bdisp.global_functions ?? {}) as Record<string, string>)) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(gCall)}`, "g"), () => cCall);
  }
  for (const [sCtor, cCtor] of Object.entries((bdisp.static_constructors ?? {}) as Record<string, string>)) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(sCtor)}\\s*\\(`, "g"), () => `${cCtor}(`);
  }

  const arenaMethods: string[] = bdisp.arena_methods ?? ["alloc_count", "used_bytes", "reset", "drop"];
  const arenaMPat = arenaMethods.map(escapeRegExp).join("|");
  s = s.replace(
    new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.(${arenaMPat})\\(\\)`, "g"),
    (fullMatch, recv: string, mname: string) => {
      const rawKnownTy =
        recv === "self" && currentFn && currentFn.struct_owner
          ? currentFn.struct_owner
          : (vTypes[recv] ?? "");
      const knownTy = rawKnownTy.replace(/^[*^]+/, "").replace(/\?+$/, "");
      if (knownTy in ast.structs) {
        return fullMatch;
      }
      const recvArg = pVars.has(recv) ? recv : `&${recv}`;
      return `Arena_${mname}(${recvArg})`;
    },
  );

  // 7a. Handle first-class Tuple indexing and primitive type methods (`str`, `String`, `bool`) via dispatch table
  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.([0-9]+)\b/g,
    (fullMatch, recv: string, idxStr: string, offset: number, wholeStr: string) => {
      let quoteCount = 0;
      for (let i = 0; i < offset; i++) {
        if (wholeStr[i] === '"') {
          quoteCount += 1;
        }
      }
      if (quoteCount % 2 === 1) {
        return fullMatch;
      }
      if (recv in vTypes && !vTypes[recv].startsWith("(")) {
        return fullMatch;
      }
      return `${recv}.f${idxStr}`;
    },
  );

  const primMethods = (bdisp.primitive_type_methods ?? {}) as Record<string, Record<string, string>>;
  const strM = primMethods.str ?? {};
  const stringM = primMethods.String ?? {};
  const boolM = primMethods.bool ?? {};

  const resolveRecvTy = (recv: string): string | undefined => {
    return recv === "self" && currentFn && currentFn.struct_owner
      ? currentFn.struct_owner
      : vTypes[recv];
  };

  s = s.replace(
    /\b((?:[A-Za-z_][A-Za-z0-9_]*(?:\.|->))*[A-Za-z_][A-Za-z0-9_]*)\.len\(\)/g,
    (fullMatch, recv: string) => {
      const knownTy = resolveRecvTy(recv);
      if (knownTy === "String") {
        return `${stringM.len ?? "jn_string_len"}(${recv})`;
      }
      if (knownTy && knownTy in ast.structs) {
        return fullMatch;
      }
      return `${strM.len ?? "jn_str_len"}(${recv})`;
    },
  );

  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.byte_at\(([^)]+)\)/g,
    (fullMatch, recv: string, arg: string) => {
      const knownTy = resolveRecvTy(recv);
      if (knownTy === "String") {
        return `${stringM.byte_at ?? "jn_string_byte_at"}(${recv}, ${arg})`;
      }
      if (knownTy && knownTy in ast.structs) {
        return fullMatch;
      }
      return `${strM.byte_at ?? "jn_str_byte_at"}(${recv}, ${arg})`;
    },
  );

  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.is_sso\(\)/g, (fullMatch, recv: string) => {
    const knownTy = resolveRecvTy(recv);
    if (knownTy && knownTy in ast.structs) {
      return fullMatch;
    }
    return `${stringM.is_sso ?? "jn_string_is_sso"}(${recv})`;
  });

  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.eq_str\(([^)]+)\)/g,
    (fullMatch, recv: string, arg: string) => {
      const knownTy = resolveRecvTy(recv);
      if (knownTy === "String") {
        return `${stringM.eq_str ?? "jn_string_eq_str"}(${recv}, ${arg})`;
      }
      if (knownTy && knownTy in ast.structs) {
        return fullMatch;
      }
      return `${strM.eq_str ?? "jn_str_eq"}(${recv}, ${arg})`;
    },
  );

  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.sub_str\(([^)]+)\)/g,
    (fullMatch, recv: string, args: string) => {
      const knownTy = resolveRecvTy(recv);
      if (knownTy && knownTy in ast.structs) {
        return fullMatch;
      }
      return `${strM.sub_str ?? "jn_str_sub"}(${recv}, ${args})`;
    },
  );

  s = s.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\.to_str\(\)/g, (fullMatch, recv: string) => {
    const knownTy = resolveRecvTy(recv);
    if (knownTy && knownTy in ast.structs) {
      return fullMatch;
    }
    if (knownTy === "String") {
      return `${stringM.to_str ?? "jn_string_as_str"}(&${recv})`;
    }
    if (knownTy === "bool") {
      return `${boolM.to_str ?? "jn_bool_to_str"}(${recv})`;
    }
    return recv;
  });

  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.as_raw_ptr\(\)/g,
    `${strM.as_raw_ptr ?? "jn_str_as_raw_ptr"}($1)`,
  );
  for (const calias of Object.keys(ast.c_imports)) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(calias)}\\.([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`, "g"), "$1(");
  }

  // 7b. Handle call-site `mut x` and `own x` argument modifiers
  s = s.replace(/\bmut\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, (_m, v: string) =>
    pVars.has(v) ? v : `&${v}`,
  );
  s = s.replace(/\bown\s+([A-Za-z_][A-Za-z0-9_]*)\b/g, "$1");

  // 7c. Handle scalar trait forwarding via `scalar_trait_forwards` in `builtin_dispatch.json`
  const stFwds = (bdisp.scalar_trait_forwards ?? {}) as Record<string, string>;
  const fmtIntoC = stFwds.fmt_into ?? "FmtBuffer_put_i64";
  const fmtSpecC = stFwds.fmt_spec_into ?? "FmtBuffer_put_spec";

  s = s.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*)\.fmt_into\((&?[A-Za-z_][A-Za-z0-9_]*),\s*([^)]+)\)/g,
    (fullMatch, recv: string, fbArg: string) => {
      const knownTy = vTypes[recv];
      if (knownTy && knownTy in ast.structs) {
        return fullMatch;
      }
      return `${fmtIntoC}(${fbArg.trim()}, ${recv})`;
    },
  );
  s = s.replace(
    /\b([A-Za-z0-9_.]+)\.fmt_spec_into\((&?[A-Za-z_][A-Za-z0-9_]*),\s*([^,]+),\s*([^,)]+),\s*([^,)]+)\)/g,
    `${fmtSpecC}($2, $3, $1, $4, $5)`,
  );
  s = s.replace(
    /\b([A-Za-z0-9_.]+)\.fmt_spec_into\((&?[A-Za-z_][A-Za-z0-9_]*),\s*([^,]+),\s*([^,)]+)\)/g,
    `${fmtSpecC}($2, $3, $1, $4, 0)`,
  );

  // 8. Replace string literals "abc" with jn_mk_str("abc")
  s = s.replace(/"(?:\\.|[^"\\])*"/g, (lit: string, offset: number, wholeStr: string) => {
    if (offset >= 10 && wholeStr.slice(offset - 10, offset) === "jn_mk_str(") {
      return lit;
    }
    return `jn_mk_str(${lit})`;
  });

  // 9. Replace `x.as<T>()` with `((c_type)(x))`
  s = s.replace(
    /([A-Za-z0-9_.]+)\.as<([A-Za-z0-9_]+)>\(\)/g,
    (_m, inner: string, tyName: string) => {
      const targetT = mapCType(tyName);
      return `((${targetT})(${inner}))`;
    },
  );

  // 10. Replace Enum.Variant with ErrTag_Enum_Variant and lower first-class enum-tagged tuples `(val, Enum.X[, param])`
  for (const [ename, edecl] of Object.entries(ast.enums)) {
    const escEname = escapeRegExp(ename);
    for (const v of edecl.variants) {
      s = s.replace(new RegExp(`\\b${escEname}\\.${escapeRegExp(v)}\\b`, "g"), `ErrTag_${ename}_${v}`);
    }
    s = s.replace(
      new RegExp(`\\(([^(),]+),\\s*(ErrTag_${escEname}_[A-Za-z0-9_]+),\\s*([^(),]+)\\)`, "g"),
      `((JnTuple_i64_${ename}_i64){ $1, $2, $3 })`,
    );
    s = s.replace(
      new RegExp(`\\(([^(),]+),\\s*(ErrTag_${escEname}_[A-Za-z0-9_]+)\\)`, "g"),
      `((JnTuple_i64_${ename}){ $1, $2 })`,
    );
  }

  // 11. Replace static Struct methods (`Struct.new(...)`, `Struct.decode_header(...)`) with `Struct_method(...)`
  for (const sname of Object.keys(ast.structs)) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(sname)}\\.new\\s*\\(`, "g"), `${sname}_new(`);
  }
  for (const fspec of Object.values(ast.functions)) {
    if (fspec.struct_owner && !fspec.params.some((p) => p.name === "self")) {
      s = s.replace(
        new RegExp(`\\b${escapeRegExp(fspec.struct_owner)}\\.${escapeRegExp(fspec.name)}\\s*\\(`, "g"),
        `${cFnName(fspec)}(`,
      );
    }
  }

  // 11b. Replace `dyn Trait` method calls (`engine.capacity()` -> `engine.vtable->capacity(engine.data)`)
  for (const [vname, vty] of Object.entries(vTypes)) {
    const escVname = escapeRegExp(vname);
    if (vty.startsWith("dyn ")) {
      const tname = vty.slice(4).trim();
      const traitDecl = ast.traits[tname];
      if (traitDecl) {
        for (const tmName of Object.keys(traitDecl.methods)) {
          s = s.replace(
            new RegExp(`\\b${escVname}\\.${escapeRegExp(tmName)}\\(((?:[^()]|\\([^()]*\\))*)\\)`, "g"),
            (_m, rawArgs: string) => {
              const args = rawArgs.trim();
              if (args) {
                return `${vname}.vtable->${tmName}(${vname}.data, ${args})`;
              }
              return `${vname}.vtable->${tmName}(${vname}.data)`;
            },
          );
        }
      }
    } else if (isClosureType(vty)) {
      s = s.replace(
        new RegExp(`\\b${escVname}\\(((?:[^()]|\\([^()]*\\))*)\\)`, "g"),
        (_m, rawArgs: string) => {
          const args = rawArgs.trim();
          if (args) {
            return `${vname}.call(${vname}.env, ${args})`;
          }
          return `${vname}.call(${vname}.env, 0)`;
        },
      );
    }
  }

  // 11c. Replace `<var>.<field>.<method>(args)` calls
  const structHolders: Record<string, string> = {};
  if (currentFn && currentFn.struct_owner && currentFn.struct_owner in ast.structs) {
    structHolders.self = currentFn.struct_owner;
  }
  for (const [vname, vty] of Object.entries(vTypes)) {
    if (vty in ast.structs) {
      structHolders[vname] = vty;
    }
  }
  for (const [holderVar, holderTy] of Object.entries(structHolders)) {
    const ownerStruct = ast.structs[holderTy];
    for (const fld of ownerStruct.fields) {
      if (fld.ty in ast.structs) {
        for (const fspec of Object.values(ast.functions)) {
          if (fspec.struct_owner === fld.ty && fspec.params.some((p) => p.name === "self")) {
            const mname = fspec.name;
            const cname = cFnName(fspec);
            const accessOp = pVars.has(holderVar) ? "->" : ".";
            s = s.replace(
              new RegExp(
                `\\b${escapeRegExp(holderVar)}\\.${escapeRegExp(fld.name)}\\.${escapeRegExp(mname)}\\(((?:[^()]|\\([^()]*\\))*)\\)`,
                "g",
              ),
              (_m, rawArgs: string) => {
                const args = rawArgs.trim();
                if (args) {
                  return `${cname}(&${holderVar}${accessOp}${fld.name}, ${args})`;
                }
                return `${cname}(&${holderVar}${accessOp}${fld.name})`;
              },
            );
          }
        }
      }
    }
  }

  // 12. Replace method calls on structs (run 2 passes to support nested `self.m1(self.m2(x))`)
  for (let pass = 0; pass < 2; pass++) {
    for (const fspec of Object.values(ast.functions)) {
      if (fspec.struct_owner && fspec.params.some((p) => p.name === "self")) {
        const mname = fspec.name;
        const cname = cFnName(fspec);
        const ownerTy = fspec.struct_owner;
        s = s.replace(
          new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)\\.${escapeRegExp(mname)}\\(((?:[^()]|\\([^()]*\\))*)\\)`, "g"),
          (fullMatch, recv: string, rawArgs: string) => {
            const args = rawArgs.trim();
            const knownTy =
              recv === "self" && currentFn && currentFn.struct_owner
                ? currentFn.struct_owner
                : vTypes[recv];
            if (knownTy && knownTy in ast.structs && knownTy !== ownerTy) {
              return fullMatch;
            }
            const recvArg = pVars.has(recv) ? recv : `&${recv}`;
            if (args) {
              return `${cname}(${recvArg}, ${args})`;
            }
            return `${cname}(${recvArg})`;
          },
        );
      }
    }
  }

  // 12b. Wrap concrete struct arguments passed to `dyn Trait` parameters in 16-byte fat pointer `(JnDyn_Trait){ ... }`
  for (const fspec of Object.values(ast.functions)) {
    if (!fspec.struct_owner && fspec.params.length === 1 && fspec.params[0].ty.startsWith("dyn ")) {
      const tname = fspec.params[0].ty.slice(4).trim();
      const fname = fspec.name;
      s = s.replace(
        new RegExp(`\\b${escapeRegExp(fname)}\\(([A-Za-z_][A-Za-z0-9_]*)\\)`, "g"),
        (fullMatch, rawArg: string) => {
          const arg = rawArg.trim();
          const argTy = vTypes[arg];
          if (argTy && argTy in ast.structs) {
            const ptrExpr = pVars.has(arg) ? arg : `&${arg}`;
            return `${fname}((JnDyn_${tname}){ .data = (void*)${ptrExpr}, .vtable = &JnVTable_${tname}_for_${argTy} })`;
          }
          return fullMatch;
        },
      );
    }
  }

  // 13. Replace pointer field accesses `self.` -> `self->` and chained `->next.` -> `->next->`
  for (const pv of pVars) {
    s = s.replace(new RegExp(`\\b${escapeRegExp(pv)}\\.`, "g"), `${pv}->`);
  }
  s = s.replace(/->(next|prev|lhs|rhs)\./g, "->$1->");

  // 14. Replace string equality / inequality `a == jn_mk_str(...)` and `a != jn_mk_str(...)`
  s = s.replace(/([A-Za-z0-9_.\->]+)\s*==\s*(jn_mk_str\([^)]*\))/g, "jn_str_eq($1, $2)");
  s = s.replace(/([A-Za-z0-9_.\->]+)\s*!=\s*(jn_mk_str\([^)]*\))/g, "(!jn_str_eq($1, $2))");

  return s;
}

export function parseStructFieldInits(
  rawFieldsStr: string,
  ast: ModuleAST,
  fspec: FnSpec | null,
  ptrVars: Set<string>,
  structName: string | null = null,
  varTypes: Record<string, string> | null = null,
): string {
  const parts: string[] = [];
  let cur = "";
  let bracketDepth = 0;
  for (const ch of rawFieldsStr) {
    if (ch === "(" || ch === "[") {
      bracketDepth += 1;
    } else if (ch === ")" || ch === "]") {
      bracketDepth -= 1;
    }
    if (ch === "," && bracketDepth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) {
    parts.push(cur.trim());
  }

  const sdecl = structName ? ast.structs[structName] : undefined;
  const defaultMap: Record<string, string> = {};
  if (sdecl) {
    for (const f of sdecl.fields) {
      if (f.defaultVal !== null && f.defaultVal !== undefined) {
        defaultMap[f.name] = f.defaultVal;
      }
    }
  }
  const paramNames = new Set<string>(fspec ? fspec.params.map((p) => p.name) : []);
  const providedFields = new Set<string>();

  const fieldInits: string[] = [];
  for (const fline of parts) {
    if (!fline) {
      continue;
    }
    const mFi = /^([A-Za-z0-9_]+)\s*[:=]\s*(.+)$/.exec(fline);
    const mShort = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(fline);
    if (mFi) {
      const fname = mFi[1];
      providedFields.add(fname);
      const fval = mFi[2].trim();
      const mRep = /^\[([^;]+);\s*(\d+)\]$/.exec(fval);
      let cFval: string;
      if (mRep) {
        const elemV = mRep[1].trim();
        const cntV = parseInt(mRep[2], 10);
        cFval = "{" + Array.from({ length: cntV }, () => elemV).join(", ") + "}";
      } else if (fval.startsWith("[") && fval.endsWith("]")) {
        cFval = "{" + fval.slice(1, -1) + "}";
      } else {
        cFval = translateExpr(fval, ast, fspec, null, ptrVars, varTypes);
      }
      fieldInits.push(`.${fname} = ${cFval}`);
    } else if (mShort) {
      const fname = mShort[1];
      providedFields.add(fname);
      if (!paramNames.has(fname) && fname in defaultMap) {
        fieldInits.push(`.${fname} = ${defaultMap[fname]}`);
      } else {
        fieldInits.push(`.${fname} = ${fname}`);
      }
    }
  }

  for (const [defFname, defVal] of Object.entries(defaultMap)) {
    if (!providedFields.has(defFname)) {
      fieldInits.push(`.${defFname} = ${defVal}`);
    }
  }

  return fieldInits.join(", ");
}
