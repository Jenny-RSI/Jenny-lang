import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..", "..", "..");
export const CLANG_PATH = "C:\\Tools\\LLVM\\bin\\clang.exe";
export const RT_HEADER_PATH = path.join(ROOT_DIR, "compiler", "jenny-flow", "jenny_rt.h");

export interface FieldDecl {
  name: string;
  ty: string;
  defaultVal: string | null;
  bit_width: number | null;
}

export interface DelegateDecl {
  trait_name: string;
  target_field: string;
}

export interface StructDecl {
  name: string;
  fields: FieldDecl[];
  invariants: string[];
  is_stack_view: boolean;
  delegates: DelegateDecl[];
  apply_annotations: string[];
  repr_c: boolean;
  is_union: boolean;
}

export interface EnumDecl {
  name: string;
  variants: string[];
}

export interface ParamDecl {
  mode: string; // "borrow" | "mut" | "own" | "variadic"
  name: string;
  ty: string;
}

export interface RequiresClause {
  cond: string;
  else_err: string | null;
}

export interface FnSpec {
  name: string;
  struct_owner: string | null;
  params: ParamDecl[];
  ret_ty: string;
  err_ty: string | null;
  effects: string[];
  masked_effects: string[];
  requires: RequiresClause[];
  ensures: string[];
  body_lines: string[];
  extern_c_sym: string | null;
  is_spin_variadic: boolean;
}

export interface TraitDecl {
  name: string;
  methods: Record<string, FnSpec>;
}

export interface TraitImplDecl {
  trait_name: string;
  struct_name: string;
}

export interface ExampleBlock {
  title: string;
  body_lines: string[];
}

export interface Diagnostic {
  code: string;
  severity: string;
  module?: string;
  line?: number;
  function?: string;
  offending_token?: string;
  message: string;
  suggested_replacement?: string;
  [key: string]: unknown;
}

export interface ModuleAST {
  name: string;
  enums: Record<string, EnumDecl>;
  traits: Record<string, TraitDecl>;
  trait_impls: TraitImplDecl[];
  structs: Record<string, StructDecl>;
  functions: Record<string, FnSpec>;
  examples: ExampleBlock[];
  c_imports: Record<string, string>;
  imports: string[];
  tolerant_semicolons: number;
  spun_path: string | null;
  spin_bound_diagnostics: Diagnostic[];
}

export function computeTypeIdHash64(moduleName: string, structName: string): string {
  const fqName = `${moduleName}::${structName}`;
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask64 = 0xffffffffffffffffn;
  for (let i = 0; i < fqName.length; i++) {
    h ^= BigInt(fqName.charCodeAt(i) & 0xff);
    h = (h * prime) & mask64;
  }
  return `0x${h.toString(16).toUpperCase().padStart(16, "0")}ULL`;
}

export function createFieldDecl(
  name: string,
  ty: string,
  defaultVal: string | null = null,
  bit_width: number | null = null,
): FieldDecl {
  return { name, ty, defaultVal, bit_width };
}

export function createStructDecl(
  name: string,
  opts: Partial<StructDecl> = {},
): StructDecl {
  return {
    name,
    fields: opts.fields ?? [],
    invariants: opts.invariants ?? [],
    is_stack_view: opts.is_stack_view ?? false,
    delegates: opts.delegates ?? [],
    apply_annotations: opts.apply_annotations ?? [],
    repr_c: opts.repr_c ?? false,
    is_union: opts.is_union ?? false,
  };
}

export function createFnSpec(
  name: string,
  struct_owner: string | null,
  params: ParamDecl[],
  ret_ty: string,
  err_ty: string | null,
  opts: Partial<FnSpec> = {},
): FnSpec {
  return {
    name,
    struct_owner,
    params,
    ret_ty,
    err_ty,
    effects: opts.effects ?? [],
    masked_effects: opts.masked_effects ?? [],
    requires: opts.requires ?? [],
    ensures: opts.ensures ?? [],
    body_lines: opts.body_lines ?? [],
    extern_c_sym: opts.extern_c_sym ?? null,
    is_spin_variadic: opts.is_spin_variadic ?? false,
  };
}

export function createModuleAST(name = "unnamed"): ModuleAST {
  return {
    name,
    enums: {},
    traits: {},
    trait_impls: [],
    structs: {},
    functions: {},
    examples: [],
    c_imports: {},
    imports: [],
    tolerant_semicolons: 0,
    spun_path: null,
    spin_bound_diagnostics: [],
  };
}

export function stripCommentsAndSemi(line: string, ast?: ModuleAST | null): string {
  let inStr = false;
  let cleaned = line;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
      inStr = !inStr;
    } else if (!inStr && line.slice(i, i + 2) === "//") {
      cleaned = line.slice(0, i);
      break;
    }
  }
  cleaned = cleaned.trimEnd();
  if (cleaned.endsWith(";") && !cleaned.startsWith("//")) {
    if (ast) {
      ast.tolerant_semicolons += 1;
    }
    cleaned = cleaned.slice(0, -1).trimEnd();
  }
  const sTrim = cleaned.trimStart();
  if (
    cleaned.includes("::") &&
    !sTrim.startsWith("@spin") &&
    !sTrim.startsWith("@apply") &&
    !sTrim.startsWith("import ") &&
    !sTrim.startsWith("export ") &&
    !sTrim.startsWith("pub import ")
  ) {
    cleaned = cleaned.replace(
      /"(?:\\.|[^"\\])*"|\b([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)\b/g,
      (m, g1: string | undefined, g2: string | undefined) => (g1 && g2 ? `${g1}.${g2}` : m),
    );
  }
  return cleaned;
}

export function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of s) {
    if (ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
    }
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) {
    parts.push(cur.trim());
  }
  return parts;
}

export function splitFnHeader(fullSig: string): [string, string, string | null] | null {
  let s = fullSig.trim();
  if (s.endsWith("{")) {
    s = s.slice(0, -1).trimEnd();
  }
  const mHead = /^(?:@spin\s+)?(?:(?:pub|pkg|iter)\s+)*fn\s+([A-Za-z0-9_]+)(?:<[^>]*>)?\s*\(/.exec(s);
  if (!mHead) {
    return null;
  }
  const fnName = mHead[1];
  const openIdx = mHead[0].length - 1;
  let depth = 0;
  let closeIdx = -1;
  for (let idx = openIdx; idx < s.length; idx++) {
    if (s[idx] === "(") {
      depth += 1;
    } else if (s[idx] === ")") {
      depth -= 1;
      if (depth === 0) {
        closeIdx = idx;
        break;
      }
    }
  }
  if (closeIdx === -1) {
    return null;
  }
  const paramStr = s.slice(openIdx + 1, closeIdx).trim();
  const rest = s.slice(closeIdx + 1).trim();
  if (rest.startsWith("->")) {
    return [fnName, paramStr, rest.slice(2).trim()];
  }
  return [fnName, paramStr, "void"];
}

export function parseParamList(paramStr: string, structOwner: string | null): ParamDecl[] {
  const params: ParamDecl[] = [];
  if (!paramStr.trim()) {
    return params;
  }
  for (const rawP of splitTopLevelCommas(paramStr)) {
    const p = rawP.trim();
    if (!p) continue;
    if (p === "self") {
      params.push({ mode: "borrow", name: "self", ty: structOwner ?? "Self" });
    } else if (p === "mut self") {
      params.push({ mode: "mut", name: "self", ty: structOwner ?? "Self" });
    } else if (p === "own self") {
      params.push({ mode: "own", name: "self", ty: structOwner ?? "Self" });
    } else if (p.startsWith("...")) {
      let packName = p.slice(3).trim();
      let boundTy = "...";
      if (packName.includes(":")) {
        const idx = packName.indexOf(":");
        boundTy = packName.slice(idx + 1).trim();
        packName = packName.slice(0, idx).trim();
      }
      params.push({ mode: "variadic", name: packName, ty: boundTy });
    } else {
      const m = /^(?:(mut|own)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(p);
      if (!m) {
        throw new Error(`Invalid parameter syntax: ${p}`);
      }
      let mode = m[1] ?? "borrow";
      let ty = m[3].trim();
      if (ty.startsWith("mut ")) {
        mode = "mut";
        ty = ty.slice(4).trim();
      } else if (ty.startsWith("own ")) {
        mode = "own";
        ty = ty.slice(4).trim();
      }
      if (ty === "Self" && structOwner) {
        ty = structOwner;
      }
      params.push({ mode, name: m[2], ty });
    }
  }
  return params;
}

export function parseReturnSpec(retStr: string): [string, string | null] {
  const stripGen = (t: string): string =>
    t.startsWith("fn(") || t.startsWith("*fn(") || t.startsWith("^fn(")
      ? t
      : t.replace(/<[^>]*>/g, "").trim();
  const s = retStr.trim();
  if (s.endsWith("!") && !s.slice(0, -1).includes("!")) {
    return [stripGen(s.slice(0, -1).trim()), "AnyError"];
  }
  if (s.includes("!")) {
    const idx = s.indexOf("!");
    return [stripGen(s.slice(0, idx).trim()), stripGen(s.slice(idx + 1).trim())];
  }
  return [stripGen(s), null];
}
