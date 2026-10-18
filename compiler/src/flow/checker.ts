import type { Diagnostic, ModuleAST } from "./ast.ts";
import { stripCommentsAndSemi } from "./ast.ts";
import { extractEffectMaskAuditSignals } from "./bounds_prover.ts";
import { isStructPtrType } from "./codegen_expr.ts";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate Jenny v2.0 syntax rules on .jn code and return structured `--ai-json`
 * diagnostics with deterministic quick-fix suggestions if any violation is found.
 */
export function validateV2SyntaxOrDiagnose(
  rawJnText: string,
  moduleName: string,
  ast: ModuleAST | null = null,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const fallibleFns = new Set<string>();
  if (ast) {
    for (const fs of Object.values(ast.functions)) {
      if (fs.err_ty) {
        fallibleFns.add(fs.name);
      }
    }
  }
  const lines = rawJnText.split(/\r?\n/);
  for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
    const rawLine = lines[lineNo - 1];
    const stripped = stripCommentsAndSemi(rawLine);
    if (!stripped) {
      continue;
    }
    // Check forbidden &self / &mut / &T
    const mRef = /(?<!&)&(?!&)\s*(mut\s+self|self|mut\s+[A-Za-z_]|[A-Za-z_])/.exec(stripped);
    if (mRef) {
      const bad = mRef[0];
      const fix = bad.replace(/^&+/, "").trim();
      diagnostics.push({
        code: "E0101_FORBIDDEN_REF_SYNTAX",
        severity: "error",
        module: moduleName,
        line: lineNo,
        offending_token: bad,
        message:
          "Jenny v2.0 forbids `&T`, `&self`, and `&mut self`. Parameters are read-only borrows by default; use `mut` for in-place mutation.",
        suggested_replacement: fix,
      });
    }
    // Check forbidden `let ` instead of `val ` / `var `
    if (/^\s*let\s+/.test(stripped)) {
      diagnostics.push({
        code: "E0102_FORBIDDEN_LET_BINDING",
        severity: "error",
        module: moduleName,
        line: lineNo,
        offending_token: "let",
        message:
          "Jenny v2.0 uses `val` for immutable bindings and `var` for mutable bindings instead of `let`.",
        suggested_replacement: stripped.replaceAll("let mut ", "var ").replaceAll("let ", "val "),
      });
    }
    // Check forbidden Rust `x as T` cast instead of `x.as<T>()`
    const mAs = /\b([A-Za-z0-9_.]+)\s+as\s+(i32|i64|usize|u8|u32|f64)\b/.exec(stripped);
    if (mAs) {
      diagnostics.push({
        code: "E0103_FORBIDDEN_RUST_CAST_AS",
        severity: "error",
        module: moduleName,
        line: lineNo,
        offending_token: mAs[0],
        message: "Jenny v2.0 uses `x.as<T>()` method syntax instead of Rust `x as T`.",
        suggested_replacement: `${mAs[1]}.as<${mAs[2]}>()`,
      });
    }
    // Check missing `?` on fallible function call in `val/var/let x = fn_call(...)`
    const mCall = /^\s*(?:val|var|let)\s+[A-Za-z0-9_]+\s*=\s*([A-Za-z0-9_]+)\s*\([^)]*\)$/.exec(
      stripped,
    );
    if (mCall && fallibleFns.has(mCall[1])) {
      diagnostics.push({
        code: "E0106_MISSING_TRY_OPERATOR",
        severity: "error",
        module: moduleName,
        line: lineNo,
        offending_token: stripped,
        message: `Function \`${mCall[1]}\` is fallible (\`T ! E\`); append \`?\` or \`catch err { ... }\` to unwrap or propagate.`,
        suggested_replacement: stripped + "?",
      });
    }
    // Check forbidden Rust `.unwrap_or(...)`, `Ok(...)`, or `return Err(...)` / `Err(...)`
    if (
      stripped.includes(".unwrap_or(") ||
      /^\s*Ok\s*\(/.test(stripped) ||
      /^\s*(?:return\s+)?Err\s*\(/.test(stripped)
    ) {
      let repl = stripped.replace(/\.unwrap_or\(([^)]+)\)/g, " ?? $1");
      repl = repl.replace(/^\s*Ok\((.+)\)$/, "return $1");
      repl = repl.replace(/^\s*(?:return\s+)?Err\((.+)\)$/, "raise $1");
      diagnostics.push({
        code: "E0107_FORBIDDEN_RUST_OPTION_RESULT",
        severity: "error",
        module: moduleName,
        line: lineNo,
        offending_token: ".unwrap_or / Ok() / Err()",
        message:
          "Jenny v2.0 uses `opt ?? default` instead of `.unwrap_or(default)`, `return expr` instead of `Ok(expr)`, and `raise Err.Variant` instead of `return Err(Err.Variant)`.",
        suggested_replacement: repl,
      });
    }
  }
  return diagnostics;
}

/**
 * Stage 2 (`Jenny-Mem v0.3`) & Closure Lifetime Static Ownership, View Escape & Effect Capability Checker:
 *   - `E0106_READONLY_PARAM_MUTATION`: Mutating a read-only (`borrow`) parameter or `self`
 *   - `E0201_USE_AFTER_OWN`: Accessing a variable after its ownership was consumed via `own`
 *   - `E0202_CONFLICTING_MUT_BORROW`: Passing `mut x` and `x` simultaneously in the same call
 *   - `E0203_VIEW_STRUCT_ESCAPE`: Boxing an implicit stack-bound view struct (`*View` or `^View`)
 *   - `E0204_UNDECLARED_EFFECT`: Allocating `^T` / `^fn` or calling an `AllocGC` fn without `effects [AllocGC]`
 *   - `E0205_STACK_CLOSURE_ESCAPE`: Returning a stack-bound closure `fn(...) -> ...` out of its stack frame
 *   - `E0206_CLOSURE_MISSING_OWN_CAPTURE`: Capturing a unique native box `*T` inside an escaping closure without `[own ...]`
 */
export function validateStage2MemoryAndEffects(ast: ModuleAST, _rawJnText = ""): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const viewStructs = new Set<string>(
    Object.entries(ast.structs)
      .filter(([, sdecl]) => sdecl.is_stack_view)
      .map(([sname]) => sname),
  );
  const gcFns = new Set<string>(
    Object.entries(ast.functions)
      .filter(([, fn]) => fn.effects.includes("AllocGC"))
      .map(([k]) => k),
  );

  for (const [k, fn] of Object.entries(ast.functions)) {
    // Check signature for E0203_VIEW_STRUCT_ESCAPE
    const retBase = fn.ret_ty.replace(/^[*^]+/, "").replace(/\?+$/, "");
    if (isStructPtrType(fn.ret_ty) && viewStructs.has(retBase)) {
      diags.push({
        code: "E0203_VIEW_STRUCT_ESCAPE",
        severity: "error",
        module: ast.name,
        line: 1,
        function: fn.name,
        offending_token: fn.ret_ty,
        message: `Struct \`${retBase}\` contains slice/str fields and is an implicit stack-bound view; it cannot be boxed on the heap (\`${fn.ret_ty}\`). Return \`${retBase}\` by value instead.`,
        suggested_replacement: retBase,
      });
    }

    // Check signature for E0205_STACK_CLOSURE_ESCAPE (`-> fn(...) -> ...`)
    if (/^fn\s*\(/.test(fn.ret_ty.trim())) {
      diags.push({
        code: "E0205_STACK_CLOSURE_ESCAPE",
        severity: "error",
        module: ast.name,
        line: 1,
        function: fn.name,
        offending_token: fn.ret_ty,
        message: `Stack-bound view closure \`${fn.ret_ty}\` cannot escape its lexical stack frame as the return type of \`${k}\`! Use \`*${fn.ret_ty}\` (unique native heap) or \`^${fn.ret_ty}\` (managed GC heap).`,
        suggested_replacement: `*${fn.ret_ty}`,
      });
    }

    const readonlyParams = new Set<string>(
      fn.params.filter((p) => p.mode === "borrow").map((p) => p.name),
    );
    const uniqueBoxVars = new Set<string>(
      fn.params
        .filter((p) => isStructPtrType(p.ty) && p.ty.startsWith("*"))
        .map((p) => p.name),
    );
    const consumedVars = new Map<string, string>();

    for (const stmt of fn.body_lines) {
      const s = stmt.trim();
      if (!s) {
        continue;
      }

      const mLocalBox = /^(?:val|var)\s+([A-Za-z0-9_]+)(?:\s*:\s*[^=]+)?\s*=\s*\*[A-Za-z_]/.exec(s);
      if (mLocalBox) {
        uniqueBoxVars.add(mLocalBox[1]);
      }

      // 0a. Check E0205_STACK_CLOSURE_ESCAPE on `return fn(...) => ...`
      if (/^return\s+fn(?:\[[^\]]*\])?\s*\(/.test(s)) {
        diags.push({
          code: "E0205_STACK_CLOSURE_ESCAPE",
          severity: "error",
          module: ast.name,
          line: 1,
          function: fn.name,
          offending_token: s,
          message: `Cannot return stack-bound view closure in \`${s}\` because its environment lives on \`${k}\`'s stack frame! Prefix with \`*fn[own ...]\` or \`^fn\` to allocate the escaping closure environment on the heap.`,
          suggested_replacement: s.replace("return fn", "return *fn"),
        });
      }

      // 0b. Check E0206_CLOSURE_MISSING_OWN_CAPTURE when an escaping closure (`*fn` or `^fn`) references a `*Struct` box without `[own box_var]`
      const mEscCl =
        /(\*|\^)fn(?:\[([^\]]*)\])?\(\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z0-9_]+)?\s*\)(?:\s*->\s*[A-Za-z0-9_]+)?\s*=>\s*(.+)$/.exec(
          s,
        );
      if (mEscCl) {
        const clTrack = mEscCl[1];
        const capListS = mEscCl[2] ?? "";
        const clParam = mEscCl[3];
        const clBody = mEscCl[4];
        const ownListed = new Set<string>();
        const ownCapRe = /\bown\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
        let mCap: RegExpExecArray | null;
        while ((mCap = ownCapRe.exec(capListS)) !== null) {
          ownListed.add(mCap[1]);
        }
        for (const bvar of uniqueBoxVars) {
          if (bvar !== clParam && new RegExp(`\\b${escapeRegExp(bvar)}\\b`).test(clBody)) {
            if (!ownListed.has(bvar) || clTrack !== "*") {
              diags.push({
                code: "E0206_CLOSURE_MISSING_OWN_CAPTURE",
                severity: "error",
                module: ast.name,
                line: 1,
                function: fn.name,
                offending_token: s,
                message: `Escaping closure in \`${k}\` captures unique native heap pointer \`${bvar}\` without explicit ownership transfer \`[own ${bvar}]\` on \`*fn\`! Use \`*fn[own ${bvar}](${clParam}) => ...\`.`,
                suggested_replacement: `*fn[own ${bvar}](${clParam}) => ${clBody}`,
              });
            }
          }
        }
      }

      // 1. Check E0201_USE_AFTER_OWN (using a variable already consumed in a previous statement)
      for (const [cvar, consumeSite] of consumedVars.entries()) {
        if (new RegExp(`\\b${escapeRegExp(cvar)}\\b`).test(s)) {
          diags.push({
            code: "E0201_USE_AFTER_OWN",
            severity: "error",
            module: ast.name,
            line: 1,
            function: fn.name,
            offending_token: cvar,
            message: `Variable \`${cvar}\` is accessed in \`${s}\` after its ownership was already consumed by \`${consumeSite}\`! Move all read-only accesses before \`own ${cvar}\`.`,
            suggested_replacement: `// Move \`${s}\` before \`${consumeSite}\``,
          });
        }
      }

      // Record new `own <var>` consumptions in this statement
      const ownRe = /\bown\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
      let mOwn: RegExpExecArray | null;
      while ((mOwn = ownRe.exec(s)) !== null) {
        consumedVars.set(mOwn[1], s);
      }

      // 2. Check E0106_READONLY_PARAM_MUTATION
      const mAssign = /^([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z0-9_]+)+\s*(?:=|\+=|-=|\*=|\/=)(?!=)/.exec(
        s,
      );
      if (mAssign && readonlyParams.has(mAssign[1])) {
        const rp = mAssign[1];
        diags.push({
          code: "E0106_READONLY_PARAM_MUTATION",
          severity: "error",
          module: ast.name,
          line: 1,
          function: fn.name,
          offending_token: s,
          message: `Cannot mutate field of read-only parameter \`${rp}\` in \`${k}\`! Declare \`mut ${rp}\` in the signature if in-place mutation is intended.`,
          suggested_replacement: `mut ${rp}`,
        });
      }

      // 3. Check E0202_CONFLICTING_MUT_BORROW (`fn(mut x, ..., x)`)
      const callRe = /\b([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)/g;
      let mCall: RegExpExecArray | null;
      while ((mCall = callRe.exec(s)) !== null) {
        const args = mCall[2]
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        const mutVarsInCall = new Set<string>();
        const allVarsInCall: string[] = [];
        for (const a of args) {
          const mMv = /^mut\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(a);
          if (mMv) {
            const v = mMv[1];
            if (allVarsInCall.includes(v)) {
              diags.push({
                code: "E0202_CONFLICTING_MUT_BORROW",
                severity: "error",
                module: ast.name,
                line: 1,
                function: fn.name,
                offending_token: mCall[0],
                message: `Conflicting mutable borrow of \`${v}\` in call \`${mCall[0]}\`: \`${v}\` cannot be borrowed as \`mut\` and simultaneously passed as another argument.`,
                suggested_replacement: "",
              });
            }
            mutVarsInCall.add(v);
            allVarsInCall.push(v);
          } else {
            const mBv = /^(?:own\s+)?([A-Za-z_][A-Za-z0-9_]*)$/.exec(a);
            if (mBv) {
              const v = mBv[1];
              if (mutVarsInCall.has(v)) {
                diags.push({
                  code: "E0202_CONFLICTING_MUT_BORROW",
                  severity: "error",
                  module: ast.name,
                  line: 1,
                  function: fn.name,
                  offending_token: mCall[0],
                  message: `Conflicting mutable borrow of \`${v}\` in call \`${mCall[0]}\`: \`${v}\` cannot be borrowed as \`mut\` and simultaneously passed as another argument.`,
                  suggested_replacement: "",
                });
              }
              allVarsInCall.push(v);
            }
          }
        }
      }

      // 4. Check E0203_VIEW_STRUCT_ESCAPE in body allocations
      for (const vs of viewStructs) {
        const escVs = escapeRegExp(vs);
        const vsAllocRe = new RegExp(`(?:\\*in\\([A-Za-z0-9_]+\\)\\s*|\\*|\\^)(${escVs})\\b`);
        if (vsAllocRe.test(s)) {
          diags.push({
            code: "E0203_VIEW_STRUCT_ESCAPE",
            severity: "error",
            module: ast.name,
            line: 1,
            function: fn.name,
            offending_token: s,
            message: `Implicit stack-bound view struct \`${vs}\` (containing \`str\` or \`[]T\` slice) cannot be allocated on the heap (\`*${vs}\` / \`^${vs}\`). Allocate \`${vs}\` on the stack instead.`,
            suggested_replacement: s.replace(
              new RegExp(`(?:\\*in\\([A-Za-z0-9_]+\\)\\s*|\\*|\\^)(${escVs})\\b`, "g"),
              "$1",
            ),
          });
        }
      }

      // 5. Check E0204_UNDECLARED_EFFECT (`^Struct` or `^fn` allocation, or calling `effects [AllocGC]` fn without `AllocGC`)
      if (!fn.effects.includes("AllocGC")) {
        const mGcAlloc = /\^([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(s);
        if (mGcAlloc && mGcAlloc[1] in ast.structs) {
          diags.push({
            code: "E0204_UNDECLARED_EFFECT",
            severity: "error",
            module: ast.name,
            line: 1,
            function: fn.name,
            offending_token: `^${mGcAlloc[1]}`,
            message: `Function \`${k}\` allocates managed GC handle \`^${mGcAlloc[1]}\` but does not declare \`effects [AllocGC]\` in its blueprint signature!`,
            suggested_replacement: "effects [AllocGC]",
          });
        }
        if (/\^fn(?:\[[^\]]*\])?\s*\(/.test(s)) {
          diags.push({
            code: "E0204_UNDECLARED_EFFECT",
            severity: "error",
            module: ast.name,
            line: 1,
            function: fn.name,
            offending_token: "^fn",
            message: `Function \`${k}\` allocates a managed GC closure \`^fn(...)\` but does not declare \`effects [AllocGC]\` in its blueprint signature!`,
            suggested_replacement: "effects [AllocGC]",
          });
        }
        for (const gcFn of gcFns) {
          if (new RegExp(`\\b${escapeRegExp(gcFn)}\\s*\\(`).test(s)) {
            diags.push({
              code: "E0204_UNDECLARED_EFFECT",
              severity: "error",
              module: ast.name,
              line: 1,
              function: fn.name,
              offending_token: gcFn,
              message: `Pure function \`${k}\` calls \`${gcFn}\` which requires \`effects [AllocGC]\`, but \`${k}\` does not declare \`effects [AllocGC]\`!`,
              suggested_replacement: "effects [AllocGC]",
            });
          }
        }
      }
    }
  }

  return diags;
}

/**
 * Stage 3 (`Jenny-Spin v0.4`) Static Trait Delegation & `@spin` Safety Checker:
 *   - `E0305_SPIN_GC_IN_BINARY_CODEC`: Rejects `^T` GC handle fields inside `@apply(codec::binary)` structs.
 *   - `E0306_SPIN_MUTATE_EXISTING_FIELD`: Enforces the Additive-Only principle (rejects `@spin` mutating/removing existing fields).
 *   - `E0307_INVALID_DELEGATE_TARGET`: Rejects `delegate Trait to self.<field>` when `<field>` is missing on the struct.
 */
export function validateStage3SpinAndTraits(ast: ModuleAST, rawJnText = ""): Diagnostic[] {
  const diags: Diagnostic[] = [];

  for (const [sname, sdecl] of Object.entries(ast.structs)) {
    const fieldNames = new Set<string>(sdecl.fields.map((f) => f.name));
    const sortedFields = Array.from(fieldNames).sort().join(", ");
    // 1. Check E0307_INVALID_DELEGATE_TARGET
    for (const delDecl of sdecl.delegates) {
      if (!fieldNames.has(delDecl.target_field)) {
        diags.push({
          code: "E0307_INVALID_DELEGATE_TARGET",
          severity: "error",
          module: ast.name,
          line: 1,
          offending_token: `delegate ${delDecl.trait_name} to self.${delDecl.target_field}`,
          message: `Struct \`${sname}\` delegates \`${delDecl.trait_name}\` to \`self.${delDecl.target_field}\`, but \`${delDecl.target_field}\` is not a declared field on \`${sname}\`! Available fields: ${sortedFields}.`,
          suggested_replacement:
            sdecl.fields.length > 0
              ? `delegate ${delDecl.trait_name} to self.${sdecl.fields[0].name}`
              : "",
        });
      }
    }
    // 2. Check E0305_SPIN_GC_IN_BINARY_CODEC
    if (sdecl.apply_annotations.some((ann) => ann.startsWith("codec::binary"))) {
      for (const fld of sdecl.fields) {
        if (fld.ty.startsWith("^")) {
          diags.push({
            code: "E0305_SPIN_GC_IN_BINARY_CODEC",
            severity: "error",
            module: ast.name,
            line: 1,
            offending_token: `pub ${fld.name}: ${fld.ty}`,
            message: `Struct \`${sname}\` is annotated with \`@apply(codec::binary)\`, which requires deterministic value layout, but field \`${fld.name}\` is a managed GC handle (\`${fld.ty}\`)!`,
            suggested_replacement: `pub ${fld.name}: i64`,
          });
        }
      }
    }
  }

  // 3. Check E0306_SPIN_MUTATE_EXISTING_FIELD (Additive-Only principle)
  const rawLines = rawJnText.split(/\r?\n/);
  for (let lineNo = 1; lineNo <= rawLines.length; lineNo++) {
    const sline = rawLines[lineNo - 1].trim();
    const mMutFld =
      /\b(?:!mutate_field|!delete_field|mutate_field|delete_field)\s+([A-Za-z0-9_]+)/.exec(sline);
    if (mMutFld) {
      diags.push({
        code: "E0306_SPIN_MUTATE_EXISTING_FIELD",
        severity: "error",
        module: ast.name,
        line: lineNo,
        offending_token: sline,
        message: `\`@spin\` violated the Additive-Only principle by attempting to mutate or delete existing struct field \`${mMutFld[1]}\`! \`@spin\` blocks may only synthesize new methods or impls.`,
        suggested_replacement: `// Remove \`${sline}\``,
      });
    }
  }

  // 4. Check E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED (unconstrained `...args` declaration)
  for (const [fname, fn] of Object.entries(ast.functions)) {
    if (fn.is_spin_variadic) {
      for (const p of fn.params) {
        if (p.mode === "variadic" && p.ty === "...") {
          diags.push({
            code: "E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED",
            severity: "error",
            module: ast.name,
            line: 1,
            offending_token: `...${p.name}`,
            message: `Variadic \`@spin\` function \`${fname}\` declares unconstrained pack \`...${p.name}\`! Jenny forbids duck-typed unconstrained templates; specify an explicit trait bound such as \`...${p.name}: Formattable\`.`,
            suggested_replacement: `...${p.name}: Formattable`,
          });
        }
      }
    }
  }

  return diags;
}

/**
 * Stage 4 (`Jenny-Native v1.0`) Static C FFI, Native Layout & Effect Containment Checker:
 *   - `E0401_FFI_IMPLICIT_RAW_PTR`: Passing `str`, `[]T`, or `*T` to an `import c` function without explicit `.as_raw_ptr()`.
 *   - `E0402_FFI_MISSING_UNSAFE_EFFECT`: Calling an `import c` function without declaring `effects [Unsafe]` in `.jni` (or `mask [Unsafe]` in `.jn`).
 *   - `E0403_FFI_GC_PTR_TO_C`: Embedding a `@gc` managed handle (`^T`) inside a `@repr(C)` struct or passing `^T` to C FFI.
 *   - `E0709_MASKED_LOCK_ESCAPE`: Escaping a lock guard or semaphore permit from a `mask [Sync]` scope.
 */
export function validateStage4FfiAndNative(ast: ModuleAST, rawJnText = ""): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const [, maskDiags] = extractEffectMaskAuditSignals(rawJnText, ast.name, ast);
  diags.push(...maskDiags);

  // 1. Check E0403_FFI_GC_PTR_TO_C on @repr(C) structs
  for (const [sname, sdecl] of Object.entries(ast.structs)) {
    if (sdecl.repr_c) {
      for (const fld of sdecl.fields) {
        if (fld.ty.startsWith("^")) {
          diags.push({
            code: "E0403_FFI_GC_PTR_TO_C",
            severity: "error",
            module: ast.name,
            line: 1,
            offending_token: `pub ${fld.name}: ${fld.ty}`,
            message: `Struct \`${sname}\` is marked \`@repr(C)\` for C ABI interoperability, so it cannot contain managed GC handle field \`${fld.name}: ${fld.ty}\` (GC objects may relocate or reside in non-linear WasmGC memory).`,
            suggested_replacement: `pub ${fld.name}: i64`,
          });
        }
      }
    }
  }

  if (Object.keys(ast.c_imports).length === 0) {
    return diags;
  }

  // 2. Check E0401 & E0402 inside functions calling `import c` aliases
  for (const [k, fn] of Object.entries(ast.functions)) {
    if (!fn.body_lines || fn.body_lines.length === 0) {
      continue;
    }
    const sliceOrPtrParams = new Set<string>(
      fn.params
        .filter((p) => p.ty === "str" || p.ty.startsWith("[]") || p.ty.startsWith("*"))
        .map((p) => p.name),
    );
    const gcParams = new Set<string>(
      fn.params.filter((p) => p.ty.startsWith("^")).map((p) => p.name),
    );

    for (const bl of fn.body_lines) {
      const sline = bl.trim();
      for (const calias of Object.keys(ast.c_imports)) {
        const cCallRe = new RegExp(
          `\\b${escapeRegExp(calias)}(?:\\.|::)([A-Za-z_][A-Za-z0-9_]*)\\((.+)\\)`,
          "g",
        );
        let mCCall: RegExpExecArray | null;
        while ((mCCall = cCallRe.exec(sline)) !== null) {
          const cfnName = mCCall[1];
          const rawArgsStr = mCCall[2];
          if (!fn.effects.includes("Unsafe") && !fn.masked_effects.includes("Unsafe")) {
            diags.push({
              code: "E0402_FFI_MISSING_UNSAFE_EFFECT",
              severity: "error",
              module: ast.name,
              line: 1,
              function: fn.name,
              offending_token: `${calias}::${cfnName}`,
              message: `Function \`${k}\` invokes external C FFI function \`${calias}::${cfnName}\` without declaring \`effects [Unsafe]\` in its blueprint signature (or containing it via \`mask [Unsafe]\`)!`,
              suggested_replacement: "effects [Unsafe]",
            });
          }
          const args = rawArgsStr
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
          for (const arg of args) {
            if (sliceOrPtrParams.has(arg)) {
              diags.push({
                code: "E0401_FFI_IMPLICIT_RAW_PTR",
                severity: "error",
                module: ast.name,
                line: 1,
                function: fn.name,
                offending_token: arg,
                message: `Cannot implicitly pass Jenny slice/pointer \`${arg}\` to C FFI function \`${calias}::${cfnName}\`! Explicitly call \`${arg}.as_raw_ptr()\` to cross the FFI boundary.`,
                suggested_replacement: `${arg}.as_raw_ptr()`,
              });
            }
            for (const gcp of gcParams) {
              if (new RegExp(`\\b${escapeRegExp(gcp)}\\b`).test(arg)) {
                diags.push({
                  code: "E0403_FFI_GC_PTR_TO_C",
                  severity: "error",
                  module: ast.name,
                  line: 1,
                  function: fn.name,
                  offending_token: arg,
                  message: `Cannot expose managed GC handle \`${gcp}\` across C FFI boundary in \`${calias}::${cfnName}\`!`,
                  suggested_replacement: "",
                });
              }
            }
          }
        }
      }
    }
  }

  return diags;
}
