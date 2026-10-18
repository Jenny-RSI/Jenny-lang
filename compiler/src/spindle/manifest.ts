import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, ModuleAST } from "../flow/ast.ts";
import { ROOT_DIR } from "../flow/ast.ts";
import {
  extractJennyDeclCode,
  extractJennyFencedCode,
  parseJniBlueprint,
} from "../flow/blueprint.ts";

export const STD_DIR: string = path.join(ROOT_DIR, "library", "std");

export const STD_MOD_ORDER: string[] = [
  "std::rt::intrinsics",
  "std::ffi::c_abi",
  "std::mem::raw_buf",
  "std::mem::arena",
  "std::collections::vec",
  "std::collections::vec_deque",
  "std::collections::hash_map",
  "std::collections::lru_cache",
  "std::str::str_view",
  "std::str::string_buf",
  "std::str::fmt",
  "std::io::cursor",
  "std::io::buf_io",
  "std::io::path_buf",
  "std::codec::varint",
];

const TOKEN_PATTERN =
  /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|==|!=|<=|>=|->|=>|\|>|\?\?|\.\.|::|[^\s]/g;

export const RESTRICTED_CAPABILITY_EFFECTS = new Set<string>([
  "IO",
  "Net",
  "Process",
  "Env",
  "Unsafe",
  "FileSystem",
]);

export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  const buf = Buffer.from(text, "utf-8");
  for (let i = 0; i < buf.length; i++) {
    h = Math.imul(h ^ buf[i], 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function countCodeTokens(
  text: string,
  isJni?: boolean,
  declOnly = false,
): number {
  const treatAsJni =
    isJni !== undefined
      ? isJni
      : /```(?:jenny_decl|jenny_test|jenny)\b/.test(text);
  const src = treatAsJni
    ? declOnly
      ? extractJennyDeclCode(text)
      : extractJennyFencedCode(text)
    : text;
  const cleanedLines: string[] = [];
  for (const line of src.replace(/\r\n/g, "\n").split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("//")) {
      continue;
    }
    const codePart = line.split("//")[0];
    cleanedLines.push(codePart);
  }
  const matches = cleanedLines.join("\n").match(TOKEN_PATTERN);
  return matches ? matches.length : 0;
}

export function parseTapestryToml(pkgDir: string): Record<string, any> {
  const isTomlFile = pkgDir.endsWith(".toml");
  const tomlPath = isTomlFile ? pkgDir : path.join(pkgDir, "Tapestry.toml");
  const rootDir = isTomlFile ? path.dirname(pkgDir) : pkgDir;
  const text = fs.readFileSync(tomlPath, "utf-8");
  const pkgInfo: Record<string, any> = { allow_effects: [] };
  const modules: Record<string, Record<string, string>> = {};
  let section = "";

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1).trim();
      continue;
    }
    const eqIdx = line.indexOf("=");
    if (section === "package" && eqIdx !== -1) {
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      if (v.startsWith("[") && v.endsWith("]")) {
        const items = v
          .slice(1, -1)
          .split(",")
          .map((x) => x.trim().replace(/^["']+|["']+$/g, ""))
          .filter((x) => x.length > 0);
        pkgInfo[k] = items;
      } else {
        pkgInfo[k] = v.replace(/^["']+|["']+$/g, "");
      }
    } else if (section === "modules" && eqIdx !== -1) {
      const k = line.slice(0, eqIdx).trim();
      const v = line.slice(eqIdx + 1).trim();
      const modId = k.replace(/^["']+|["']+$/g, "");
      const mBraces = /\{(.*)\}/.exec(v);
      const attrs: Record<string, string> = {};
      if (mBraces) {
        for (const pair of mBraces[1].split(",")) {
          const pEq = pair.indexOf("=");
          if (pEq !== -1) {
            const pk = pair.slice(0, pEq).trim();
            const pv = pair
              .slice(pEq + 1)
              .trim()
              .replace(/^["']+|["']+$/g, "");
            attrs[pk] = pv;
          }
        }
      }
      modules[modId] = attrs;
    }
  }

  return { package: pkgInfo, modules, root_dir: rootDir };
}

export function parsePkgJniExports(pkgDir: string): string[] {
  const pkgJniPath = pkgDir.endsWith(".jni")
    ? pkgDir
    : path.join(pkgDir, "pkg.jni");
  if (!fs.existsSync(pkgJniPath)) {
    return [];
  }
  const code = extractJennyDeclCode(fs.readFileSync(pkgJniPath, "utf-8"));
  const exportsSet = new Set<string>();
  for (const line of code.replace(/\r\n/g, "\n").split("\n")) {
    const s = line.trim();
    const mExp =
      /^(?:export\s+module|pub\s+import)\s+([A-Za-z0-9_:]+)(?:::\{[^}]+\})?$/.exec(
        s,
      );
    if (mExp) {
      exportsSet.add(mExp[1].trim().replace(/:+$/, ""));
    }
  }
  return Array.from(exportsSet);
}

export interface ValidateOverrides {
  overrideJni?: Record<string, string> | null;
  overrideAllowEffects?: string[] | null;
  overrideExports?: Set<string> | string[] | null;
  overrideJn?: Record<string, string> | null;
}

export function validatePackageGraph(
  pkgDirOrManifest: string | Record<string, any>,
  overrides: ValidateOverrides = {},
): [Record<string, any>, Diagnostic[]] {
  const manifest =
    typeof pkgDirOrManifest === "string"
      ? parseTapestryToml(pkgDirOrManifest)
      : pkgDirOrManifest;
  const diags: Diagnostic[] = [];
  const pkgDir: string = manifest.root_dir;
  const pkgMeta: Record<string, any> = manifest.package ?? {};
  const modMap: Record<string, Record<string, string>> = manifest.modules ?? {};

  const allowEffectsList: string[] =
    overrides.overrideAllowEffects !== undefined &&
    overrides.overrideAllowEffects !== null
      ? overrides.overrideAllowEffects
      : (pkgMeta.allow_effects ?? []);
  const allowEffects = new Set<string>(allowEffectsList);

  const pkgJniPath = path.join(pkgDir, pkgMeta.blueprint ?? "pkg.jni");
  const rawExports =
    overrides.overrideExports !== undefined &&
    overrides.overrideExports !== null
      ? overrides.overrideExports
      : parsePkgJniExports(pkgJniPath);
  const exportedModules =
    rawExports instanceof Set ? rawExports : new Set<string>(rawExports);

  const depGraph: Record<string, string[]> = {};
  const modulesMeta: Record<string, any> = {};

  for (const [modId, paths] of Object.entries(modMap)) {
    const jniRel = paths.jni ?? "";
    const jnRel = paths.jn ?? "";
    const rsRel = paths.rs ?? "";
    const jniFile = path.join(pkgDir, jniRel);
    const jnFile = path.join(pkgDir, jnRel);
    const rsFile = rsRel ? path.join(pkgDir, rsRel) : "";

    let jniText = "";
    if (overrides.overrideJni && modId in overrides.overrideJni) {
      if (overrides.overrideJni[modId] === "__MISSING__") {
        diags.push({
          code: "E0501_UNPAIRED_MODULE",
          severity: "error",
          module: modId,
          message: `Module \`${modId}\` in \`Tapestry.toml\` is missing its paired \`.jni\` blueprint or \`.jn\` implementation!`,
        });
        continue;
      }
      jniText = overrides.overrideJni[modId];
    } else {
      if (!fs.existsSync(jniFile) || !fs.existsSync(jnFile)) {
        diags.push({
          code: "E0501_UNPAIRED_MODULE",
          severity: "error",
          module: modId,
          message: `Module \`${modId}\` is missing \`${jniRel}\` or \`${jnRel}\`!`,
        });
        continue;
      }
      jniText = fs.readFileSync(jniFile, "utf-8");
    }

    const jnText =
      overrides.overrideJn && modId in overrides.overrideJn
        ? overrides.overrideJn[modId]
        : fs.readFileSync(jnFile, "utf-8");

    const ast: ModuleAST = parseJniBlueprint(jniText);
    depGraph[modId] = [...ast.imports];
    modulesMeta[modId] = {
      ...paths,
      jni_rel: jniRel,
      jn_rel: jnRel,
      rs_rel: rsRel,
      jni_path: jniFile,
      jn_path: jnFile,
      rs_path: rsFile,
      jni_text: jniText,
      jn_text: jnText,
      ast,
      imports: [...ast.imports],
    };

    if (modId !== "std::rt::intrinsics") {
      const mRawRt = /\b(jn_raw_[a-z0-9_]+|jn_scratch_[a-z0-9_]+)\s*\(/.exec(
        jnText,
      );
      if (mRawRt) {
        const badCall = mRawRt[1];
        diags.push({
          code: "E0510_UNDECLARED_RT_INTRINSIC",
          severity: "error",
          module: modId,
          offending_token: `${badCall}(...)`,
          message: `Module \`${modId}\` directly calls undocumented C runtime function \`${badCall}\` from \`jenny_rt.h\` in \`.jn\`, bypassing the \`std::rt::intrinsics\` white-box \`.jni\` blueprint!`,
        });
      }
      const mRtFn = /\b(rt_(?:raw|scratch|gc)_[a-z0-9_]+)\s*\(/.exec(jnText);
      if (mRtFn && !ast.imports.includes("std::rt::intrinsics")) {
        const badRt = mRtFn[1];
        diags.push({
          code: "E0510_UNDECLARED_RT_INTRINSIC",
          severity: "error",
          module: modId,
          offending_token: `${badRt}(...)`,
          message: `Module \`${modId}\` calls runtime intrinsic \`${badRt}\` in \`.jn\` without declaring \`import std::rt::intrinsics\` in its \`.jni\` blueprint!`,
        });
      }
    }

    if (
      Object.keys(ast.c_imports).length > 0 &&
      !allowEffects.has("Unsafe")
    ) {
      const cHeaders = Object.values(ast.c_imports).join(", ");
      const sortedAllow = JSON.stringify(Array.from(allowEffects).sort());
      diags.push({
        code: "E0505_UNDECLARED_FFI_IMPORT",
        severity: "error",
        module: modId,
        offending_token: `import c "${cHeaders}"`,
        message: `Module \`${modId}\` imports external C FFI header \`${cHeaders}\`, but package \`${pkgMeta.name}\` does not grant \`Unsafe\` in \`Tapestry.toml\` \`allow_effects = ${sortedAllow}\`!`,
      });
    }

    for (const [fkey, fspec] of Object.entries(ast.functions)) {
      for (const eff of fspec.effects) {
        if (
          RESTRICTED_CAPABILITY_EFFECTS.has(eff) &&
          !allowEffects.has(eff)
        ) {
          const sortedAllow = JSON.stringify(Array.from(allowEffects).sort());
          diags.push({
            code: "E0503_CAPABILITY_VIOLATION",
            severity: "error",
            module: modId,
            function: fkey,
            offending_token: `effects [${eff}]`,
            message: `Function \`${fkey}\` in \`${modId}\` requests restricted effect \`${eff}\`, which violates package \`${pkgMeta.name}\` capability sandbox (\`allow_effects = ${sortedAllow}\`)!`,
          });
        }
      }
    }

    for (const impMod of ast.imports) {
      if (
        !(impMod in modMap) ||
        (exportedModules.size > 0 && !exportedModules.has(impMod))
      ) {
        diags.push({
          code: "E0504_UNEXPORTED_MODULE",
          severity: "error",
          module: modId,
          offending_token: `import ${impMod}`,
          message: `Module \`${modId}\` imports \`${impMod}\`, which is not an exported module in \`${pkgMeta.blueprint ?? "pkg.jni"}\`!`,
        });
      }
    }
  }

  const visited: Record<string, number> = {};
  function dfsCycle(node: string, stack: string[]): boolean {
    visited[node] = 1;
    for (const nxt of depGraph[node] ?? []) {
      if (!(nxt in depGraph)) {
        continue;
      }
      const state = visited[nxt] ?? 0;
      if (state === 1) {
        const cyclePath = [...stack, nxt].join(" -> ");
        diags.push({
          code: "E0502_CIRCULAR_DEPENDENCY",
          severity: "error",
          module: node,
          offending_token: cyclePath,
          message: `Circular module dependency detected in package \`${pkgMeta.name}\`: ${cyclePath}`,
        });
        return true;
      } else if (state === 0) {
        if (dfsCycle(nxt, [...stack, nxt])) {
          return true;
        }
      }
    }
    visited[node] = 2;
    return false;
  }

  for (const modId of Object.keys(depGraph)) {
    if ((visited[modId] ?? 0) === 0) {
      dfsCycle(modId, [modId]);
    }
  }

  return [modulesMeta, diags];
}

export function computeReachableSubgraph(
  modulesMeta: Record<string, any>,
  entryMods: string[],
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  function getDeps(m: string): string[] {
    const entry = modulesMeta[m];
    if (!entry) return [];
    if (Array.isArray(entry)) return entry;
    if (Array.isArray(entry.imports)) return entry.imports;
    if (entry.ast && Array.isArray(entry.ast.imports)) return entry.ast.imports;
    return [];
  }

  function visit(m: string): void {
    if (seen.has(m) || !(m in modulesMeta)) {
      return;
    }
    seen.add(m);
    for (const dep of getDeps(m)) {
      visit(dep);
    }
    ordered.push(m);
  }

  for (const em of entryMods) {
    visit(em);
  }
  return ordered;
}
