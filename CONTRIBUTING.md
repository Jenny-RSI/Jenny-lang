# Contributing to Spinning Jenny (`Jenny`)

Thank you for your interest in contributing to **Spinning Jenny (`Jenny`)**! This document outlines the core language invariants and engineering workflow for both human contributors and AI Coding Agents.

---

## 1. Essential Reading Before Contributing

Before modifying compiler code, language specifications, standard library modules, or benchmarks, please review:
1. **[`ROADMAP.md`](./ROADMAP.md)** & **[`docs/roadmap/roadmap_v0.2.md`](./docs/roadmap/roadmap_v0.2.md)**: Understand the current version milestone (`v0.1` completed $\rightarrow$ `v0.2 Jenny-Std` in progress).
2. **[`docs/design/philosophy_and_overview.md`](./docs/design/philosophy_and_overview.md)**: Understand Jenny's six architectural pillars (`.jni`/`.jn` separation, first-class contracts, sigil-free three-mode parameters, dual-track memory, token economy, and PL-LLM co-design).
3. **[`docs/design/specs/00_index_and_overview.md`](./docs/design/specs/00_index_and_overview.md)**: Consult volumes `01`–`11` of the Jenny v2.0 Language Specification.

---

## 2. Jenny v2.0 Syntax & Semantic Rules (Strict Invariants)

When writing `.jni` (Literate Contract Blueprints) and `.jn` (Implementations), you **must** adhere strictly to the **Jenny v2.0 specification**:

1. **Never use `&T`, `&mut T`, `&self`, `&mut self`, `&*T`, or `&^T`**:
   * Function parameters and method receivers default to **read-only borrow** (`x: T`, `self`);
   * Exclusive in-place mutation uses **`mut x: T`**, **`mut self`**;
   * Ownership transfer uses **`own x: T`**, **`own self`** (e.g., `fn drop(own self)`).
2. **Never use `view struct` or `<'a>` lifetime annotations**:
   * All structs are declared with `struct`; the compiler automatically infers any struct containing `str` or `[]T` slices as a stack-bound view (`E0203_VIEW_STRUCT_ESCAPE`).
3. **Literate Blueprint (`.jni`) Format**:
   * The top level of a `.jni` file is **standard Markdown** (never use `///` doc-comment prefixes);
   * Formal declarations (`pub struct`, `pub enum`, `pub trait`, `pub fn`), contracts (`requires`, `ensures`, `invariant`), and `@example` blocks are placed inside fenced ```` ```jenny ```` code blocks.
4. **Control Flow, Errors & Metaprogramming**:
   * Named functions (`fn`) returning non-`void` must use explicit `return expr`;
   * The ternary operator `? :` is forbidden (use value-returning `if c { a } else { b }`);
   * Pattern matching and early guards use `if x is Pattern` and `guard x is Pattern else { ... }` (never `if let`);
   * Error signatures follow the three-tier hierarchy: `T ! E` (leaf), `T ! (BizError | AnyError)` (domain/trait), and `T!` (top-level shorthand);
   * Compile-time metaprogramming uses `@spin` / `@apply`, materializing white-box source files in `.spun/`.

---

## 3. Verification Gate Before Submitting a Pull Request

Every change to `compiler/` or `benchmarks/` must pass the automated verification suite:

```powershell
# 1. Verify token metrics and zero v2.0 syntax violations
python benchmarks/eval/measure_tokens.py

# 2. Verify Stage 0 runtime contract mutation suite (11/11)
python compiler/jenny-nano/jenny_nano.py --mutate

# 3. Verify Stage 1-4 native C99 builds (25/25), @example sandboxes (49/49), and static/runtime mutants (15/15)
python compiler/jenny-flow/jenny_flow.py --mutate --build-native

# 4. Verify contract fuzzing & 20-round leak-checked stress replay
python compiler/jenny-flow/jenny_flow.py --fuzz
```
