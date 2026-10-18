# Jenny Language Specification — Module 12: White-Box Package Management, Lazy Subgraph Resolution & Contract-Driven Evolution (`Spindle` & `Tapestry.toml`)

> 🌐 **Language**: **English** | **[中文原文 (Chinese Original)](../../zh/design/specs/12_package_management_and_module_system.md)**  
> **Status**: `v2.0-spec` (Implemented progressively across 4 empirical phases)  
> **First Principle (From "Opaque Black-Box Packages" to "Transparent White-Box Intent & Contracts")**:  
> Traditional package managers (Cargo, Go Modules, npm, pip) suffer from **arbitrary version semantics, monolithic whole-package pulling and upgrading, diamond dependency type splits, severe binary bloat, and silent supply-chain privilege escalation** for one fundamental reason: **traditional languages treat dependencies as opaque black boxes**. Without reading tens of thousands of lines of implementation source code, neither humans nor compilers know what a package actually does inside.  
> In Jenny, **every module and package is architecturally a White Box**: simply inspecting its `<mod>.jni` Literate Contract Blueprint reveals 100% of its intent, memory tracks (`T` / `*T` / `^T`), side-effect boundaries (`effects [...]`), and formal preconditions/postconditions (`requires` / `ensures` / `invariant`), all mechanically enforced against `<mod>.jn` by the compiler.  
> **Empirical Evolution Discipline**: Rather than inventing an untested theoretical system on paper, Jenny's white-box package manager (`spindle`) evolves iteratively in lockstep with **`v0.2 (Jenny-Std)`** across four battle-tested phases: **`Phase 1 (Lazy Subgraph Resolution)` $\rightarrow$ `Phase 2 (White-Box Effect Auditing)` $\rightarrow$ `Phase 3 (Contract Diffing & Module Hot-Swapping)` $\rightarrow$ `Phase 4 (Contract-Provider Decoupling & Blueprint Weaving)`**.

---

## 1. Root-Cause Anatomy: Why Traditional "Black-Box Package Managers" Fail in the AI Era

| Core Pain Point | Root Cause in Traditional Languages (Cargo / Go / npm / pip) | **Jenny's `.jni` White-Box Solution** | Empirical Rollout Phase |
| :--- | :--- | :--- | :---: |
| **1. Monolithic Package Pulling & Bloat** | The unit of dependency is the entire repository/crate. Calling 1 function in a library pulls, parses, and compiles all 50 modules in that crate and their transitive dependencies. | **Module/Symbol-Granular Lazy Subgraph Pruning**: Because `import *` is forbidden (`E0501`) and every `<mod>.jni` is self-contained, the compiler resolves and compiles *only* the reachable `.jni/.jn` subgraph. Unused modules in a package incur `0` compile time and `0` binary bytes. | **Phase 1**<br>*(`v0.2-alpha1`)* |
| **2. Silent Privilege Escalation & Build-Script Backdoors** | Consumers cannot statically tell if an imported utility secretly performs network/file I/O, allocates GC objects, calls `unsafe` C code, or executes malicious host code in `build.rs` / `postinstall`. | **Abolition of `build.rs` + `.jni` White-Box Capability Fingerprints (`allow_effects`)**: Every effect is exposed in `.jni` and verified against `.jn`. Consumers lock down allowed effects per dependency in `Tapestry.toml` (`E0503`). | **Phase 2**<br>*(`v0.2-alpha2`)* |
| **3. Arbitrary SemVer & Blind Monolithic Upgrades** | SemVer relies on human guesswork: a patch release can subtly alter boundary behavior and break callers, while touching a private helper invalidates downstream builds. | **Mechanically Verified Contract SemVer + Single-Module Hot-Swapping**: If `jni_abi_hash` is unchanged, a single `<mod>.jn` can be hot-swapped with **0 downstream recompilation**, gated by automated stateful differential fuzzing (`--diff`). | **Phase 3**<br>*(`v0.2-beta`)* |
| **4. Diamond Dependency Type Splits & Micro-Packages** | Coupling type definitions to implementation versions makes `http 0.2` types incompatible with `http 1.0`, while developers pull tiny third-party packages for 50 lines of logic. | **Contract-Provider Decoupling + Pure `.jni` Blueprint Weaving**: Shared `.jni` contracts maintain type identity across implementation upgrades; small utilities can be imported as pure `.jni` blueprints and woven locally with zero external runtime dependencies. | **Phase 4**<br>*(`v0.2` Final / `v0.3`)* |

---

## 2. Phase 1 (`v0.2-alpha1` Immediate Target): Paired-File White-Box Resolution & Lazy Subgraph Pruning

When constructing `std::{mem, slice, collections, str, io}` in `v0.2`, we first implement and validate **multi-module white-box resolution and minimal subgraph compilation**.

### 2.1 The `.jni` + `.jn` White-Box Pair Rule
In every Jenny package (`std` or application packages), each module is a pair of files sharing the same stem:
* **`<mod_name>.jni` (White-Box Intent & Contract Blueprint, Mandatory)**: The sole public surface visible to humans, AI coding agents, and downstream modules. Contains Markdown architectural prose and fenced `jenny` blocks declaring `pub struct`/`enum`/`trait`, `pub fn` signatures, `effects [...]`, `requires`, `ensures(old)`, `invariant`, and `@example`.
* **`<mod_name>.jn` (Implementation Unit, Physically Hidden from Importers)**: Contains function bodies, private helpers, and `@spin` directives.

### 2.2 Standard Library & Workspace Topology (`std/` Layout)

```text
jenny_workspace/
├── Tapestry.toml                  # Package/workspace manifest
├── Tapestry.lock                  # Module-granular white-box contract & implementation lockfile
├── std/                           # Official Standard Library package (package = "std")
│   ├── pkg.jni                    # Package facade blueprint (re-exports core submodules)
│   ├── mem/
│   │   ├── raw_buf.jni            # Module path: std::mem::raw_buf
│   │   ├── raw_buf.jn
│   │   ├── arena.jni              # Module path: std::mem::arena
│   │   └── arena.jn
│   ├── collections/
│   │   ├── vec.jni                # Module path: std::collections::vec (import std::mem::raw_buf)
│   │   ├── vec.jn
│   │   ├── vec_deque.jni          # Module path: std::collections::vec_deque
│   │   ├── vec_deque.jn
│   │   ├── hash_map.jni           # Module path: std::collections::hash_map
│   │   ├── hash_map.jn
│   │   ├── lru_cache.jni          # Module path: std::collections::lru_cache (effects [AllocGC])
│   │   └── lru_cache.jn
│   ├── str/
│   │   ├── str_view.jni           # Module path: std::str::str_view
│   │   └── str_view.jn
│   └── io/
│       ├── cursor.jni             # Module path: std::io::cursor (import std::str::str_view)
│       ├── cursor.jn
│       ├── buf_reader.jni         # Module path: std::io::buf_reader
│       └── buf_reader.jn
└── .jenny-cache/                  # Module-granular CAS build cache (c99/*.h, c99/*.c, obj/*.o)
```

### 2.3 Explicit Imports & Module-Granular Lazy Subgraph Pruning
1. **Wildcard Imports Are Statically Forbidden (`E0501_WILDCARD_IMPORT_FORBIDDEN`)**:
   ```jenny
   module std::collections::vec

   import std::mem::raw_buf::{RawBuf, AllocError}
   import std::mem::arena as mem_arena
   ```
2. **Lazy Subgraph Resolution (Eliminating Monolithic Package Bloat)**:
   * Starting from the target entry module's `import` declarations, `spindle` traverses and loads *only* the reachable `<dep_mod>.jni` files—never parsing or compiling unreferenced sibling modules within the same package.
   * **Empirical Verification in `v0.2`**: Importing `std::mem::arena::{Arena}` compiles only `arena.{jni,jn}` and contributes `0 ms` compile time and `0 bytes` from `std::collections` or `std::io`.
3. **Physical `.jni` Header Firewall (`.jenny-cache/c99/<pkg>__<mod>.h`)**:
   * Each reachable `<mod>.jni` is lowered into a standalone C99 header `.jenny-cache/c99/<pkg>__<mod>.h`. Downstream `<consumer>.jn` modules compile solely against upstream `.jni` headers—guaranteeing **0% downstream recompilation whenever `<mod>.jn` is refactored or optimized without changing `<mod>.jni`**.

---

## 3. Phase 2 (`v0.2-alpha2`): White-Box Intent Auditing & Supply-Chain Effect Firewall

### 3.1 Automatic White-Box Capability Fingerprinting (`spindle audit`)
Without reading a single line of `.jn` implementation code, `spindle audit` inspects a package's `.jni` blueprints to produce a compiler-guaranteed capability profile:
* **Memory Track Profile**: Pure stack views (`T`), unique native heap (`*T`), or managed GC handles (`^T`);
* **Effect Profile**: Exact side-effect set (`Pure []`, `AllocGC`, `IO`, `Unsafe`) and C FFI headers;
* **Contract Coverage Profile**: Precondition, postcondition, struct invariant, and `@example` counts.

### 3.2 Permanent Abolition of `build.rs` Scripts & Consumer `allow_effects` Sandboxing
1. **No Arbitrary Host Build Scripts (`No build.rs / postinstall`)**: Package resolution, checking, and compilation never execute arbitrary host-OS code. All compile-time metaprogramming runs inside the zero-I/O, zero-network `@spin` sandbox (materialized to `.spun/`), and all C libraries are declared statically under `[c_dependencies]`.
2. **Consumer-Side `allow_effects` Gating (`E0503_PACKAGE_EFFECT_ESCALATION`)**:
   ```toml
   [dependencies]
   # A hard-realtime audio module imports `std` with `allow_effects = []`:
   # It can freely use `std::mem::RawBuf` and `std::collections::Vec` (*T),
   # but any attempt to import `std::collections::LruCache` (AllocGC) is blocked at compile time (E0503)!
   std = { path = "../std", allow_effects = [] }
   ```

---

## 4. Phase 3 (`v0.2-beta`): Contract-Driven SemVer & Single-Module Hot-Swapping

### 4.1 AST-Level Contract Diffing (`spindle semver-check`)
`spindle semver-check` mechanically compares the `.jni` formal AST and `.jn` hash between versions:
1. **`IMPL_PATCH` (`jni_abi_hash` identical, only `.jn` changed)**: Enables **single-module `.jn` / `.o` hot-swapping** without recompiling downstream modules.
2. **`CONTRACT_MINOR` (Covariant/Contravariant Compatible)**: Adds new `pub` items, weakens `requires`, or strengthens `ensures`.
3. **`CONTRACT_BREAKING` (`E0504_CONTRACT_SEMVER_BREAK`)**: Alters existing `pub` signatures/layouts, adds `effects`, tightens `requires`, or weakens `ensures`/`invariant`.

### 4.2 Automated Stateful Differential Fuzzing on Upgrade (`spindle upgrade --verify-diff`)
Before accepting an updated `.jn` implementation, `spindle` executes 1,000-step stateful method-sequence differential fuzzing (`--fuzz` + `--diff`) comparing the old and new `.jn` binaries on identical random operation streams.

---

## 5. Phase 4 (`v0.2` Final / `v0.3`): Contract-Provider Decoupling & Pure `.jni` Blueprint Weaving

1. **Decoupling `.jni` Contract Packages from `.jn` Implementation Providers**: Shared `.jni` specifications (`jni_abi_hash`) allow multiple libraries to exchange canonical types without Rust-style diamond version type splits.
2. **Pure `.jni` Blueprint Dependencies (`[blueprints]`)**: For self-contained algorithms and data structures, projects can import a community-verified `.jni` blueprint (`requires`/`ensures`/`invariant`/`@example`) and synthesize a zero-dependency local `.jn` implementation verified by the compiler.

---

## 6. Package & Module Diagnostic Error Codes (`E0501`–`E0505`)

| Error Code ID | Rollout Phase | Trigger Condition | Deterministic `--ai-json` Quick-Fix |
| :--- | :---: | :--- | :--- |
| **`E0501_WILDCARD_IMPORT_FORBIDDEN`** | Phase 1 | Wildcard import `import std::collections::*` | Replace with explicit symbol list `import std::collections::{Vec, HashMap}` |
| **`E0502_CIRCULAR_MODULE_DEPENDENCY`** | Phase 1 | Cycle detected in module `import` DAG (`mod_a -> mod_b -> mod_a`) | Extract shared types/traits into a leaf `.jni` module |
| **`E0503_PACKAGE_EFFECT_ESCALATION`** | Phase 2 | Calling an imported module/function whose `effects` exceed `allow_effects` in `Tapestry.toml` | Remove the unauthorized call or explicitly grant the effect in `Tapestry.toml` |
| **`E0504_CONTRACT_SEMVER_BREAK`** | Phase 3 | Breaking `.jni` contract/signature change without a major/breaking version bump | Restore contract compatibility or bump package version |
| **`E0505_VISIBILITY_VIOLATION`** | Phase 1 | Accessing module-private or `pkg`-internal symbols across module/package boundaries | Use only exported `pub` declarations from the target `.jni` blueprint |
