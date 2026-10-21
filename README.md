# 🧵 Spinning Jenny (`Jenny`) Programming Language

> ***"In 1764, the Spinning Jenny wove the Industrial Revolution. Today, Jenny weaves Human Intent and AI Intelligence into verified computer code."***

[![Language Spec](https://img.shields.io/badge/Language_Spec-v2.0-blue.svg)](./docs/design/specs/00_index_and_overview.md)
[![Compiler Prototype](https://img.shields.io/badge/Compiler-v0.1.0_C99_Native-success.svg)](./compiler/)
[![Benchmarks](https://img.shields.io/badge/Jenny--Bench--25-25%2F25_Passed-brightgreen.svg)](./benchmarks/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

🌐 **Language**: **English** | **[简体中文 (`README_zh.md`)](./README_zh.md)** · 📄 **[Technical Paper (EN)](./docs/paper/spinning_jenny_paper_en.md)** | **[技术论文 (中文)](./docs/paper/spinning_jenny_paper_zh.md)**
** [Introduction: ](./docs/articles/introducing_spinning_jenny_zh.md) **
---

## 🌟 Why Spinning Jenny?

**Spinning Jenny (`Jenny`; implementation files `.jn`, blueprint files `.jni`)** is an **AI-native, multi-paradigm systems programming language** that rebuilds the human/AI division of labor from first principles.

Traditional languages assume that a human types every line of code. When an AI fills in the ambiguity and uncertainty of natural language by guessing, and generates code far faster than a human can read or audit it, **humans and AI end up working blind together**, which is jokingly called "Vibe Coding". Jenny was designed from day one for a different paradigm: **humans and architect models define intent and contracts (`.jni`) x small coding models synthesize the implementation behind the scenes (`.jn`) x the compiler performs zero-trust contract acceptance (`jenny`)**. It adopts five hard quantitative metrics as the targets of language evolution, so that data drives the language to evolve itself, aiming for a 10x or greater gain in code production efficiency.

* **Latest completed version**: **`v0.1` (`Jenny-Proto v0.1.0`, completed)**. See [`docs/roadmap/roadmap_v0.1.md`](./docs/roadmap/roadmap_v0.1.md) and the technical paper ([English](./docs/paper/spinning_jenny_paper_en.md) | [Chinese](./docs/paper/spinning_jenny_paper_zh.md)).
* **Next target version**: **`v0.2` (`Jenny-Std`: building the `std` standard library as the real proving ground, benchmarked against Rust `std`)**. See [`docs/roadmap/roadmap_v0.2.md`](./docs/roadmap/roadmap_v0.2.md).

### Why it exists

Unstructured LLM-assisted software development ("Vibe Coding") faces a severe **Engineering Deployment Paradox**:
1. **Human-Centric Languages Cause LLM Hallucinations**: Mainstream systems languages (C/C++, Rust, Go) were designed for human keyboard entry rather than autoregressive token generation. C/C++ lacks compile-time memory safety; Rust's symbolic borrow checker (`&T`, `&mut T`), explicit lifetime parameters (`<'a>`), and single-owner tree constraints frequently trap LLMs in multi-round compilation failures; and Go's repetitive `if err != nil` boilerplate inflates context budgets.
2. **Human Audit Blindness**: LLMs emit hundreds of lines of code per second—far beyond human line-by-line review capacity. When architectural intent, interface contracts, and low-level implementation details are entangled inside a single source file, **both humans and AI operate in mutual blindness**, causing catastrophic alignment drift between human intent and generated systems.

**Spinning Jenny (`Jenny`)** is an AI-native systems programming language co-designed from first principles to resolve this paradox through a **Top-Down Intent Decomposition & Bottom-Up Mechanical Verification** loop:
* **Humans & Frontier Architect Models** specify intent, boundaries, and formal contracts in **`.jni` (Literate Contract Blueprints)**;
* **Coding Models** synthesize low-level implementations in **`.jn` (Implementation Modules)** within a compact context window;
* **The `jenny` Compiler** mechanically verifies both via runtime-woven contracts (`requires`, `ensures(old)`, `invariant`), compile-time `@example` sandboxes, and structured `--ai-json` self-healing diagnostics.

---

## 🔥 Core Innovations

### 1. 📄 Physical Separation of Literate Blueprints (`.jni`) & Implementations (`.jn`)
* **Native Markdown as First-Class Source**: The top level of a `<module>.jni` blueprint is standard Markdown prose (no `///` comment noise). Formal types, signatures, and contracts live inside fenced ```` ```jenny ```` code blocks.
* **Cross-Module Context Savings & ABI Firewall**: Importing a module requires loading only its `.jni` formal declarations (**saving 65.31% of self-context tokens and 69.41% vs. Rust production code**). Modifying `<module>.jn` without altering `<module>.jni` preserves `jni_abi_hash`, guaranteeing **zero downstream recompilation**.

### 2. 🛡️ First-Class Verifiable Contracts & Four-Layer Automated Testing
* **Zero Separate `_test` File Overhead**: Contracts (`requires ... else Error`, `ensures (result / old)`, `struct invariant`, and `@example`) are declared directly in `.jni` and automatically woven into C99 runtime checks (exit code `42` on violation) plus static assignment verification (`E0108`).
* **Built-In Verification Pipeline**:
  * **Layer 1**: Compile-time `@example` native sandbox execution (**49/49 passed** across `B01`–`B25`).
  * **Layer 2**: Automated scalar contract fuzzing & 20-round `@example` leak-checked stress replay (`--fuzz`, **2,480 invocations**, `0` native `*T` leaks).
  * **Layer 3**: 26-case fault-injection regression suite (`--mutate`, **13 runtime contract violations + 13 static safety violations**, 100% caught).

### 3. 🧬 Sigil-Free Three-Mode Parameters & Dual-Track Memory / Closures
* **No `&T`, `&mut T`, or `<'a>`**:
  * **`x: T` / `self` (Default Read-Only Borrow)**: Passed by value or `const T*`; **never moves or invalidates the caller's binding**.
  * **`mut x: T` / `mut self` (Exclusive Mutable Borrow)**: Lowered to C99 `T* __restrict` (`JN_RESTRICT`) with static conflict checking (`E0202`).
  * **`own x: T` / `own self` (Ownership Transfer)**: Explicitly consumes ownership (`E0201` on use-after-own).
* **Dual-Track Three-State Storage & Closures**:
  * **Track 1 — Stack Values & Auto-Inferred Views (`T` / `fn(A) -> R`)**: Any `struct` containing `str` or `[]T` slices is automatically inferred as a stack-bound view (`E0203` / `E0205` prevent heap escape without `<'a>`).
  * **Track 2 — Unique Native Heap (`*T` / `*in(arena) T` / `*fn[own ...](A) -> R`)**: Deterministic RAII single-owner heap allocations and $O(1)$ region arenas with automatic cascade destructors.
  * **Track 3 — Managed Shared Handles (`^T` / `^fn(A) -> R`)**: Cyclic graphs and doubly-linked structures (`B16_lru_doubly_linked`) without `Rc<RefCell<T>>` or `unsafe`, statically gated by `effects [AllocGC]` (`E0204`).

### 4. ⚡ Three-Tier Error Truncation, `@spin` White-Box Metaprogramming & Zero-Glue C FFI
* **16-Byte Dual-Register `JnAnyError` (`T!`)**: Supports exact value errors (`T ! E`), domain-filtered errors (`T ! (BizError | AnyError)`), and top-level shorthand (`T!`), backed by a 16-slot thread-local error trace ring buffer.
* **White-Box `@spin` Templates (`.spun/`)**: First-class `delegate Trait to self.inner` and `@spin` / `@apply` templates (`fsm`, `codec`, `crud`) expand into readable, auditable `.spun/<module>.spun.jn` files (**11.37x implementation token compression** on declarative modules `B19`–`B21`).
* **Zero-Glue C FFI**: Direct `import c "header.h" as alias` with `@repr(C)`, explicit `.as_raw_ptr()` (`E0401`), `effects [Unsafe]` (`E0402`), and static blocking of `^T` across C boundaries (`E0403`).

---

## 📊 Empirical Highlights (`Jenny-Bench-25`, `v0.1.0`)

| Metric Category | Measured Result (`B01`–`B25`, 25 Modules) | Verification Command |
| :--- | :--- | :--- |
| **Total Code Token Compression ($\text{TCR}$)** | **`0.6833`** vs. Rust full (`13,215` vs. `19,339` tokens, **-31.67%**) · **`0.8819`** vs. Rust prod (`14,985` tokens) | `python benchmarks/eval/measure_tokens.py` |
| **Implementation Token Ratio ($\text{TCR}_{\text{impl}}$)** | **`0.2197`** vs. Rust full (`4,248` `.jn` tokens, **-78.03%**) · **`0.2835`** vs. Rust prod · **`0.0879` (`11.37x`)** on `@spin` (`B19`–`B21`) | `python benchmarks/eval/measure_tokens.py` |
| **Cross-Module Context Savings ($\text{ECC}$)** | **`65.31%`** (`ECC_self`) · **`69.41%`** (`ECC_vs_rs_prod`, `4,584` `.jni` interface tokens) | `python benchmarks/eval/measure_tokens.py` |
| **Native Sandbox & Fault Regression** | **`25/25`** C99 builds (`clang -O3`) · **`49/49`** `@example` sandboxes · **`26/26`** mutants caught · **`2,480`** `--fuzz` calls | `python compiler/jenny-flow/jenny_flow.py --mutate --build-native` |
| **Local `3B` LLM (`qwen2.5-coder:3b`) Self-Healing** | **`Pass@1 = 50.0% (9/18)` $\rightarrow$ `Heal@2 = 100.0% (18/18)`** · **`0.0%`** `&`/`<'a>` hallucination rate | See [Paper §7.4](./docs/paper/spinning_jenny_paper_en.md) |

---

## 🚀 Quick Start

### Prerequisites
* **Node.js v24+** (native TypeScript execution with zero `node_modules` dependencies)
* **Python 3.10+** (for evaluation scripts & historical baseline runners)
* **LLVM `clang`** (`clang -std=c11 -O3` on `PATH` or `C:\Tools\LLVM\bin\clang.exe`)

### Run Verification & Benchmarks
```powershell
# 1. Compile all 40 modules (B01-B25 + 15 library/std modules), run 79 @example sandboxes, and verify 18 Stage 1-4 mutants
node compiler/src/jenny.ts --mutate

# 2. Run automated contract fuzzing & stateful container fuzzing across all 40 modules (33,380 invocations, 0 leaks)
node compiler/src/jenny.ts --fuzz

# 3. Run Spindle white-box package audit, supply-chain fault injection (6/6), and contract SemVer verification (4/4)
node compiler/src/jenny.ts audit
node compiler/src/jenny.ts mutate
node compiler/src/jenny.ts semver-check

# 4. Measure token economy metrics (TCR / TCR_impl / ECC) across B01-B25
python benchmarks/eval/measure_tokens.py
```

---

## 📖 Documentation Index

* **Papers & Roadmaps**:
  * [Spinning Jenny Technical Paper (English)](./docs/paper/spinning_jenny_paper_en.md) · [技术白皮书与论文 (中文全文)](./docs/paper/spinning_jenny_paper_zh.md)
  * [Master Roadmap (`v0.1 -> v1.0`)](./ROADMAP.md) · [`v0.1` Completed Archive](./docs/roadmap/roadmap_v0.1.md) · [`v0.2 (Jenny-Std)` Next Release Plan](./docs/roadmap/roadmap_v0.2.md)
  * [`v0.1` Retrospective & Rust/Go Comparison](./docs/reports/v0.1_retrospective_and_cross_lang_comparison.md)
* **Architecture & Language Specifications (`v2.0`)**:
  * [Design Philosophy & Architectural Overview](./docs/design/philosophy_and_overview.md) ([中文](./docs/zh/design/哲学与总纲.md))
  * [Evolution Plan & Minimal Verification Suite](./docs/design/evolution_and_verification_suite.md) ([中文](./docs/zh/design/演进路线与最小验证集.md))
  * [Object Lifetime Management: Cross-Language Baseline](./docs/design/lifetime_management_cross_lang_baseline.md) ([中文](./docs/zh/design/对象生命期管理_AI跨语言痛点与实证基线.md))
  * [00 — Specification Index & v2.0 Panorama](./docs/design/specs/00_index_and_overview.md)
  * [01 — Dual-Track Memory & Three-Mode Parameter Model](./docs/design/specs/01_memory_and_ownership.md)
  * [02 — Type System & Algebraic Data Types (ADT)](./docs/design/specs/02_types_and_adt.md)
  * [03 — Lexical Rules, Orthogonal Syntax & Linear Control Flow](./docs/design/specs/03_syntax_and_control_flow.md)
  * [04 — Trait Contracts, Generics & Delegation](./docs/design/specs/04_traits_and_generics.md)
  * [05 — Three-Tier Error Truncation & Static Effect Contracts](./docs/design/specs/05_errors_and_effects.md)
  * [06 — `@spin` White-Box Metaprogramming & DSL Templates](./docs/design/specs/06_spin_metaprogramming.md)
  * [07 — Structured Concurrency (`Fiber`) & Fearless Parallelism](./docs/design/specs/07_concurrency_and_fiber.md)
  * [08 — Zero-Glue C FFI, Dual Wasm Backends & Ecosystem](./docs/design/specs/08_c_interop_wasm_and_ecosystem.md)
  * [09 — Literate Blueprints (`.jni`) & First-Class Contracts](./docs/design/specs/09_literate_blueprint_and_contracts.md)
  * [10 — Fast Incremental Compilation & Anti-Bloat Architecture](./docs/design/specs/10_fast_compilation_and_anti_bloat.md)
  * [11 — PL-LLM Co-Design & Empirical Training Flywheel](./docs/design/specs/11_llm_codesign_and_empirical_training.md)
  * [12 — Package Management, Module Resolution & Effect Firewall (`Spindle` & `Tapestry`)](./docs/design/specs/12_package_management_and_module_system.md)

---

## 📜 License

Licensed under the [MIT License](./LICENSE).
