# `jenny` Modular TypeScript Compiler & Spindle White-Box Toolchain (`compiler/`)

This directory contains the **Spinning Jenny (`Jenny v0.2`)** modular native TypeScript compiler (`compiler/src/flow/`), the white-box package manager and supply-chain auditor (`compiler/src/spindle/`), the C99 native runtime header ([`jenny-flow/jenny_rt.h`](./jenny-flow/jenny_rt.h)), and historical Python reference implementations.

---

## 1. Modular TypeScript Architecture (`compiler/src/`)

Built for **Node.js v24 native TypeScript execution (`erasableSyntaxOnly`)** with **zero external `node_modules` dependencies**, decomposed into 19 orthogonal pipeline modules:

### 1.1 Unified Entry Point
* **[`src/jenny.ts`](./src/jenny.ts) (38 lines)**: Unified top-level CLI entry point (`node compiler/src/jenny.ts ...`) routing between `flow` compiler flags and `spindle` package management subcommands.

### 1.2 Core Compiler (`compiler/src/flow/`, 13 Orthogonal Modules)
1. **[`src/flow/ast.ts`](./src/flow/ast.ts) (301 lines)**: Core AST interfaces (`StructDecl`, `FnSpec`, `ModuleAST`, `Diagnostic`) and function header/parameter parsers.
2. **[`src/flow/blueprint.ts`](./src/flow/blueprint.ts) (701 lines)**: `.jni` dual-zone literate blueprint extraction (`jenny_decl` / `jenny_test`), `jni_abi_hash` fingerprinting, `parseJniBlueprint`, and `.jn` skeleton generator.
3. **[`src/flow/parser.ts`](./src/flow/parser.ts) (258 lines)**: `.jn` implementation attachment, module-private `fn` parsing, and synthesized method stripping.
4. **[`src/flow/spin.ts`](./src/flow/spin.ts) (860 lines)**: `@spin` and `@apply` pattern loading (`library/patterns/**/*.jnp`), `delegate` forwarding, procedural variadic monomorphization (`.spun/` & `.jenny-cache/spin/`), and `distill` reverse template extraction.
5. **[`src/flow/blind_audit.ts`](./src/flow/blind_audit.ts) (270 lines)**: Zero-trust blind test stripping (`stripJennyTestForAgent`), `E0905_TEST_LITERAL_OVERFITTING` anti-hardcoding audit, and `RC1`–`RC3` Architect root-cause audit.
6. **[`src/flow/bounds_prover.ts`](./src/flow/bounds_prover.ts) (268 lines)**: Compile-time `QF_LIA` bounds containment prover (`Jenny-BoundsProver` & `E0711` counterexample generator) and `mask [...]` effect containment auditor (`E0709` / `W0710`).
7. **[`src/flow/checker.ts`](./src/flow/checker.ts) (596 lines)**: Jenny v2.0 syntax gate, Stage 2 three-mode ownership/memory & effect checker, Stage 3 trait bound checker, and Stage 4 FFI boundary checker.
8. **[`src/flow/codegen_expr.ts`](./src/flow/codegen_expr.ts) (738 lines)**: C99 type mapping, pipe operator `|>` expansion, named argument alignment, declarative primitive dispatch via [`library/std/rt/builtin_dispatch.json`](../library/std/rt/builtin_dispatch.json), and expression lowering.
9. **[`src/flow/codegen_c99.ts`](./src/flow/codegen_c99.ts) (573 lines)**: C99 function body generation, `requires`/`ensures`/`invariant` contract weaving, RAII unique box drop, and three-track closure (`fn` / `*fn` / `^fn`) environment lifting.
10. **[`src/flow/codegen_harness.ts`](./src/flow/codegen_harness.ts) (320 lines)**: `.jni` ABI compilation firewall `.h` header emission, `@example` / `jenny_test` runners, and `--fuzz` contract property harness generation.
11. **[`src/flow/driver.ts`](./src/flow/driver.ts) (604 lines)**: Cross-module `import` topological resolution, `.jenny-cache/` content-addressable build cache, and `clang -O3` native compilation driver.
12. **[`src/flow/mutations.ts`](./src/flow/mutations.ts) (332 lines)**: Stage 1 ~ Stage 4 18-case language-level fault-injection mutation regression suite.
13. **[`src/flow/cli.ts`](./src/flow/cli.ts) (149 lines)**: `jenny-flow` CLI entry point.

### 1.3 White-Box Package Manager (`compiler/src/spindle/`, 5 Orthogonal Modules)
1. **[`src/spindle/manifest.ts`](./src/spindle/manifest.ts) (397 lines)**: `Tapestry.toml` / `pkg.jni` parser, FNV-1a 32-bit hashing, and module dependency DAG validation.
2. **[`src/spindle/audit_and_build.ts`](./src/spindle/audit_and_build.ts) (423 lines)**: Circular dependency detection, zero-trust capability sandbox (`E0501`–`E0505`, `E0510`), on-demand reachable subgraph pruning (`build --entry` / `context`), and package mutation gate (`mutate`).
3. **[`src/spindle/semver_and_lock.ts`](./src/spindle/semver_and_lock.ts) (453 lines)**: `Tapestry.lock` dual Merkle root locking, Hoare contract semantic upgrade checker (`E0506`–`E0509`), and `.jni -> .jn` on-demand synthesis (`synthesize`).
4. **[`src/spindle/bindgen_and_pack.ts`](./src/spindle/bindgen_and_pack.ts) (769 lines)**: Automatic C header bridge (`bindgen-c`), `CHECKLIST.md` 4-step loop verifier (`std-check`), unified canonical AST archive packager (`pack`), and lossless AST-to-`.jn` decompiler (`decompile`).
5. **[`src/spindle/cli.ts`](./src/spindle/cli.ts) (144 lines)**: `spindle` CLI entry point.

---

## 2. Quick Reference Commands

```powershell
# Compile all 40 modules + 79 @example sandboxes + 18 language-level mutation gates
node compiler/src/jenny.ts --mutate

# Run 33,380 contract property & stateful container fuzzing vectors across all 40 modules
node compiler/src/jenny.ts --fuzz

# Run Spindle supply-chain audit, mutation suite, contract SemVer check, and std-check
node compiler/src/jenny.ts audit
node compiler/src/jenny.ts mutate
node compiler/src/jenny.ts semver-check
node compiler/src/jenny.ts std-check
```
