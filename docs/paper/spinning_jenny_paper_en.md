# Spinning Jenny: Co-Designing an AI-Native Systems Programming Language with Literate Contracts, Dual-Track Memory, and Compiler-Guided Self-Healing

> **Language Specification Version**: Jenny Language Specification v2.0 (Compiler Prototype: `jenny-flow` C99 Backend v0.1)  
> **Date**: October 17, 2026  
> **Artifact & Reproducibility Suite**: [`Spinning Jenny Repository`](../../README.md) · [`25-Module Benchmark Suite (B01–B25)`](../../benchmarks/) · [`Token Measurement Script`](../../benchmarks/eval/measure_tokens.py) · [`C99 Native Transpiler & Runtime`](../../compiler/jenny-flow/)  
> **Chinese Full Edition**: [`spinning_jenny_paper_zh.md`](./spinning_jenny_paper_zh.md)

---

## Abstract

Unstructured LLM-assisted software development ("Vibe Coding") faces a severe **Engineering Deployment Paradox**. On one hand, mainstream systems and engineering languages (C/C++, Rust, Go) were designed for human keyboard entry rather than autoregressive token generation: C/C++ lacks compile-time aliasing and lifetime checks, allowing silent memory vulnerabilities [1]; Rust's symbolic borrow checker (`&T`, `&mut T`), explicit lifetime annotations (`<'a>`), and single-owner tree constraints frequently trigger multi-round compilation failures [2]; and Go's repetitive error handling (`if err != nil`) inflates token budgets. On the other hand, LLMs generate code far faster than humans can read and audit line by line. When architectural intent, interface contracts, and low-level implementation details are entangled within a single source file, **both humans and AI operate in mutual blindness**, risking alignment drift between human requirements and generated implementations.

We argue that AI-era software engineering must not degenerate into black-box code generation; **physically decoupling human-auditable architectural specifications from LLM-synthesized implementations—verified mechanically by the compiler—provides a principled path toward human-AI collaboration**. We present **Spinning Jenny (`Jenny`)** (Specification v2.0), a prototype systems programming language co-designed for token economy and compiler-guided self-healing:
1. **Physical Separation of Literate Contract Blueprints (`.jni`) and Implementations (`.jn`)**: Building on Knuth's Literate Programming [8] and Design by Contract [6], `.jni` uses native Markdown to express architectural intent while embedding formal `jenny` code blocks with first-class contracts (`requires`, `ensures(old)`, `invariant`, `@example`) that lower into C99 runtime assertions and an ABI compilation firewall (`jni_abi_hash`).
2. **Sigil-Free Three-Mode Parameters and Dual-Track Memory / Closures**: Extending Mutable Value Semantics [5], Jenny eliminates `&T`, `&mut T`, and `<'a>` in favor of read-only borrow by default (`x: T`), exclusive mutable borrow (`mut x: T`, lowered to C99 `restrict`), and explicit ownership transfer (`own x: T`). Storage and closures are partitioned into stack-bound views (`T` / `fn`), unique native heap allocations (`*T` / `*in(arena) T` / `*fn[own ...]` with cascade destructors), and pooled managed handles (`^T` / `^fn`, statically gated by `effects [AllocGC]`).
3. **Three-Tier Error Truncation and `@spin` White-Box Metaprogramming**: Jenny provides a 16-byte dual-register `JnAnyError` (`T!`), a 16-slot thread-local error trace ring buffer, first-class trait delegation (`delegate`), and compile-time templates (`@spin` / `@apply`) materialized as auditable source files in `.spun/*.spun.jn`.
4. **Empirical Evaluation on `Jenny-Bench-25` and `3B` LLM Skeleton Completion**: Across 25 single-file benchmark modules (`B01`–`B25`, 75 `.jni`/`.jn`/`.rs` files) compiled to native binaries via C99 (`clang 18.1.8 -O3`), Jenny's total code tokens (`.jni` fenced blocks + `.jn`, `13,215` tokens) are **31.67% fewer** than full Rust baselines (`19,339` tokens, $\text{TCR} = 0.6833$) and **11.81% fewer** than Rust production code excluding `#[cfg(test)]` (`14,985` tokens, $\text{TCR}_{\text{vs\_prod}} = 0.8819$). Across `B01`–`B24`, $\text{TCR} = 0.6594$, while `B25` (a 3-track closure micro-benchmark) exhibits a negative trade-off ($\text{TCR} = 1.7595$) due to explicit closure environment struct and contract declarations. Jenny's `.jn` implementation files (`4,248` tokens) represent **21.97%** of full Rust ($\text{TCR}_{\text{impl}} = 0.2197$) and **28.35%** of Rust production code ($\text{TCR}_{\text{impl/prod}} = 0.2835$), reaching **`0.0879`** on the `@spin` declarative subset (`B19`–`B21`, `292` handwritten `.jn` tokens; `1,141` tokens after `.spun/` expansion). On an 18-module skeleton-completion benchmark using an un-finetuned `qwen2.5-coder:3b` model (`temperature = 0.0`, 4GB GPU), compilation and `@example` pass rates improve from **`Pass@1 = 50.0% (9/18)` to `Heal@2 = 100.0% (18/18)`** with `--ai-json` diagnostics and deterministic quick-fix assistance.

---

## 1. Introduction & Quantitative Metrics

### 1.1 The Mutual Blindness of Unstructured "Vibe Coding"
Mainstream systems languages force LLMs and human reviewers into a coupled single-file representation:
* **LLM Generation Friction**: Pearce et al. [1] show that ~40% of Copilot completions in C/Python security scenarios contain CWE vulnerabilities; Deligiannis et al. [2] show that Rust compilation failures in LLM outputs cluster heavily around ownership moves (`E0382`), conflicting mutable borrows (`E0502`/`E0499`), and lifetime annotations (`E0597`/`E0106`).
* **Human Audit Bottleneck**: When LLMs emit hundreds of lines of implementation and boilerplate per second, humans cannot audit every line, while loading full implementation files across modules rapidly exhausts context windows and triggers "Lost in the Middle" degradation [3].

### 1.2 Three Orthogonal Metric Families (`measure_tokens.py`)
To avoid conflating test code, prose, and macro expansion, [`measure_tokens.py`](../../benchmarks/eval/measure_tokens.py) uses a deterministic lexical/subword regex counter (`TOKEN_PATTERN`, stripping `//` comments and blank lines) and reports three independent metric families:

1. **Implementation Writing Volume ($\text{TCR}_{\text{impl}}$ and $\text{TCR}_{\text{impl/prod}}$)**:
   $$\text{TCR}_{\text{impl}} = \frac{\text{Tokens}(\text{Jenny}_{.jn})}{\text{Tokens}(\text{Rust}_{\text{full}})}, \quad \text{TCR}_{\text{impl/prod}} = \frac{\text{Tokens}(\text{Jenny}_{.jn})}{\text{Tokens}(\text{Rust}_{\text{prod}})}$$
   where $\text{Rust}_{\text{prod}}$ strips `#[cfg(test)]` blocks (`14,985` production tokens vs. `4,354` test tokens across `B01`–`B25`). For `@spin`/`delegate` modules (`B18`–`B21`, `B24`), both handwritten `.jn` tokens and expanded `.spun/*.spun.jn` tokens are reported.
2. **Total Code and Full Document Volume ($\text{TCR}$, $\text{TCR}_{\text{vs\_prod}}$, and $\text{TCR}_{\text{doc\_all}}$)**:
   $$\text{TCR} = \frac{\text{Tokens}(\text{Jenny}_{.jni\text{ fenced}}) + \text{Tokens}(\text{Jenny}_{.jn})}{\text{Tokens}(\text{Rust}_{\text{full}})}, \quad \text{TCR}_{\text{vs\_prod}} = \frac{\text{Tokens}(\text{Jenny}_{.jni\text{ fenced}}) + \text{Tokens}(\text{Jenny}_{.jn})}{\text{Tokens}(\text{Rust}_{\text{prod}})}$$
   $$\text{TCR}_{\text{doc\_all}} = \frac{\text{Tokens}(\text{Jenny}_{.jni\text{ prose}}) + \text{Tokens}(\text{Jenny}_{.jni\text{ fenced}}) + \text{Tokens}(\text{Jenny}_{.jn})}{\text{Tokens}(\text{Rust}_{\text{full}})}$$
3. **Cross-Module Interface Footprint Savings ($\text{ECC}_{\text{self}}$ and $\text{ECC}_{\text{vs\_rs\_prod}}$)**:
   When importing a module, only `.jni` formal declarations excluding `@example` and prose ($\text{Jenny}_{.jni\text{ iface}}$) are required:
   $$\text{ECC}_{\text{self}} = 1 - \frac{\text{Tokens}(\text{Jenny}_{.jni\text{ iface}})}{\text{Tokens}(\text{Jenny}_{.jni\text{ fenced}}) + \text{Tokens}(\text{Jenny}_{.jn})}, \quad \text{ECC}_{\text{vs\_rs\_prod}} = 1 - \frac{\text{Tokens}(\text{Jenny}_{.jni\text{ iface}})}{\text{Tokens}(\text{Rust}_{\text{prod}})}$$

---

## 2. Literate Contract Blueprints (`.jni`), Implementation (`.jn`), and Contract Testing Prototype

### 2.1 `.jni` and `.jn` Separation & C99 Contract Weaving
Inspired by Knuth's Literate Programming [8], Modula-2 (`.def`/`.mod`) [9], and Meyer's Design by Contract [6], Jenny splits each module into:
* **`.jni` (Literate Contract Blueprint)**: Top-level standard Markdown prose with fenced ```` ```jenny ```` blocks containing `pub struct`/`enum`/`trait`, `pub fn` signatures, `effects [...]`, `requires`, `ensures(old)`, `invariant`, and `@example` blocks (**49 `@example` blocks** across `B01`–`B25`).
* **`.jn` (Implementation)**: Pure function bodies and `@spin`/`@apply` directives.
* **Static Assignment Check (`E0108_MISSING_ENSURES_FIELD_MUTATION`)**: Verifies whether struct fields referenced in unconditional `ensures` clauses appear as assignment targets in the `.jn` function body AST. Note that `E0108` is a lightweight syntactic assignment presence check rather than an SMT path prover; incorrect assigned values are caught at runtime by the C99-woven `ensures` assertions (exit code `42`).

### 2.2 Three-Layer Contract Testing Prototype & Planned Differential Architecture
Instead of asking an LLM to write separate `_test` files alongside implementation code, Jenny embeds `@example` and formal contracts in `.jni`:
1. **Layer 1 (Implemented — Compile-Time `@example` Sandbox)**: All **49 `@example` blocks** across `B01`–`B25` are lowered to `run_example_N()` in C99 and executed immediately upon compilation.
2. **Layer 2 (Implemented Prototype — Scalar Contract Fuzzing & `@example` Stress Replay, `python compiler/jenny-flow/jenny_flow.py --fuzz`)**:
   * Synthesizes `static void run_contract_fuzz_suite(void)` (invoked via `-2`).
   * **Exact Scope & Prototype Limitations**: Currently selects free functions whose parameters and return types are read-only scalars (`i64/i32/u32/u16/u8/usize/bool` or `void`) and that declare `requires` or `ensures`. Across `B01`–`B25`, **15 scalar free functions across 11 modules** match this filter (100 iterations each = **`1,500` scalar calls** using a 16-constant boundary table `{-100, -10, -1, 0, 1, 2, 3, 4, 6, 8, 10, 16, 32, 50, 64, 100}` for `i < 16` and `xorshift64*` in `[-20, 99]` for `i >= 16`). It then replays all **49 `@example` blocks 20 times (`980` replays)**, calling `jn_gc_collect_all()` and dynamically asserting `jn_active_native_boxes() == 0` after each round, totaling **`2,480` scheduled invocations (`1,500 + 980`)**. Currently, `requires ... else Error` clauses execute as in-function error returns rather than pre-call solvers, `ensures` runs on `ok` return paths, and stateful struct method sequence synthesis is left to future work.
3. **Layer 3 (Implemented Regression Suite — 26 Hand-Crafted Fault Injections, `jenny_nano.py --mutate` + `jenny_flow.py --mutate`)**:
   A regression suite of **26 hand-written fault-injection cases**: **13 runtime contract-violation mutants** (11 in `jenny_nano.py --mutate` + 2 in `jenny_flow.py --mutate`, caught at runtime by `@example` assertions with exit code `42`) and **13 static violation mutants** (in `jenny_flow.py --mutate`, caught at compile time by diagnostic codes `E0106`, `E0201`–`E0206`, `E0305`–`E0307`, `E0401`–`E0403`).
4. **Layer 4 (Future Work — Differential Re-Weaving Oracle)**: Side-by-side binary differential testing across model upgrades is planned as future work.

---

## 3. Sigil-Free Dual-Track Memory, Three-Mode Parameters, and Three-Track Closures

### 3.1 Three-Mode Parameter Passing (Building on Mutable Value Semantics)

| Mode | Jenny Syntax | Hylo (Val) Counterpart | Rust Counterpart | Caller State Post-Call | C99 Lowering (`jenny_rt.h`) | Static Diagnostic Code |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Read-Only Borrow (Default)** | **`x: T`** / **`self`** | `let` (default) | `x: &T` / `&self` | **Valid** (Never moved) | Value or `const T*` | `E0106_READONLY_PARAM_MUTATION` |
| **Exclusive Mutable Borrow** | **`mut x: T`** / **`mut self`** | `inout` | `x: &mut T` / `&mut self` | **Valid** (Mutated in-place) | **`T* JN_RESTRICT`** (`__restrict`) | `E0202_CONFLICTING_MUT_BORROW` |
| **Ownership Transfer** | **`own x: T`** / **`own self`** | `sink` | `x: T` / `self` | **Consumed (Moved)** | Value / pointer + scope-exit `drop` | `E0201_USE_AFTER_OWN` |

### 3.2 Dual-Track Three-State Storage & Prototype Runtime (`jenny_rt.h`)
1. **Track 1: Stack Values & Auto-Inferred Views (`T`)**: Any `struct` containing `[]T` or `str` is automatically classified as a stack-bound view; heap boxing is statically rejected (**`E0203_VIEW_STRUCT_ESCAPE`**) without `<'a>` annotations.
2. **Track 2: Unique Native Heap (`*T`) & Region Arenas (`*in(arena) T`)**: Deterministic single-owner heap boxes (`jn_box_alloc` / `jn_box_free` tracking `_jn_active_native_boxes`) and $O(1)$ bump allocation in `JnArena` (`jn_arena_alloc` / `jn_arena_drop`).
3. **Track 3: Managed Shared Handles (`^T`) & Effect Gating (`effects [AllocGC]`)**: For cyclic structures (`B16_lru_doubly_linked`), `^T` provides managed handles statically gated by `effects [AllocGC]` (**`E0204_UNDECLARED_EFFECT`**). *Prototype Runtime Note*: In the current [`jenny_rt.h`](../../compiler/jenny-flow/jenny_rt.h), `jn_gc_alloc` uses `calloc` recorded in a fixed-capacity (1,024-slot) pointer registry, and `jn_gc_collect_all()` frees all registered pointers at epoch boundaries (replacing this pool with a 64KB block-structured Immix collector [4] is future work).

### 3.3 Three-Track Closure Lifetimes and Cascade Drop (`B25`)
* **Stack-Bound View Closure (`fn(A) -> R`, literal `(x) => expr`)**: 16-byte `{call, const void* env}` allocated on the C stack frame (`0` heap allocations; return escape blocked by **`E0205_STACK_CLOSURE_ESCAPE`**).
* **Unique Native Heap Closure (`*fn(A) -> R`, literal `*fn[own cap](x) => expr`)**: 24-byte `{call, drop_env, void* env}` with mandatory `[own ...]` capture (**`E0206_CLOSURE_MISSING_OWN_CAPTURE`**) and an automatically synthesized cascade destructor `_jn_closure_drop_N`.
* **Managed Shared Closure (`^fn(A) -> R`, literal `^fn(x) => expr`)**: 16-byte `{call, void* env}` allocated via `jn_gc_alloc`, gated by `effects [AllocGC]`.

---

## 4. Token Economy: Error Truncation, Delegation, `@spin`, and Zero-Glue C FFI

* **Three-Tier Error Truncation & 16-Byte `JnAnyError`**: Supports `T ! E` (exact value enum), `T ! (BizError | AnyError)` (domain-filtered), and `T!` (`T ! AnyError`), backed by a 16-byte `JnAnyError` (`_Static_assert(sizeof(JnAnyError) == 16)`) and a 16-slot thread-local trace ring buffer.
* **Trait Delegation (`B18`) & `@spin` White-Box Templates (`B19`–`B21`)**: `delegate Trait to self.inner` (`E0307`) and `@spin fsm::state_machine` / `@apply(codec::binary)` / `@apply(crud::service)` materialize auditable code into **`.spun/<module>.spun.jn`**, enforcing the Additive-Only Rule (**`E0306`**) and Binary Protocol GC Boundary Check (**`E0305`**).
* **Zero-Glue C FFI (`B22`)**: `import c "crc32_vendor.h" as c_crc` enforces explicit `.as_raw_ptr()` (**`E0401`**), `effects [Unsafe]` (**`E0402`**), and forbids passing `^T` handles to C (**`E0403`**).

---

## 5. Empirical Evaluation (`Jenny-Bench-25`)

All experiments were executed on an `Intel Core i7-13700H`, `32GB DDR5`, `NVIDIA RTX 3050 4GB Laptop GPU` (`Windows 11`, `clang 18.1.8`, `Ollama v0.40.5 + qwen2.5-coder:3b Q4_K_M`). Raw JSON outputs are archived in [`.jenny-cache/`](../../.jenny-cache/) and [`.spun/`](../../.spun/).

### 5.1 RQ1: Token Compression and Interface Context Savings (Exact `measure_tokens.py` Output)

| Benchmark Stage / Subset | Modules | Rust Full (`.rs`) | Rust Prod (no `test`) | `.jni` Iface (no `@example`) | `.jni` Fenced Full | `.jn` Handwritten Impl | Jenny Code Total (`.jni`+`.jn`) | **$\text{TCR}$ (vs Full / Prod)** | **$\text{TCR}_{\text{impl}}$ (vs Full / Prod)** | **$\text{ECC}_{\text{self}}$ / $\text{ECC}_{\text{vs\_rs\_prod}}$** |
| :--- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :---: |
| **Stage 0: `Seed-10`** | `B01`–`B10` (10) | 6,933 | 4,684 | 1,926 | 3,798 | 1,459 | 5,257 | `0.7583` / `1.1223` | `0.2104` / `0.3115` | `63.36%` / `58.88%` |
| **Stage 1: `Flow-2`** | `B11`–`B12` (2) | 1,624 | 1,282 | 286 | 614 | 377 | 991 | `0.6102` / `0.7730` | `0.2321` / `0.2941` | `71.14%` / `77.69%` |
| **Stage 2: `Mem-5`** | `B13`–`B17` (5) | 3,756 | 2,785 | 791 | 1,520 | 958 | 2,478 | `0.6597` / `0.8898` | `0.2551` / `0.3440` | `68.08%` / `71.60%` |
| **Stage 3: `Spin-4`** | `B18`–`B21` (4) | 4,439 | 3,647 | 706 | 1,444 | 672 *(spun 1,579)* | 2,116 | `0.4767` / `0.5802` | `0.1514` (`6.61x`) / `0.1843` | `66.64%` / `80.64%` |
| ↳ *`@spin` subset* | *`B19`–`B21` (3)* | *3,321* | *2,749* | *333* | *865* | *292 (spun 1,141)* | *1,157* | *`0.3484` / `0.4209`* | ***`0.0879` (`11.37x`) / `0.1062`*** | *`71.22%` / `87.89%`* |
| **Stage 4a: `Native-3`** | `B22`–`B24` (3) | 2,167 | 2,167 | 609 | 1,100 | 534 *(spun 915)* | 1,634 | `0.7540` / `0.7540` | `0.2464` / `0.2464` | `62.73%` / `71.90%` |
| **Subtotal (`B01`–`B24`)** | **First 24 Modules** | **18,919** | **14,565** | **4,318** | **8,476** | **4,000** | **12,476** | **`0.6594` / `0.8566`** | **`0.2114` / `0.2746`** | **`65.39%` / `70.35%`** |
| **Stage 4b: `B25` Single** | `B25_closure_lifetimes` | 420 | 420 | 266 | 491 | 248 | 739 | **`1.7595` / `1.7595` (Inversion)** | `0.5905` / `0.5905` | `64.01%` / `36.67%` |
| **🏆 Grand Total (`B01`–`B25`)** | **All 25 Modules** | **19,339** | **14,985** | **4,584** | **8,967** | **4,248** | **13,215** | **`0.6833` / `0.8819`** | **`0.2197` / `0.2835`** | **`65.31%` / `69.41%`** |

* **Production vs. Test & Prose Breakdown**: Rust `#[cfg(test)]` blocks account for `4,354 / 19,339` (`22.5%`) of full Rust tokens, while Jenny places its 49 `@example` blocks (`4,383` tokens) inside `.jni` fenced blocks. Counting `.jni` Markdown prose (`5,040` tokens) yields `18,255` total document tokens ($\text{TCR}_{\text{doc\_all}} = 0.9439$).
* **Negative Result Analysis (`B25_closure_lifetimes`, $\text{TCR} = 1.7595$)**: In `B25` (`739` Jenny tokens vs. `420` Rust tokens), `.jni` declares two structs (`SignalBox`, `ThresholdFilter`), four contracted functions, and three `@example` blocks (`491` `.jni` tokens + `248` `.jn` tokens) to test all three closure tracks (`fn`, `*fn[own]`, `^fn`). This demonstrates an important boundary condition: on small micro-modules (`< 500` tokens) with dense contracts and multiple `@example` blocks, `.jni` specification overhead exceeds `.jn` implementation compression.

### 5.2 RQ2: `Mem-Bench-5` (`B13`–`B17`) and `B25` Memory & Closure Breakdown

| Benchmark Directory Name | Memory & Lifetime Mechanism Tested | Rust Full / Prod Tokens | `.jni` Iface / Full Tokens | `.jn` Impl Tokens | Total $\text{TCR}$ | $\text{TCR}_{\text{impl}}$ (vs Full / Prod) | Runtime Sandbox Verification |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`B13_pcm_frame_pipeline`** | `*PcmFrame` unique heap box, `self`/`mut self`/`own frame`, error-path RAII | 1,085 / 791 | 205 / 353 | 251 | `0.5567` | `0.2313` / `0.3173` | `active_native_boxes() == old(...)` (`0` leaks) |
| **`B14_zero_copy_http_view`** | Auto-inferred stack view `HttpRequestView` (`str` slices) + `E0203` escape ban | 710 / 481 | 118 / 324 | 140 | `0.6535` | `0.1972` / `0.2911` | Stack-bound zero-copy view (`0` heap allocs) |
| **`B15_arena_ast_builder`** | `Arena.new` + `*in(arena) AstNode` bump allocation & `arena.drop()` | 926 / 692 | 168 / 336 | 266 | `0.6501` | `0.2873` / `0.3844` | `jn_arena_drop` bulk release |
| **`B16_lru_doubly_linked`** | 2-node doubly-linked `^LruNode` cycle + `effects [AllocGC]` (`E0204`) | 581 / 477 | 129 / 252 | 157 | `0.7040` | `0.2702` / `0.3291` | `jn_gc_collect_all()` pool release |
| **`B17_struct_field_split_mut`** | Nested borrow `self.apply_step(self.effective_delta(scale))` without `E0502` | 454 / 344 | 171 / 255 | 144 | `0.8789` | `0.3172` / `0.4186` | Pure stack struct (`0` heap allocs) |
| **`B25_closure_lifetimes`** | 3-track closures `fn` / `*fn[own sig]` (`_jn_closure_drop_1`) / `^fn` | 420 / 420 | 266 / 491 | 248 | `1.7595` | `0.5905` / `0.5905` | `jn_box_fn_drop` $\rightarrow$ `active_native_boxes() == 0` |

### 5.3 RQ3: 26-Case Fault-Injection Regression Suite (`--mutate`) & Fuzz Prototype (`--fuzz`)
* **26 Fault-Injection Regression Cases (`jenny_nano.py --mutate` + `jenny_flow.py --mutate`)**: Across the **13 hand-crafted runtime contract-violation mutants** (11 in Stage 0 `jenny_nano.py --mutate` + 2 in Stage 1 `jenny_flow.py --mutate`), the `@example` native sandbox fails with exit code `42`; across the **13 hand-crafted static safety mutants** (`E0106`, `E0201`–`E0206`, `E0305`–`E0307`, `E0401`–`E0403` in `jenny_flow.py --mutate`), the compiler returns the expected diagnostic code (`26/26`).
* **Contract Fuzzing & Replay Prototype (`--fuzz`)**: Across all **25/25 modules**, `run_contract_fuzz_suite()` executes **`1,500` scalar free-function calls** (15 functions $\times$ 100 iterations) and **`980` `@example` stress replays** (49 blocks $\times$ 20 rounds = **`2,480` total invocations**), dynamically verifying `jn_active_native_boxes() == 0` after each round ([`.jenny-cache/fuzz_report.json`](../../.jenny-cache/fuzz_report.json)).

### 5.4 RQ4: Local `3B` LLM (`qwen2.5-coder:3b`) Skeleton Completion & Assisted Self-Healing (`n = 18`)

Across the **18 benchmark modules** evaluated with `qwen2.5-coder:3b` (`Q4_K_M`, `temperature = 0.0`, `seed = 42`, given the syntax card, `.jni` blueprint, and `--skeleton` function headers, with `apply_ai_json_fixes` deterministic token replacement assisting Round $\ge 2$):

| Evaluation Phase & Archived JSON Artifact | Evaluated Modules (`n = 18`) | Card Tokens | `&`/`<'a>` Hallucination ($\text{SHR}$) | **$\text{Pass}@1$ (Round 1)** | **$\text{Heal}@2$ (Round 2)** | **$\text{Heal}@3$ (Round 3)** | Round 1 Failure Breakdown (Keyword Habit vs. Contract Omission) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Phase 1**: [`.jenny-cache/phase1_ollama_qwen3b_eval.json`](../../.jenny-cache/phase1_ollama_qwen3b_eval.json) | `B01, B05, B06, B07, B11, B12` (6) | 391 | `0/6` (`0.0%`) | **`66.7%` (4/6)** | **`100.0%` (6/6)** | **`100.0%` (6/6)** | `B01`: `E0102` (`let`); `B07`: `E0102` + `E0108` (missing `self.processed_samples` update) |
| **Phase 2**: [`.spun/ollama_stage2_eval_report.json`](../../.spun/ollama_stage2_eval_report.json) | `B13, B14, B15, B16, B17` (5) | 389 | `0/5` (`0.0%`) | **`20.0%` (1/5)** | **`100.0%` (5/5)** | **`100.0%` (5/5)** | `B16` passed R1; `B13, B15, B17`: `E0102` (`let`); `B14`: `E0107` (Rust `Ok/Err/unwrap_or`) |
| **Phase 3**: [`.spun/stage3_ollama_eval.json`](../../.spun/stage3_ollama_eval.json) | `B18, B19, B20, B21` (4) | 389 | `0/4` (`0.0%`) | **`75.0%` (3/4)** | **`100.0%` (4/4)** | **`100.0%` (4/4)** | `B18, B19, B20` passed R1; `B21`: `E0102` (`let`) |
| **Phase 4**: [`.spun/stage4_ollama_eval.json`](../../.spun/stage4_ollama_eval.json) | `B22, B23, B24` (3) | 360 | `0/3` (`0.0%`) | **`33.3%` (1/3)** | **`100.0%` (3/3)** | **`100.0%` (3/3)** | `B24` passed R1; `B22, B23`: `E0102` (`let`), while `.as_raw_ptr()` & `*in(arena)` were correct in R1 |
| **🏆 Total (18 Archived Tasks)** | **18 Evaluated Modules** | **360–391** | **`0/18 (0.0%)`** | **`50.0% (9/18)`** | **`100.0% (18/18)`** | **`100.0% (18/18)`** | **Of 9 R1 failures: 7 pure `E0102` (`let`), 1 `E0107`, 1 `E0102 + E0108`** |

### 5.5 RQ5: Native Compilation, `.jni` ABI Firewall, and Binary Footprint
All **25/25 modules** compile cleanly via `clang 18.1.8 -std=c11 -O3` (cold build `745.8 ms` for `B22`–`B24`), passing all **49/49 (`100%`)** embedded `@example` blocks. Warm CAS cache hits take **`< 1 ms` (`0.0 ms` measured)**; modifying `kv_storage_engine.jn` updates `jn_impl_hash` (`df79714d5edf7d3a` $\rightarrow$ `cfc82a20d76796ab`) while preserving `jni_abi_hash` (**`1d45502ef219c1f2`**) with `0` downstream rechecks. The 25 native `.exe` binaries average **`141.84 KB`** each, totaling **`3,546.0 KB` (`3.46 MB`)** (`3,382.5 KB` / `3.38 MB` for `B01`–`B24`).

### 5.6 Threats to Validity & Limitations
1. **Absence of a Same-Model Rust/Go Counterfactual Control Group**: We did not run `qwen2.5-coder:3b` on equivalent Rust tasks with `rustc` feedback; hence `Heal@2 = 100%` establishes the viability of Jenny's skeleton + `--ai-json` loop rather than proving a causal delta over Rust.
2. **Regex Tokenizer & Test/Prose Asymmetry**: `measure_tokens.py` uses a regex tokenizer (`TOKEN_PATTERN`), and Rust `.rs` files include `#[cfg(test)]` (`22.5%`) while Jenny places `@example` in `.jni` alongside `5,040` tokens of Markdown prose; we therefore report both full-file and production-only ratios plus `.spun/` expanded sizes.
3. **Micro-Benchmark Scale & Author-Written Baselines**: All 25 modules are author-written single-file micro-benchmarks (`420`–`1,225` Rust tokens; e.g., `B16` is a 2-node doubly-linked cycle demo rather than a full eviction-policy LRU cache).
4. **Prototype Toolchain Scope**: `jenny_flow.py` is a Python-to-C99 transpiler, `jenny_rt.h` currently implements `^T` via a 1,024-slot `calloc` table rather than a full Immix collector, and `llm_eval_harness.py` combines LLM retries (`temperature = 0.0`) with deterministic `--ai-json` quick-fixes (`apply_ai_json_fixes`).
5. **No Runtime Performance Benchmarks or Human User Study (HCS)**: We do not claim runtime speedups over Rust, nor have we conducted a controlled human-subject study for `.jni` auditability.

---

## 6. Related Work & Future Directions

* **Related Work**: Jenny builds upon Knuth's **Literate Programming** [8] and interface/implementation separation in **Modula-2** [9] and **Ada**; **Design by Contract** in Eiffel [6] and formal verification in **SPARK** [10], **Frama-C** [11], **Dafny** [12], and **Verus** [13]; **Mutable Value Semantics** in **Hylo (Val)** [5], region allocation [14] in **Zig**/**Vale**, linear types in **Austral**, and row-polymorphic effects in **Koka** [15]; and compiler-feedback self-repair loops such as **Self-Debug** [16], **Deligiannis et al.** [2], and **SWE-bench** [17].
* **Future Work**: (1) End-to-end **Hierarchical Multi-Agent evaluation** (frontier Architect LLM synthesizing `.jni` from natural language + local Coder LLM synthesizing `.jn`); (2) **Same-model counterfactual experiments** comparing Jenny vs. Rust (`rustc`) and Go across multiple temperatures and models; (3) Replacing the pooled `calloc` GC in `jenny_rt.h` with a **64KB block-structured Immix collector** [4] and bootstrapping **`jennyc-self`**; (4) Extending `--fuzz` to stateful method sequences and implementing `--diff` differential regression; and (5) **SFT/RLVR training** on compiler-verified `(.jni, .jn)` trajectories.

---

## References

1. Pearce, H., Ahmad, B., Tan, B., Dolan-Gavitt, B., & Karri, R. (2022). *Asleep at the Keyboard? Assessing the Security of GitHub Copilot's Code Contributions*. IEEE S&P 2022, pp. 754–768.
2. Deligiannis, P., Lal, A., Mehrotra, N., Poddar, R., & Rastogi, A. (2023). *Fixing Rust Compilation Errors using LLMs*. MSR Technical Report (arXiv:2308.05177).
3. Liu, N. F., et al. (2024). *Lost in the Middle: How Language Models Use Long Contexts*. TACL, 12, 157–173.
4. Blackburn, S. M., & McKinley, K. S. (2008). *Immix: A Mark-Region Garbage Collector with Space Efficiency, Fast Collection, and Mutator Performance*. PLDI 2008, pp. 22–32.
5. Racordon, D., et al. (2022). *Implementation Strategies for Mutable Value Semantics*. MPLR 2022, pp. 36–51.
6. Meyer, B. (1992). *Applying "Design by Contract"*. IEEE Computer, 25(10), 40–51.
7. Spinning Jenny Project (2026). *Jenny v2.0 Language Specification & Empirical Benchmark Suite (`B01`–`B25`)*. [`docs/design/specs/00_index_and_overview.md`](../design/specs/00_index_and_overview.md).
8. Knuth, D. E. (1984). *Literate Programming*. The Computer Journal, 27(2), 97–111.
9. Wirth, N. (1985). *Programming in Modula-2* (3rd ed.). Springer-Verlag.
10. Barnes, J. (2012). *SPARK: The Proven Approach to High Integrity Software*. Altran Praxis.
11. Cuoq, P., et al. (2012). *Frama-C: A Software Analysis Perspective*. SEFM 2012, pp. 233–247.
12. Leino, K. R. M. (2010). *Dafny: An Automatic Program Verifier for Functional Correctness*. LPAR 2010, pp. 348–370.
13. Lattuada, A., et al. (2023). *Verus: Verifying Rust Programs using Linear Ghost Types*. PACMPL, 7(OOPSLA1), 286–315.
14. Tofte, M., & Talpin, J. P. (1997). *Region-Based Memory Management*. Information and Computation, 132(2), 109–176.
15. Leijen, D. (2014). *Koka: Programming with Row Polymorphic Effect Types*. MSFP 2014, pp. 100–126.
16. Chen, X., Lin, M., Schärli, N., & Zhou, D. (2024). *Teaching Large Language Models to Self-Debug*. ICLR 2024.
17. Jimenez, C. E., et al. (2024). *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?*. ICLR 2024.
