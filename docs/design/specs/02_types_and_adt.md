# Jenny Specification — Volume 02: Primitive Types & Algebraic Data Types (`ADT`)

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../../zh/design/specs/02_types_and_adt.md)

> **Status**: Finalized (v1.0-spec)  
> **Core Principle**: Transparent memory layouts, zero implicit lossy numeric conversions, an immutable SSO string foundation, and an orthogonal data representation layer built on `struct` (product types) + `enum` (sum types) + `match`/`is`/`guard` (exhaustive and conditional pattern matching).

---

## 1. Primitive Scalars & Value Compound Types

### 1.1 Scalar Type Table & the "Automatic Lossless Widening" Rule
To balance numeric safety with visual clarity (avoiding screens cluttered with trivial `.as<i64>()` calls), Jenny applies a strict two-tier rule to numeric conversions:
* **100% Lossless Same-Sign Widening Is Automatic**: Conversions such as `u8 -> u16 -> u32 -> u64`, `i8 -> i16 -> i32 -> i64`, and `f32 -> f64` occur automatically without explicit casts.
* **Lossy Narrowing, Float-to-Int, and Cross-Sign Conversions Require Explicit `.as<T>()`**: Any conversion that may truncate bits, lose precision, or reinterpret sign bits must explicitly invoke `.as<T>()` (or bounds-checked `.try_as<T>()?`).

| Category | Type Keywords | Physical Size & Semantics |
| :--- | :--- | :--- |
| **Signed Integers** | `i8`, `i16`, `i32`, `i64`, `i128` | Two's-complement signed integers (Debug builds enable overflow traps by default; Release builds allow explicit `wrapping_add`, etc.) |
| **Unsigned Integers** | `u8`, `u16`, `u32`, `u64`, `u128` | Unsigned integers; raw byte data uniformly uses `u8` (omitting a redundant `byte` alias to keep a single canonical spelling) |
| **Pointer-Sized Integers** | `isize`, `usize` | Matches target pointer width (64-bit on 64-bit Native, 32-bit on Wasm32); dedicated to array indexing and memory offsets |
| **Floating-Point** | `f16`, `f32`, `f64` | IEEE-754 compliant floating-point numbers |
| **Boolean & Character** | `bool`, `char` | `bool` occupies 1 byte (`true`/`false` only); `char` occupies 4 bytes representing a Unicode Scalar Value |
| **Unit & Bottom Types** | `void` (or `()`), `never` | `void` denotes no return value; `never` (bottom type $\bot$) types branches that unconditionally `panic`, loop forever, or `raise` |

### 1.2 Orthogonal Distinction Between Tuples, Fixed-Size Arrays, Slices, and Dynamic Arrays
To eliminate the confusion between arrays and slices common in C/C++ and Go, Jenny strictly separates four sequence/aggregate forms:

1. **Tuple `(T1, T2, ...)`**: Anonymous product type stored inline on the stack or inside a parent struct; supports `.0`, `.1` field access and pattern destructuring.
2. **Fixed-Size Value Array `[N]T`** (e.g., `[4]f32`, `[256]u8`):
   * Compile-time constant length `N` (`usize`), **100% stored inline on the stack or inside a struct** with zero heap allocation or header overhead.
   * Identical in physical memory layout to a C array `T[N]`; can be embedded directly inside a `@repr(C) struct` and passed zero-copy to C functions.
3. **Borrowed Slice View `[]T` / `mut []T`**:
   * Stack-bound fat pointer `{ ptr: *T, len: usize }` (16 bytes on 64-bit targets), representing a non-owning local view over contiguous memory (backed by `[N]T`, `*Array<T>`, `^Array<T>`, or a C buffer).
4. **Dynamically Resizable Array `Array<T>`**:
   * First-class standard library generic container (`{ buf, len, cap }`), allocatable by prefix as `*Array<T>` (Native Heap single owner), `^Array<T>` (Managed Heap shared handle), or an inline stack container.

---

## 2. String Architecture: `String` (SSO Immutable Value) & `str` (Borrowed Slice)

To prevent frustrating ownership moves when passing strings in business logic while maintaining hard real-time determinism, Jenny adopts a **three-part string architecture: Immutable SSO `String` + Borrowed View `str` + Mutable `StringBuilder`**:

### 2.1 `str` (UTF-8 String Slice View)
* Physical layout: `{ ptr: *const u8, len: usize }` (16 bytes, guaranteed valid UTF-8).
* String literals (such as `"hello"`) reside statically in the read-only data segment (`.rodata`); they have type `str` and can also construct a `String` with zero heap allocation.
* Function parameters that only need to inspect text **canonically take `str`** (`String` coerces implicitly to `str` at zero cost).

### 2.2 `String` (24-Byte SSO Immutable Owned String)
* **Immutable Value Semantics (`TrivialCopy`-Class Ergonomics)**: Once created, a `String`'s contents cannot be mutated in place. Assigning a `String` to a new variable or passing it to a function **never invalidates the source variable**.
* **24-Byte Tri-State Inline Layout (Small String Optimization, SSO)**:
  1. **Short Strings (length $\le 23$ bytes)**: Stores UTF-8 bytes plus a 1-byte length tag directly inline within the 24-byte stack slot—**zero heap allocation, zero pointer indirection, bitwise copyable**!
  2. **Static Literals**: Stores a pointer to `.rodata` plus length—zero heap allocation and zero destructor overhead.
  3. **Long Strings (length $> 23$ bytes)**: Points to an immutable UTF-8 shared byte block (backed by atomic reference counting or the managed heap); copying a `String` copies only the lightweight handle without duplicating character bytes.
* **High-Frequency Construction & Mutation**: Dynamic concatenation or byte-level editing uses `StringBuilder` (backed by `Array<u8>`), converting to `String` zero-copy via `.into_string()` once finished.

---

## 3. Product Types: `struct` (Structs, Field Defaults & Tri-Modal Receivers)

### 3.1 Declarations & Field Defaults
Jenny eliminates overloaded `constructor` boilerplate by supporting default values directly on field declarations, paired with struct literals for unambiguous initialization:

```rust
@repr(C) // Optional: enforces C ABI field alignment and ordering; by default the compiler may reorder fields to eliminate padding holes
pub struct HttpClientConfig {
    pub host: String = "localhost",
    pub port: u16 = 443,
    pub timeout_ms: u32 = 5000,
    pub api_key: String, // No default value: required at construction
}

// Constructing an instance: fields without defaults are mandatory; others automatically take their default values
val cfg = HttpClientConfig {
    api_key: "sk-jenny-01",
    port: 8080, // Overrides default port
}
```

### 3.2 Method Binding & Tri-Modal Receiver Auto-Adaptation (`impl Type`)
Aligned with Volume 01's v2.0 parameter modes, method definitions inside `impl Type` blocks **completely abolish `&self` and `&mut self` sigils**, using tri-modal receivers directly:

| Receiver Syntax | Passing Intent | Caller Auto-Adaptation Rule (Cross-Track Auto-Deref) |
| :--- | :--- | :--- |
| **`self`** *(Default)* | **Read-Only Borrow Mode** | **Universal Across All Tracks**: Whether the caller holds a stack value `v`, a native pointer `*v`, or a managed handle `^v`, calling `v.method()` borrows read-only without consuming ownership |
| **`mut self`** | **In-Place Mutation Mode** | **Universal Across All Tracks**: Callable whenever the caller holds a mutable binding (`var v`, mutable `*v`, or `^v`), mutating fields in place |
| **`own self`** | **Ownership Transfer / Destruction Mode** | Consumes and takes over ownership of the instance (used for `drop(own self)`, `into_xxx(own self)` converters, or explicit `@scoped` resource closing) |

---

## 4. Sum Types: `enum` (Algebraic Data Types & Niche Optimization)

### 4.1 Unified Sum Type Declarations
Jenny's `enum` unifies C-style enums and full algebraic sum types (Tagged Unions); each variant can carry no payload, a tuple payload, or a named-field struct payload:

```rust
pub enum NetEvent {
    Connected,                                      // Unit variant
    Ping(u64),                                      // Tuple payload variant
    Message { sender: String, payload: *Buffer },   // Struct payload variant (may hold *T or ^T)
}
```

### 4.2 Recursive Data Types & Niche Optimization
1. **Intuitive Recursive Definitions**: Thanks to explicit `*T` and `^T` prefixes, recursive ASTs or trees require no `Box<T>` wrapper noise—simply write `*Expr` (native heap tree, compatible with `*in(arena)`) or `^Expr` (GC-managed tree):
   ```rust
   pub enum Expr {
       Number(f64),
       Add { left: ^Expr, right: ^Expr },
   }
   ```
2. **Zero-Overhead Nullable Niche Filling**:
   * The built-in nullable type `T?` is semantically equivalent to `enum Option<T> { Some(T), None }` (where the literal `null` represents `None`).
   * Whenever `T` is a non-null pointer or handle type (`*U`, `^U`, or a function pointer), the compiler guarantees that **`(*U)?` and `*U` have the exact same physical size (8 bytes on 64-bit targets)**, representing `null` with the zero address `0x0`.

---

## 5. Pattern Matching System: `match`, `is` & `guard`

To combine the expressive destructuring power of functional pattern matching with flat, readable procedural control flow, Jenny defines three orthogonal pattern-matching constructs (**abolishing ambiguous `if let` and `let ... else` constructs**):

### 5.1 Exhaustive Multi-Way Matching: `match` Expressions
* **Mandatory Exhaustiveness**: The compiler statically verifies that `match` covers all possible variants or value ranges; missing branches fail compilation (and the `--ai-json` diagnostic engine automatically emits the missing branch skeleton).
* **Supports Nested Destructuring, Pattern Guards (`if`), and Range Patterns**:

```rust
pub fn describe_event(ev: NetEvent) -> String {
    return match ev {
        NetEvent.Connected => "Connected",
        NetEvent.Ping(ms) if ms > 1000 => "High-latency heartbeat: " + ms.to_string(),
        NetEvent.Ping(ms) => "Normal heartbeat: " + ms.to_string(),
        NetEvent.Message { sender, payload } => "Message from " + sender,
    }
}
```

### 5.2 Conditional Pattern Test & Binding Operator: `is`
When testing a single variant and extracting bindings inside an `if` or `while` condition, Jenny uses the natural **`is` operator**.
* **Key Advantage**: `x is Pattern` is a first-class `bool` expression that **chains seamlessly with the logical AND operator `&&`**, making extracted pattern bindings immediately available in right-hand `&&` clauses and the subsequent `{ ... }` block!

```rust
// Seamless chaining of pattern destructuring and boolean conditions (no awkward if-let chains)
if ev is NetEvent.Message { sender, payload } && payload.len > 0 {
    process_payload(sender, payload)
}

// Works identically for unwrapping nullable types T?
if user.email is Some(addr) && addr.ends_with("@jenny.dev") {
    send_welcome(addr)
}
```

### 5.3 Linear Early-Return Guard: `guard ... else`
To keep the golden path of a function unindented at the top level, Jenny provides a Swift-inspired **`guard` statement**:
* The `else` block **must terminate with a control-flow diverging statement** (`return`, `raise`, `break`, `continue`, or a call returning `never`), strictly enforced by the compiler.
* Destructured variables bound by the `guard` pattern remain **in scope for the remainder of the enclosing block**.

```rust
pub fn handle_packet(ev: NetEvent) -> usize ! NetError {
    // If ev does not match Message, abort early in else; otherwise sender and payload stay in scope below!
    guard ev is NetEvent.Message { sender, payload } else {
        raise NetError.UnexpectedEvent
    }

    guard payload.len >= 4 else {
        return 0
    }

    return payload.len
}
```
