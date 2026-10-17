# Jenny Specification — Volume 03: Lexical Structure, Canonical Syntax & Control Flow

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../../zh/design/specs/03_syntax_and_control_flow.md)

> **Status**: Finalized (v1.0-spec)  
> **Core Axiom**: Canonical & Orthogonal Syntax — strictly governed by a context-free grammar (CFG) where every logical operation has **one and only one canonical representation**, maximizing human readability and LLM generation accuracy.

---

## 1. Lexical Structure & Canonical Declarations

### 1.1 Variable Bindings: `val` and `var`
Jenny requires explicit mutability distinction at binding sites, eliminating overlapping `const` / `let` keywords:
* **`val` (Immutable Binding, Recommended Default)**: Cannot be reassigned or have its inline stack fields mutated after initialization; for `*T`, the pointed-to object cannot be mutated through a `val` binding.
* **`var` (Mutable Binding)**: Permits reassignment and in-place mutation via `mut` parameter/method calls.
* **Local Type Inference with Explicit Signatures**:
  * Local variables inside function bodies support bidirectional type inference (e.g., `val count = 0` defaults to `i32` or infers from context).
  * **Function, method, and struct field signatures must always write explicit types**, guaranteeing 100% context locality.

### 1.2 Semicolon Elision & Line Continuation Rules (Automatic Semicolon Insertion)
* **Semicolon-Free by Default**: Statements terminate naturally at newline characters (`\n`); semicolons `;` are only needed when placing multiple statements on a single line (though optional trailing semicolons are tolerated by the lexer to prevent LLM pretraining friction).
* **Unambiguous Multi-Line Continuation**: Whenever a line ends with a **binary operator** (e.g., `+`, `&&`), **pipeline operator** (`|>`), **comma** (`,`), or **unclosed delimiter** (`(`, `[`, `{`), or when the next line begins with `.` (method chaining) or `|>`, the lexer automatically treats the next line as a continuation of the current statement.

### 1.3 Operator Precedence & Conflict-Free Grammar
* **Complete Abolition of the C-Style Ternary Operator `cond ? a : b`**: Frees the question mark `?` exclusively for the nullable type suffix `T?` and the error propagation suffix `expr?` with zero lexical ambiguity.
* **Complete Abolition of Prefix/Postfix Increment `++i` / `i++`**: Variable increments must be written as standalone statements `i += 1`, eliminating undefined expression evaluation order bugs.

---

## 2. Functions, Block Expressions & Return Rules

### 2.1 Named Functions Require Explicit `return`
To eliminate the classic Rust footgun where a stray or missing semicolon silently alters a function's return value:
* Every control-flow exit of a non-`void` named function (`fn`) or multi-line closure **must explicitly write `return expr`**.

### 2.2 `if / else` and `match` as First-Class Value Expressions
While named functions require an explicit `return`, `if / else` and `match` are first-class value expressions that can be assigned to bindings or returned directly—cleanly replacing the ternary operator:

```rust
pub fn clamp_score(raw: i32) -> i32 {
    // if/else evaluates directly as a value expression without ? : ambiguity
    val normalized = if raw < 0 {
        0
    } else if raw > 100 {
        100
    } else {
        raw
    }
    return normalized
}
```

### 2.3 Call-Site Named Arguments & Default Arguments
To eliminate opaque "magic booleans / magic numbers" at call sites (such as `foo(buf, true, false, 4)`) and prevent LLMs from swapping same-typed arguments:
* **First-Class Call-Site Named Arguments (`param_name: expr`)**: Any function or method call may label arguments by parameter name (e.g., `resample(frame, ratio: 0.5, high_quality: true)`).
* **Named-Argument Requirement for Bare Booleans & Skipped Defaults**: Passing a bare boolean literal (`true`/`false`) or skipping preceding default parameters encourages/requires explicit parameter labels so call sites remain 100% self-explanatory.

---

## 3. Orthogonal Control Flow & RAII Resource Cleanup

### 3.1 Sole Canonical Loop Primitives: `for .. in` and `while`
Jenny abolishes C-style three-clause `for (init; cond; step)` loops, `do-while`, and redundant `loop` keywords, retaining just two orthogonal loop constructs:

1. **Sequence & Range Iteration (`for`)**:
   * Half-open range: `for i in 0..n { ... }`
   * Closed inclusive range: `for i in 0..=n { ... }`
   * Container/generator destructuring iteration: `for idx, item in list.enumerate() { ... }`
2. **Conditional & Infinite Loops (`while`)**:
   * Conditional loop: `while queue.is_not_empty() { ... }`
   * Infinite loop: The single canonical spelling is **`while true { ... }`** (the compiler statically recognizes `while true` as an unconditional loop, granting it the exact same reachability analysis and `never` type inference in MIR as a dedicated `loop` keyword).
   * Supports labeled nested loop exits: `break :outer` and `continue :outer`.

### 3.2 Why There Is No `defer`: 100% Unified Under `drop(own self)` and `@scoped`
Following the axiom of "one canonical representation per semantic concept", Jenny **does not include a `defer` statement**:
* Providing both `drop(own self)` (RAII) and `defer` splits resource management across two competing idioms, and `defer` is notoriously error-prone when written inside loops in function-scoped languages.
* In Jenny, **100% of resource cleanup—including Native Heap `*T` boxes, C library handles, and mutex guards—is unified under deterministic `fn drop(own self)` destructors and `@scoped` linear scope lifetimes**.

---

## 4. Closures & Dual-Track Memory Capture Rules

### 4.1 Unified Closure Syntax (Eliminating `|x|` Pipe Ambiguity)
To prevent Rust's `|x|` closure syntax from clashing visually and lexically with bitwise OR `|`, logical OR `||`, and the pipeline operator `|>`, Jenny reuses the `fn` keyword for closures:
* **Single-Expression Closure**: `fn(x) => x * 2` or with explicit types `fn(x: i32) -> i32 => x * 2`
* **Multi-Statement Block Closure**:
  ```rust
  val processor = fn(item: Record) -> bool {
      if !item.is_valid() {
          return false
      }
      return item.score > 60
  }
  ```

### 4.2 Closure Capture & Escape Rules Under Dual-Track Memory
How a closure captures bindings from its enclosing lexical scope interlocks tightly with Volume 01's dual-track memory model:

| Closure Usage Scenario | Default Capture Behavior | Closure Memory Track & Lifetime |
| :--- | :--- | :--- |
| **1. Non-Escaping Local Closure** (e.g., passed directly to `map`/`filter`/`par_map`) | **Captures by borrow by default (`T` / `mut T`)** | Closure environment is allocated inline on the current stack frame (stack-bound view) with **zero heap allocation**, never consuming outer `*T` ownership. |
| **2. Escaping Closure (Capturing Only `^T` or `TrivialCopy` Values)** | Automatically copies `^T` handles or bitwise-copies primitive values / `String` | Can be packaged as a managed closure **`^fn(A) -> B`**, freely stored in structs, returned across functions, or registered as a UI/async callback. |
| **3. Escaping Closure (Capturing Single-Owner `*T`)** | **Must explicitly declare an ownership capture list `fn[own ptr](...)`** | Transfers unique ownership of `*T` into the closure environment (invalidating the outer binding immediately). The closure itself becomes a **`*fn(A) -> B` (single-owner native closure)** that cascades destruction to its captured `*T` when dropped. |

```rust
pub fn make_uploader(own buf: *ImageBuffer, endpoint: String) -> *fn() -> bool {
    // Escaping closure capturing a single-owner *ImageBuffer: must use [own buf] to transfer ownership!
    return *fn[own buf]() -> bool {
        return send_raw(endpoint, buf.pixels, buf.width * buf.height)
    }
}
```

---

## 5. Functional Pipeline Operator: `|>` (First-Argument Injection & `_` Placeholder)

To transform deeply nested inside-out calls like `collect(filter(map(items, f), p))` into a flat, left-to-right dataflow pipeline, Jenny provides the left-associative pipeline operator **`|>`**:

### 5.1 Desugaring Rules
1. **Default First-Argument Injection**:
   * When the right-hand call contains no standalone `_` placeholder, the compiler automatically injects the evaluated left-hand expression as the **first argument** of the right-hand call:
   * `x |> foo()` $\Longrightarrow$ `foo(x)`
   * `x |> bar(a, b)` $\Longrightarrow$ `bar(x, a, b)`
2. **Explicit Positional Placeholder (`_`)**:
   * When the target parameter is not the first argument, a single `_` in the argument list specifies the exact injection slot:
   * `x |> write_to(stream, _, timeout)` $\Longrightarrow$ `write_to(stream, x, timeout)`
   * **Uniqueness Constraint**: At most one `_` may appear in the direct argument list of a `|>` stage (evaluated exactly once with zero duplicate side effects).

```rust
// Dataflow pipeline combining default first-argument injection with _ positional binding
val report = raw_text
    |> trim()
    |> split('\n')
    |> map(fn(line) => parse_entry(line))
    |> filter(fn(entry) => entry.is_active)
    |> format_table("Active Users", _) // Injects the filtered list into the second parameter slot
```
