# 🗺️ Spinning Jenny `v0.2` Roadmap (`Jenny-Std`: Building the Standard Library Benchmarked Against Rust `std`)

> **Release Codename**: `v0.2.0` (`Jenny-Std`: Real-World Standard Library Construction Benchmarked Against Rust `core` / `alloc` / `std`)  
> **Release Status**: 🟡 **Planned — Next Target Release**  
> **Strategic Focus**: In `v0.1` (`Jenny-Proto`), we validated the language core across 25 synthetic single-file micro-benchmarks (`B01`–`B25`). In **`v0.2` (`Jenny-Std`)**, we move from synthetic benchmarks to a foundational real-world systems workload: **building Jenny's official Standard Library (`std::*`) directly modeled after and benchmarked against Rust's `core`, `alloc`, and `std`**. Every `.jni` blueprint and `.jn` implementation becomes a permanent asset of the language toolchain while serving as an industrial testbed for multi-module linking, true 64KB Immix GC, 10,000-step stateful container fuzzing, and same-model counterfactual evaluations (`Jenny std` vs. `Rust std`).  
> 🌐 **Language**: **English** | **[简体中文 (`../zh/roadmap/roadmap_v0.2.md`)](../zh/roadmap/roadmap_v0.2.md)** · **Master Roadmap**: [`ROADMAP.md`](../../ROADMAP.md) · **Previous Release**: [`roadmap_v0.1.md`](./roadmap_v0.1.md)

---

## 1. Why Build `std::*` (vs. Rust `std`) as the `v0.2` Real-World Testbed?

1. **Permanent Toolchain Asset + High-Validity Systems Benchmark**:
   * Standard library containers and I/O primitives (`Vec`, `VecDeque`, `HashMap`, `LruCache`, `BTreeMap`, `String`/`StrView`, `BufReader`/`BufWriter`, `PathBuf`) embody the hardest real-world systems challenges: geometric buffer reallocation, slice bounds safety, Robin Hood hash collision resolution, doubly-linked eviction lists, and streaming cursor state machines.
   * Benchmarking Jenny's `std` directly against Rust's `alloc` and `std` eliminates any concern of "author-tailored toy tasks."
2. **Targets Rust's Exact Pain Points (`unsafe` & Lifetime Explosion)**:
   * Implementing `LinkedList`, `LruCache`, `BTreeMap`, or `RawVec` in Rust requires pervasive `unsafe` raw pointers (`NonNull<T>`, `ptr::read/write`) and intricate lifetime bounds. Jenny's dual-track memory (`*T` unique heap buffers, `*in(arena) T` region pools, and `^T` Immix-managed cyclic nodes) + `invariant` contracts express these data structures **with zero `unsafe` and zero `<'a>` annotations**.
3. **Ideal Target for 10,000-Step Stateful Property Fuzzing (`--fuzz v2`)**:
   * Containers carry crisp mathematical invariants (`len <= cap`, key-value lookup consistency after `insert`/`remove`, cursor `pos <= filled <= cap`), enabling automated 10,000-step random method-sequence fuzzing and differential comparison against Rust `std`.

---

## 2. Five Core `std/` Module Clusters in `v0.2`

| `std/` Module Cluster | Core Components (`.jni` + `.jn`) | Counterpart in Rust `std` | Systems Capabilities & Verification Focus |
| :--- | :--- | :--- | :--- |
| **1. `std::mem` & `std::slice`** | `RawBuf` / `ByteBuf` (`*T` 2x geometric growth, `reserve`, `split_at`), `Arena` (`*in(arena) T`), `GcPool` (`^T` 64KB Immix block allocator) | `alloc::raw_vec::RawVec`<br>`core::slice` | • True 64KB block + 128B line Immix mark-region GC (`M0.2.2`)<br>• Exception-safe `*T` reallocation & ASan/UBSan verification |
| **2. `std::collections`** | `Vec<T>`, `VecDeque<T>`, `HashMap<K, V>` (Robin Hood open addressing), `LruCache<K, V>` (`^T` doubly-linked list + hash table with eviction), `BTreeMap<K, V>` | `alloc::vec::Vec`<br>`std::collections::{VecDeque, HashMap, LinkedList, BTreeMap}` | • Generic container support & cross-file `import std::*` (`M0.2.1`)<br>• 10,000-step stateful method-sequence fuzzing (`M0.2.3`)<br>• Same-model (`3b`/`7b`) Jenny `std` vs. Rust `std` (`rustc`) evaluation |
| **3. `std::str` & `std::fmt`** | `StrView` (UTF-8 validation, zero-copy `split`/`trim`/`find`/`parse_int`), `StringBuf` (`*StringBuf` dynamic builder & formatting), `InternPool` | `core::str`<br>`alloc::string::String`<br>`core::fmt` | • Auto-inferred stack-bound view `struct` escape prevention (`E0203`)<br>• Zero-allocation slice parsing throughput |
| **4. `std::io` & `std::path`** | `Cursor`, `BufReader`, `BufWriter` (`delegate` forwarding), `PathView` & `PathBuf` (cross-platform path normalization) | `std::io::{Cursor, BufReader, BufWriter}`<br>`std::path::{Path, PathBuf}` | • Multi-module dependency chains (`std::io` importing `std::mem` & `std::str`)<br>• Cross-module `.jni` context savings ($\text{ECC} \ge 75\%$) & ABI firewall |
| **5. `std::sync` & `std::codec`** | `MpscRing` (bounded channel), `Varint`, `JsonScanner`, `Crc32` (`@spin` white-box codegen + C FFI hardware acceleration) | `std::sync::mpsc`<br>`serde` / `prost` core subset | • `@spin` white-box expansion in standard library protocol layers<br>• Zero-glue C FFI (`import c`) & `-O3` native runtime benchmarks |

---

## 3. Dual-Track Milestones & Gate Criteria

### 🛠️ Track 1: Compiler & Runtime Hardening (`Compiler Track v0.2`)
* **`M0.2.1` (Multi-Module Package System & Container Generics)**: Support `import std::*`, cross-file `.jni` header generation (`.jenny-cache/c99/std_<mod>.h`), `.jni` ABI firewall across multi-file DAGs, and parameterized containers.
* **`M0.2.2` (True 64KB Block-Structured Immix GC & Sanitizer Gate)**: Replace the 1,024-slot `calloc` table in `jenny_rt.h` with a 64KB block / 128B line Immix bump-pointer + mark-region sweep collector supporting $\ge 100,000$ cyclic node allocations/evictions under `clang -fsanitize=address,undefined`.
* **`M0.2.3` (Stateful Container Method-Sequence Fuzzing `--fuzz v2` & `--diff`)**: Synthesize 10,000-step random method sequences (`push`/`pop`/`insert`/`get`/`remove`/`seek`) for stateful `struct` types, checking `invariant` and `ensures(old)` after every step, plus `jenny diff` binary regression.
* **`M0.2.4` (Unified `jenny` CLI & All-Paths `E0108 v2`)**: Unify `jenny_nano.py` and `jenny_flow.py` into a single `jenny` CLI and upgrade `E0108` to verify field assignments across all non-error control-flow branches.

### 🏛️ Track 2: `std` Construction & Counterfactual Evaluation (`Std & PL-LLM Track v0.2`)
* **`P0.2.1` (`std/` Five-Cluster Implementation)**: Deliver 15–20 production-grade `std::*` components passing `-O3`, ASan/UBSan, `@example`, and 10,000-step stateful fuzzing.
* **`P0.2.2` (Same-Model Counterfactual Study: Jenny `std` vs. Rust `std` vs. Go + Ablation)**: Evaluate `qwen2.5-coder:3b` and `7b` implementing identical `std` components in Jenny, Rust (`rustc --error-format=json`), and Go (`go test`), with full ablation of `--skeleton` and `apply_ai_json_fixes`.
* **`P0.2.3` (Hierarchical Dual-Agent `std` Synthesis)**: Evaluate Frontier Architect LLM (`.jni` blueprint authoring) + Local `3B` Coder LLM (`.jn` implementation synthesis) across multi-module `std` packages.
* **`P0.2.4` (Native Runtime Performance Benchmark vs. Rust `std -O3`)**: Compare execution time and peak RSS memory across 1M `Vec` ops, 100K `HashMap` lookups, 100K `LruCache` evictions, and `BufReader` streaming throughput.
