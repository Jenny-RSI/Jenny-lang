# Jenny Language Specification — Module 10: Sub-Second Incremental Compilation and Zero-Bloat Intermediate Artifact Architecture

> **Language**: English | [中文版 (Chinese)](../../zh/design/specs/10_fast_compilation_and_anti_bloat.md)  
> **Status**: Finalized (v2.0-spec)  
> **Core Theme**: Drawing deep engineering lessons from the slow compilation times and multi-tens-of-gigabytes `target/` directory bloat of Rust and C++, Jenny combines five architectural pillars—**the `.jni` Compilation Firewall, Debug-by-Default Dictionary Polymorphism, Built-in Bytecode `@spin`, Separated Line Tables, and a Bounded LRU Content-Addressable Cache**—to achieve **sub-second incremental verification and 1/20th the disk footprint** inside high-frequency AI Edit-Compile-Verify loops.

---

## 1. Post-Mortem on Legacy Languages: Why Does Rust's `target/` Directory Explode?

Before designing the Jenny compiler (`jennyc`) and build system (`spindle`), we systematically dissected the five root causes behind 10 GB–30 GB build directories and sluggish incremental compilation in traditional systems languages (exemplified by Rust), and engineered targeted architectural remedies for each:

| Five Bloat Pathologies in Legacy Languages (Rust/C++) | Physical Root Cause of Bloat & Slowness | **Targeted Architectural Remedy in `jennyc`** |
| :--- | :--- | :--- |
| **1. Unchecked Generic Monomorphization & Cross-Package Duplication** | Duplicates 100% of machine code for every generic instantiation even in Debug builds; separate Crates instantiating `Vec<String>` redundantly compile and store identical machine code and symbols in their own `.rlib` archives. | **Debug Dictionary Passing by Default (Zero Duplication) + Release Monomorphization + Permanent `^T` Pointer Erasure**: In development builds, each generic function emits **only 1 copy** of machine code globally! |
| **2. Single-File Mixing Causing Cascading Rebuilds & Fat `.rlib` Metadata** | Lacking interface file isolation, editing a single private line inside a function body invalidates and recompiles all downstream dependent Crates; `.rlib` files must bundle full serialized MIR and AST payloads. | **`.jni` Blueprint Compilation Firewall (ABI Firewall)**: As long as `<module>.jni` is unchanged, an AI can rewrite `<module>.jn` ten times and **downstream dependent modules incur 100% zero recompilation**! |
| **3. Redundant DWARF Debug Symbol Duplication (70% of Disk Footprint)** | Generics and massive async state machines produce symbol names tens of thousands of characters long, and full DWARF type tables are copied 3–4 times across `.o`, `.rlib`, incremental caches, and final binaries. | **Default Lightweight Line-Tables-Only + On-Demand Split DWARF**: Daily development and AI loops emit only line-number mapping tables (5% of full size); deep debugging uses zero-copy `.dwo` split references. |
| **4. Procedural Macros Compiling Full Parsers into Host Dynamic Libraries** | Every `@derive` macro pulls in and compiles massive `syn`/`quote` parser libraries, littering hundreds of megabytes of host `.dll`/`.so` plugin binaries on disk. | **Built-in Meta-VM Bytecode Sandbox**: `@spin fn` directly shares the compiler's in-memory AST with zero external parser dependencies and zero `.dll` plugin artifacts, outputting only a few kilobytes of `.spun/*.jn` source text! |
| **5. Unbounded Accumulation of Stale Hash-Fingerprinted Artifacts** | Every tweak to environment variables or feature flags spawns new hash-suffixed CGU object files that accumulate indefinitely without automatic eviction. | **Bounded LRU Content-Addressable Store (Bounded CAS Store)**: All intermediate artifacts reside in a single content-addressed cache pool with a default hard cap of **2 GB** and automatic LRU eviction of stale artifacts. |

---

## 2. Pillar 1: The `.jni` Blueprint Compilation Firewall

Jenny's **physical separation of `.jni` (literate blueprint) and `.jn` (behind-the-scenes implementation)** not only serves human readability—it constructs a natural **incremental compilation firewall** in the compiler dependency graph:

```
[ Module A: parser.jni ] ◄────(Depends ONLY on .jni blueprint hash)──── [ Module B: compiler.jn ]
           ▲
 (Bidirectional Isomorphic Impl)
           │
[ Module A: parser.jn  ]  🔥 AI rewrites 500 lines of internal logic inside parser.jn!
```

1. **Downstream Modules Depend Exclusively on Upstream `.jni` Blueprint AST Hashes**:
   * When compiling Module B, **100% of the contract information required by the type checker, borrow checker, and effect verifier (memory tracks `*`/`^`, type layouts, function signatures, `effects`, and pre/postconditions) is contained inside `parser.jni`**.
   * **Sub-Second Recompilation Theorem**: As long as the hash of the formal ```` ```jenny ```` blocks in `parser.jni` does not change, no matter how extensively the AI modifies or refactors function bodies inside `parser.jn`, **downstream `compiler.jn` requires zero re-typechecking and zero machine-code regeneration**—only the single modified object unit is re-stitched in the final step by a high-speed linker (`mold` / `lld`)!
2. **Eliminating Fat `.rlib` Metadata Archives**:
   * Non-generic functions never leak implementation IR across module boundaries; downstream modules link directly against compiled upstream symbols without carrying redundant serialized function-body IR in intermediate libraries.

---

## 3. Pillar 2: Dual-Mode Generic Engine ("Debug Dictionary Polymorphism vs. Release Monomorphization")

To eliminate generic compilation latency and code-size explosion, Jenny schedules Module 04's "Tri-Mode Generic Strategy" dynamically based on build profile:

### 3.1 `^T` Managed Handles: Permanent Uniform Pointer Erasure Across All Profiles
* In both Debug and Release modes, `Array<^User>`, `Array<^Order>`, and `Map<String, ^Session>` **permanently share a single `Array<^GcObject>` machine-code implementation**—compiled once with 0% code bloat.

### 3.2 Value Types `T` and `*T`: Debug Dictionary Passing vs. Release Monomorphization
| Build Profile | Generic Compilation Strategy | Compile Time & Intermediate Size Impact |
| :--- | :--- | :--- |
| **`jenny check` / `jenny weave` / `jenny build --debug`** (Daily development & AI self-healing loop) | **Enables `@dynamic` Dictionary Passing by Default (Witness Table + Size Descriptor)** | A generic function `fn sort<T: Comparable>(mut arr: []T)` is **compiled only once** across the entire project! Completely eliminates LLVM's overhead of optimizing thousands of monomorphized clones, shrinks intermediate `.o` size by **80%**, and cuts AI edit-verify turnaround to **50–200 ms**! |
| **`jenny build --release`** (Production release profile) | **Enables Static Monomorphization + Cross-Module LTO Inlining** | Emits specialized machine code for all value types and `*T` instantiations, eliminating vtable indirection and unlocking SIMD auto-vectorization (except on functions explicitly marked `@dynamic` to minimize Wasm binary size). |

---

## 4. Pillar 3: Tiered Debug Symbols and Zero-Copy Split DWARF

To cure the pathology of DWARF debug info filling up disks during Debug builds, Jenny partitions debug information into three on-demand tiers:

1. **Level 1 (Default Development & AI Verification Mode: `--debug-info=line-tables`)**:
   * Emits only compact **source file path and line-number mapping tables (including real line numbers for `.jn` and `.spun/`)** and function symbol names, omitting massive local type layout trees.
   * **Benefit**: Sufficient to print 100% exact source stack traces upon a `panic`, contract violation, or `@example` failure while slashing object file size by **90%**!
2. **Level 2 (Interactive Human Breakpoint Debugging: `--debug-info=split`)**:
   * When a developer launches the DAP breakpoint debugger from an IDE, the compiler enables **Split DWARF (`.dwo`)**: debug symbols remain inside their respective compilation cache units so **the linker never reads, merges, or copies DWARF sections**, speeding up linking by 5x–10x with zero disk duplication.
3. **Level 3 (Standalone Release Symbol Packages: `--debug-info=full`)**:
   * Generated on demand only when packaging production crash-reporting symbol bundles (`.dSYM` / `.pdb` / `.debug`).

---

## 5. Pillar 4: Bounded LRU Content-Addressable Build Cache (Bounded CAS Store)

Jenny replaces the legacy practice of scattering multi-gigabyte `target/` directories inside every project workspace with a centralized, **`spindle`-managed Bounded Content-Addressable Cache**:

1. **Fine-Grained Function/Module Hash Addressing**:
   * Compilation artifacts are indexed in a high-performance local CAS pool (`.jenny-cache/`) keyed by `(CompilerVersion, TargetPlatform, JniBlueprintHash, JnFunctionAstHash)`.
   * Even after switching Git branches or checking out older commits, any unchanged function AST hits the cache in **0.0 ms**!
2. **Cross-Project Sharing of Third-Party Package Artifacts**:
   * Multiple Jenny projects on the same machine importing the same version of `std` or community `spindle` packages share precompiled artifacts directly from the global cache pool—never recompiling or duplicating storage per workspace.
3. **Hard Capacity Cap & Automatic LRU Garbage Collection (Auto-GC)**:
   * Default cache watermarks are configured in `Tapestry.toml` or global settings (e.g., **512 MB** per project, **2 GB** for the global shared pool).
   * After each build, a background daemon fiber transparently evicts least-recently-used (LRU) historical build fragments above the watermark—**developers never need to run manual `clean` commands, and build caches never exhaust disk space**!
