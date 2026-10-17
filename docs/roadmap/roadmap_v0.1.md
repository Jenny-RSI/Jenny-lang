# 🗺️ Spinning Jenny `v0.1` Roadmap Archive (`Jenny-Proto v0.1.0` — Completed ✅)

> **Release Codename**: `v0.1.0` (`Jenny-Proto`: AI-Native Language Core & C99 Transpiler Prototype)  
> **Release Status**: 🟢 **Completed & Archived (2026-10-17)**  
> **Core Scope**: Validate the end-to-end closed loop of the **Jenny v2.0 Language Specification**—including `.jni` Literate Contract Blueprints separated from `.jn` implementations, sigil-free three-mode parameters, dual-track three-state memory & closures, three-tier error truncation (`T!`), `@spin` white-box metaprogramming, an AST $\rightarrow$ C99 native backend with four-layer contract verification prototypes, and a local `3B` LLM (`qwen2.5-coder:3b`) skeleton-completion & self-healing benchmark across [`Jenny-Bench-25`](../../benchmarks/).  
> 🌐 **Language**: **English** | **[简体中文 (`../zh/roadmap/roadmap_v0.1.md`)](../zh/roadmap/roadmap_v0.1.md)** · **Master Roadmap**: [`ROADMAP.md`](../../ROADMAP.md) · **Next Release**: [`roadmap_v0.2.md`](./roadmap_v0.2.md)

---

## 1. Internal Five-Stage Milestone Summary (`v0.1.0-alpha1` $\rightarrow$ `v0.1.0`)

| Internal Milestone | Codename & Theme | Compiler Track Deliverables (`compiler/` & `benchmarks/`) | PL-LLM Track Deliverables (`PL-LLM Track`) | Verified Quantitative Outcomes | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **Stage 0 (`v0.1.0-alpha1`)** | **`Jenny-Nano`**<br>Literate Contract Core & C99 Sandbox | • `compiler/jenny-nano/jenny_nano.py`<br>• `benchmarks/seed_10` (`B01`–`B10`)<br>• `benchmarks/eval/measure_tokens.py` | **Phase 0: Static Token Economy Baseline**<br>Three orthogonal metric families (`TCR_impl` / `TCR` / `ECC`) & contract fault injection | • `Seed-10` `TCR = 0.7583`, `TCR_impl = 0.2104`<br>• `19/19 @example` passed, `11/11` runtime contract mutants caught (exit code `42`) | 🟢 **Done** |
| **Stage 1 (`v0.1.0-alpha2`)** | **`Jenny-Flow`**<br>Three-Tier Error Truncation & Linear Flow | • `compiler/jenny-flow` (`jenny_rt.h` + `jenny_flow.py`)<br>• 16B `JnAnyError` + 16-slot Trace RingBuffer<br>• `B11_layered_gateway` & `B12_stream_pipeline` | **Phase 1: Local `3B` LLM Evaluation**<br>Ollama `qwen2.5-coder:3b` on 6 tasks: `Pass@1 = 66.7%`, `Heal@2 = 100%`, `&` hallucination `0.0%` | • 4-layer call chain `B11` `TCR = 0.5288`<br>• Added `2/2` runtime mutants + `E0108` static contract assignment check | 🟢 **Done** |
| **Stage 2 (`v0.1.0-beta1`)** | **`Jenny-Mem`**<br>Dual-Track Memory (`*T`/`^T`) & Three-Mode Borrows | • `jenny_rt.h` native unique heap (`*T`), region arena (`*in(arena) T`) & pooled managed handle prototype (`^T`)<br>• Static borrow/view/effect checker (`E0106`, `E0201`–`E0204`)<br>• `Mem-Bench-5` (`B13`–`B17`) | **Phase 2: Dual-Track Memory `3B` Evaluation**<br>`Mem-Bench-5` `TCR = 0.6597`, `TCR_impl = 0.2551`; `3B` model `Heal@2 = 100% (5/5)` | • `5/5` static memory safety mutants caught<br>• `B16` doubly-linked list passed Round 1 (`Pass@1`) with zero `<'a>` | 🟢 **Done** |
| **Stage 3 (`v0.1.0-beta2`)** | **`Jenny-Spin`**<br>Zero-Boilerplate Delegation & `@spin` Templates | • 16B `dyn Trait` fat pointer + `delegate`<br>• `@spin` / `@apply` white-box expander (`fsm`, `codec`, `crud`) + `.spun/*.spun.jn`<br>• `Spin-Bench-4` (`B18`–`B21`) | **Phase 3: Declarative Metaprogramming `3B` Evaluation**<br>`Spin-Bench-4` `TCR = 0.4767`, `@spin` subset `TCR_impl = 0.0879` (`11.37x`); `3B` model `Pass@1 = 75%`, `Heal@2 = 100%` | • `.spun/` white-box generation & `3/3` static mutants (`E0305`–`E0307`) 100% verified | 🟢 **Done** |
| **Stage 4 (`v0.1.0`)** | **`Jenny-Native Prototype`**<br>C99 Backend, ABI Firewall, C FFI, 3-Track Closures & `--fuzz` | • 25-module C99 native compilation (`clang -O3`) + `.jni` ABI firewall (`jni_abi_hash`)<br>• Zero-glue C FFI (`E0401`–`E0403`) + 3-track closures (`B25`, `E0205`–`E0206`)<br>• `--fuzz` scalar contract fuzzing & stress replay (`2,480` invocations) | **Phase 4: Full-Stack Verification & Paper Release**<br>18-task archived evaluation: `Pass@1 = 50.0% (9/18)`, `Heal@2 = 100.0% (18/18)`; bilingual technical paper completed | • `25/25` modules & `49/49 @example` sandboxes passed<br>• `26/26` fault regressions (13 runtime + 13 static) caught<br>• Warm cache `< 1ms`, 25 `.exe` binaries = `3.46 MB` | 🟢 **Done** |

---

## 2. Verified `v0.1.0` Quantitative Baseline (`B01`–`B25`)

1. **Token Economy (`measure_tokens.py`)**:
   * **Rust Full Source** (with `#[cfg(test)]`): `19,339` tokens; **Rust Production Source** (excluding `#[cfg(test)]`): `14,985` tokens.
   * **Jenny Total Code** (`.jni` fenced blocks `8,967` + `.jn` handwritten implementation `4,248`): **`13,215` tokens** ($\text{TCR} = 0.6833$, $\text{TCR}_{\text{vs\_prod}} = 0.8819$; including `5,040` tokens of `.jni` Markdown prose yields `18,255` full-document tokens, $\text{TCR}_{\text{doc\_all}} = 0.9439$).
   * **Jenny `.jn` Implementation Volume** (`4,248` tokens): **$\text{TCR}_{\text{impl}} = 0.2197$**, **$\text{TCR}_{\text{impl/prod}} = 0.2835$** (reaching **`0.0879` (`11.37x`)** on `@spin` modules `B19`–`B21`; `1,141` tokens after `.spun/` expansion).
   * **Cross-Module Interface Footprint** (`4,584` `.jni` interface tokens): **$\text{ECC}_{\text{self}} = 65.31\%$**, **$\text{ECC}_{\text{vs\_rs\_prod}} = 69.41\%$**.
   * **Boundary Inversion Case (`B25_closure_lifetimes`)**: `739` Jenny code tokens vs. `420` Rust tokens ($\text{TCR} = 1.7595$), demonstrating that on small micro-modules (`< 500` tokens) with dense contracts and 3 `@example` blocks, `.jni` specification overhead exceeds `.jn` compression.
2. **Known Prototype Limitations Addressed by `v0.2 (Jenny-Std)`**:
   * Single-file synthetic micro-benchmarks (`B01`–`B25`) $\rightarrow$ replaced in `v0.2` by building Jenny's real-world **`std::*` Standard Library** benchmarked against Rust `std`.
   * 1,024-slot `calloc` pool for `^T` in `jenny_rt.h` $\rightarrow$ upgraded in `v0.2` to a true **64KB block/line Immix mark-region collector**.
   * Scalar-only `--fuzz` prototype $\rightarrow$ upgraded in `v0.2` to **10,000-step stateful container method-sequence fuzzing** and `--diff` differential verification.
   * Lack of a same-model Rust (`rustc`) / Go counterfactual control group $\rightarrow$ directly executed in `v0.2` across `std::*` components.
