# Spinning Jenny (`Jenny`) Programming Language Specification Index & Overview (v1.0)

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../../zh/design/specs/00_index_and_overview.md)

> *“1764, the Spinning Jenny wove the Industrial Revolution. Today, Jenny weaves Human Intent and AI Intelligence into Native & WebAssembly code.”*

---

## 🏛️ Design Manifesto & Evolutionary Roadmap

* **[Jenny Design Manifesto & AI-Native Architectural Overview](../philosophy_and_overview.md)**
  * Establishes the first principles of *"Humans read native Markdown blueprints (`.jni`), AI writes formal contracts and implementations (`.jn`), and the Compiler enforces zero-trust contract verification"*, along with the Six Core Architectural Laws and the Three-Stage Progressive Weaving workflow.
* **[Jenny Progressive Empirical Evolution Roadmap & Verification Suite (v0.1 -> v1.0)](../evolution_and_verification_suite.md)**
  * Defines the five-stage concentric evolution roadmap starting from the `Jenny-Nano (v0.1)` minimal contract kernel, quantitative stage-gate criteria, and the initial 10 golden seed benchmarks (`Jenny-Seed-10`).
* **[Object Lifetime & Memory Management: Cross-Language AI Pain Points, Empirical Research & Stage 2 Baseline](../lifetime_management_cross_lang_baseline.md)**
  * Provides an in-depth analysis of AI coding failure modes across C/C++ (silent dangling views and early-return leaks), Rust (borrow-checker deadlocks and fix-induced lifetime cascades), and Go (aliasing mutation and hidden heap escapes), backed by top-tier empirical studies (ICSE 2025 `RustAssistant`, `CRust-Bench`, `CyberSecEval`, `MultiPL-E`) and `Mem-Bench-5` evaluation results.

---

## 📚 Specification Volumes (`v2.0-spec`)

This directory contains the finalized 12-volume **Jenny Language Core Specification (`v2.0-spec`)**:

1. **[Volume 01: AI-Native Dual-Track Memory & Parameter Passing Modes (v2.0)](./01_memory_and_ownership.md)**
   * **Completely eliminates nested reference types (`&T` / `&mut T` / `&*T` / `&^T`)!** Decouples memory management into orthogonal "Tri-State Storage Topology (`T` inline value/view, `*T` native single-owner heap, `^T` managed shared heap)" and "Tri-Modal Parameter Passing Intent (**read-only borrow by default**, `mut` in-place mutation, `own` explicit ownership transfer)". Covers automatic stack-bound view inference for slice-bearing structs (eliminating `view struct` and `'a`), three-track closure lifetimes (`fn` / `*fn[own]` / `^fn`), `iter fn (yield)`, pluggable Immix GC / ARC, `*in(arena)`, and `@scoped` linear resources.
2. **[Volume 02: Primitive Types & Algebraic Data Types (ADT)](./02_types_and_adt.md)**
   * Scalar types with lossless widening and explicit `.as<T>()` narrowing, `[N]T` vs. `[]T` vs. `Array<T>`, 24-byte SSO immutable `String` and `str` slices, `struct` field defaults, tri-modal method receivers (`self` / `mut self` / `own self`), payload-carrying sum types (`enum`) with 8-byte niche optimization, exhaustive `match`, conditional `is` pattern-test operator, and linear `guard ... else` statements.
3. **[Volume 03: Lexical Structure, Canonical Syntax & Control Flow](./03_syntax_and_control_flow.md)**
   * `val` / `var` bindings, semicolon-free line continuation rules, abolition of `? :` and `++`, mandatory explicit `return` in named functions, `if/else` and `match` value expressions, `for .. in` and `while` as the sole loop primitives, 100% RAII cleanup unified under `drop(own self)` (no `defer`), `fn(x) => ...` closures with `*fn[own ptr]` capture, and the `x |> f(a, _)` pipeline operator.
4. **[Volume 04: Traits, Generics & Container Adaptation](./04_traits_and_generics.md)**
   * `trait` associated types with intuitive `T.Item` dot-projection, `delegate` zero-boilerplate composition forwarding, package-level coherence rules, `@operator("+")` method annotations with high-cohesion domain traits (`Numeric`/`Comparable`), dynamic dispatch fat pointers (`dyn Trait` / `*dyn Trait` / `^dyn Trait`), tri-mode generics compilation (Debug dictionary passing + Release monomorphization + `^T` isomorphic pointer erasure), and compiler-synthesized intrinsic traits (`TrivialCopy`/`UniqueMove`/`GcTrace`).
5. **[Volume 05: Three-Tier Progressive Error Truncation & Static Effect Contracts (v2.0)](./05_errors_and_effects.md)**
   * Three-tier progressive error architecture: low-level exact errors `T ! E`, domain/trait hybrid truncation `T ! (BizError | AnyError)`, and top-level full truncation shorthand `T!` (`T ! AnyError`); 16-byte two-register small-error inline optimization (zero heap allocation), dynamic type-safe downcasting via `if err is SpecificError`, thread-local zero-cost Error Trace RingBuffer, and `effects [IO, Async, Parallel, AllocGC, Unsafe]` static capability contracts.
6. **[Volume 06: `@spin` Compile-Time White-Box Metaprogramming](./06_spin_metaprogramming.md)**
   * `@spin fn` + parameterized `@apply`, block-level declarative `@spin dsl { ... }`, `@spin expr`, `@spin if` feature pruning, the Purely Additive Principle (forbidding mutation of existing struct fields), `.spun/<module>.spun.jn` white-box materialization for debugging, `jenny distill` reverse pattern extraction, and the 100% deterministic Meta-VM sandbox.
7. **[Volume 07: Concurrency Model (`Fiber`, Structured Async & Data-Race-Free Parallelism)](./07_concurrency_and_fiber.md)**
   * `effects [Async]` stackless coroutine state machines, explicit postfix `.await` (e.g., `fetch().await?`), `std::fiber::scope` structured concurrency (safely sharing parent-stack read-only parameters + sibling cancellation cascades), dual-track cross-thread data-race prevention (`own *T` zero-copy move, immutable `^T` sharing, static interception of mutable `^T`), and standard library `Channel<T>` and `par_map`.
8. **[Volume 08: Zero-Glue C Interop, WebAssembly Dual Backends & Ecosystem](./08_c_interop_wasm_and_ecosystem.md)**
   * Built-in `libclang` zero-glue `import c`, mandatory `.as_raw_ptr()` explicit C pointer boundary crossings, Wasm Linear Memory (`*T`) + WasmGC (`^T`) + `table<anyref>` cross-heap root table mapping, `@export(wasm)` automatic WIT and `.d.ts` generation, three-tier visibility (private by default / `pkg` / `pub`), `jenny skeleton`, and `--ai-json` deterministic quick-fix patches.
9. **[Volume 09: Literate Architectural Blueprints (`.jni`) & First-Class Contract System](./09_literate_blueprint_and_contracts.md)**
   * `.jni` top-level native Markdown prose + collapsible ```` ```jenny ```` formal contract blocks, bidirectional isomorphism between `.jni` and `.jn`, `requires ... else` automatic precondition error weaving, `ensures (result / old)` post-condition guarantees, `invariant` struct invariants, compile-time Meta-VM `@example` sandbox verification, and the "Three-Stage Progressive Weaving (Intent $\rightarrow$ Spec $\rightarrow$ Weave)" workflow.
10. **[Volume 10: Sub-Second Incremental Compilation & Anti-Bloat Architecture](./10_fast_compilation_and_anti_bloat.md)**
    * Root-cause postmortem of Rust's `target/` directory bloat; establishes the `.jni` Blueprint ABI Firewall (zero downstream recompilation on `.jn` changes), dual-mode generics engine (Debug dictionary passing vs. Release monomorphization), built-in bytecode Meta-VM eliminating proc-macro dynamic library bloat, default Line-Tables-Only debug info with Split DWARF, and a quota-bound 2 GB LRU content-addressed build cache (`.jenny-cache/`).
11. **[Volume 11: Language–Model Co-Evolution & Empirical Training Engineering (PL-LLM Co-Design)](./11_llm_codesign_and_empirical_training.md)**
    * Defines the five quantitative benchmarks (TCR token compression ratio, ECC effective context capacity, $\text{Pass}@1 / \text{Heal}@k$ compilation & self-healing rates, SHR semantic hallucination rate, and HCS human comprehension speed), perplexity- and error-heatmap-driven syntax smoothing, and the Compiler-in-the-Loop RLVR / GRPO co-training closed loop.
12. **[Volume 12: Package Management, Module Resolution & Supply-Chain Effect Firewall (`Spindle` & `Tapestry.toml`)](./12_package_management_and_module_system.md)**
    * Establishes paired-file (`<mod>.jni` + `<mod>.jn`) module resolution, wildcard import prohibition (`E0501`), circular dependency detection (`E0502`), package-level `allow_effects` supply-chain capability sandboxing in `Tapestry.toml` (`E0503`), dual-hash `Tapestry.lock` (`jni_abi_hash` + `jn_impl_hash`) with Minimum Version Selection (MVS), mechanically verified contract SemVer (`spindle semver-check`, `E0504`), and the `spindle context` AI contract summary export protocol.

---

## ⚡ Jenny v2.0 Full-Feature Showcase (`audio_weaver.jn`)

The following example brings together the AI-native rules finalized across all specification volumes (note: **zero `&` borrow symbols anywhere—parameters default to read-only borrows, mutations use `mut`, and ownership transfers use `own`**):

```rust
module audio_weaver

import c "samplerate.h" as libsr
import std::fiber::{self, FiberScope, Fiber}
import std::parallel::{par_map, collect}

// 1. @spin compile-time white-box metaprogramming (purely additive, materialized to .spun/audio_weaver.spun.jn)
@spin fn derive_memory_audit(target: MetaType) -> CodeFragment {
    var native_count: usize = 0
    var gc_count: usize = 0
    for f in target.fields() {
        if f.type_info().is_native_ptr() { native_count += 1 }
        if f.type_info().is_gc_handle()  { gc_count += 1 }
    }
    return quote {
        impl $(target.ident()) {
            // self defaults to a read-only borrow—no &self needed!
            pub fn memory_profile(self) -> String {
                return "Native(*): " + $(native_count).to_string() + 
                       ", Managed(^): " + $(gc_count).to_string()
            }
        }
    }
}

// 2. Algebraic error definition (supports automatic sub-error lifting via ?)
pub enum AudioError {
    Io(IoError),
    EmptyFrame,
    ResampleFailed(i32),
}

// 3. Native heap data structure (*PcmFrame: single ownership, shares linear memory with C)
@repr(C)
pub struct PcmFrame {
    pub samples: *mut c_raw<f32>,
    pub length: usize,
    pub sample_rate: u32 = 48000,

    // own self consumes and destroys ownership of this instance
    fn drop(own self) {
        if self.samples != null {
            libsr.free_buffer(self.samples.as_mut_void_ptr())
        }
    }
}

// 4. Zero-copy slice view (compiler detects []f32 slices and automatically infers a stack-bound view—no view struct or 'a!)
pub struct FrameWindow {
    pub left_channel: []f32,
    pub right_channel: []f32,
}

// 5. GC-managed domain graph node (^TrackNode: supports multi-owner graph links while holding *PcmFrame across heaps)
@apply(derive_memory_audit)
pub struct TrackNode {
    pub title: String,             // 24-byte SSO immutable string
    pub raw_frame: *PcmFrame,      // Single-owner native audio frame
    pub next: ^TrackNode?,         // Prefix ^ binds tighter than postfix ?, equivalent to (^TrackNode)?
}

// 6. Pure computation function (omitting effects clause = compile-time verified 100% pure function)
pub fn calc_rms(samples: []f32) -> f32 ! AudioError {
    guard samples.len > 0 else {
        raise AudioError.EmptyFrame
    }
    var sum: f32 = 0.0
    for s in samples {
        sum += s * s
    }
    return (sum / samples.len.as<f32>()).sqrt()
}

// 7. Async structured concurrency + explicit C interop pointer boundary + functional pipeline
pub fn process_tracks(nodes: []*PcmFrame, ratio: f64) -> []f32 ! AudioError 
    effects [Async, Parallel, IO, Unsafe] 
{
    // Structured concurrency scope: s: FiberScope and frame: PcmFrame default to zero-copy read-only borrows—no &*PcmFrame noise!
    val resampled_peaks = fiber::scope(fn(s: FiberScope) -> []f32 ! AudioError {
        val job: Fiber<[]f32 ! AudioError> = s.spawn(fn() -> []f32 ! AudioError {
            return nodes
                |> par_map(fn(frame: PcmFrame) -> f32 => {
                    // Explicitly call .as_raw_ptr() to cross the C FFI boundary
                    val code = libsr.src_simple_check(frame.samples.as_raw_ptr(), frame.length.as<i32>(), ratio)
                    return if code == 0 { 1.0 } else { 0.0 }
                })
                |> collect()
        })
        return job.join().await?
    }).await?

    return resampled_peaks
}
```
