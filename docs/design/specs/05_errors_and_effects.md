# Jenny Specification — Volume 05: Three-Tier Progressive Error Truncation & Static Effect Contracts

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../../zh/design/specs/05_errors_and_effects.md)

> **Status**: Finalized (v2.0 — AI-Native Evolution Edition)  
> **Core Philosophy**: Resolves the long-standing tension in programming language design between "exact low-level error enums causing signature snowballing in high-level code (the Rust `thiserror` pain point)" and "abstract `trait` interfaces being unable to anticipate concrete implementation errors (the Java `throws` pain point)". Introduces a **Three-Tier Progressive Error Architecture**—**Low-Level Exact Errors `T ! E` $\times$ Domain/Trait Hybrid Truncation `T ! (BizError | AnyError)` $\times$ Top-Level Full Truncation `T!` (`T ! AnyError`)**—paired with **16-byte register-inlined small errors (zero heap allocation)** and a **zero-cost thread-local Error Trace RingBuffer**.

---

## 1. Why Do Traditional Strongly-Typed Error Systems Break Down in High-Level Business Logic and Abstract Interfaces?

From the perspective of large-scale software architecture and LLM code generation, a flat single-tier static error enum (`Result<T, E>`) runs into two irreconcilable dilemmas:
1. **The "Error Snowball Effect" Across Deep Call Chains**: A high-level workflow routinely orchestrates 8+ low-level modules (DB, Redis, HTTP, JSON, filesystem, etc.). Forcing high-level functions to enumerate all 30 concrete low-level failure modes in their return signatures bloats top-level error enums and triggers cascading signature edits across the entire call graph whenever a leaf module adds a new error variant.
2. **The "Unknown Implementation Paradox" in Pluggable `trait` Interfaces**: When defining an abstract interface `trait Storage`, the architect cannot know in advance whether a concrete implementation will be an in-memory mock, SQLite, RocksDB, or remote S3—each of which fails with completely different low-level infrastructure errors.

To solve both problems cleanly, Jenny provides a native **Three-Tier Progressive Error Truncation System**, allowing every architectural layer to expose only the error granularity relevant to its domain contract.

---

## 2. The Three-Tier Progressive Error Type Hierarchy (`T ! E` / `T ! (E | AnyError)` / `T!`)

### 2.1 Architectural Panorama Matrix

| Architectural Tier | Canonical Signature Syntax | Semantic Contract & `?` Propagation Behavior | Typical Use Cases |
| :--- | :--- | :--- | :--- |
| **Tier 1: Low-Level Deterministic Modules**<br>*(Closed Exact Errors)* | **`T ! E`**<br>or union **`T ! (E1 \| E2)`** | Error set is 100% closed and statically known at compile time; returned by value on the stack; callers can exhaustively `match` every variant. | Data structures (`RingBuffer`), codecs, parsers, low-level algorithms, OS primitives |
| **Tier 2: Abstract Interfaces (`trait`) & Domain Services**<br>*(Explicit Domain Error + Infrastructure Truncation)* | **`T ! (BizError \| AnyError)`** | **Decoupled Domain Contract**: Callers explicitly handle domain-level `BizError` variants (e.g., `UserNotFound`, `InsufficientFunds`), while any unexpected low-level infrastructure failure inside the concrete implementation (SQL disconnect, disk full, timeout) is **automatically erased and absorbed into `AnyError`** when propagated via `?`! | Polymorphic `trait` interfaces, core domain services, cross-module RPC boundaries |
| **Tier 3: Top-Level Applications / Controllers / Scripts**<br>*(Open Full Truncation)* | **`T ! AnyError`**<br>*(Shorthand syntax: **`T!`**)* | Postfix single exclamation mark **`T!`** is the canonical shorthand for `T ! AnyError`. Automatically absorbs any error thrown anywhere down the call chain, eliminating top-level error boilerplate! | HTTP Controllers, CLI entry points `main() -> void!`, orchestration pipelines, test harnesses |

### 2.2 Operator Precedence Iron Law for Type Modifiers
**Prefix memory-track modifiers (`*`, `^`, `[]`) bind strictly tighter than postfix nullability `?` and error `!` modifiers**:
* `*User?` $\equiv$ `(*User)?` (8-byte niche-optimized nullable native pointer)
* `*Buffer ! IoError` $\equiv$ `(*Buffer) ! IoError`
* `^Session!` $\equiv$ `(^Session) ! AnyError` (returns a managed session handle on success, or `AnyError` on failure)

---

## 3. Zero-Heap-Allocation Physical Representation of `AnyError` & Dynamic Downcasting via `is`

### 3.1 16-Byte Small-Error Register Inline Optimization
In traditional languages, erasing a concrete error into a dynamic error type (such as `Box<dyn Error>`) triggers a heap allocation. Jenny's `AnyError` uses a **16-byte two-register inline layout `{ meta: u64, payload: u64 }`**:
* **`meta` (64-bit)**: The upper 32 bits store the concrete error type's globally unique `TypeId` (assigned at compile time); the lower 32 bits store the enum variant discriminant tag and inline flags.
* **`payload` (64-bit)**:
  * **Whenever the concrete error's payload is $\le 8$ bytes** (covering over 95% of real-world error enums—unit variants, `i32` error codes, `usize` byte offsets, or single handles): **the payload is stored bitwise inline inside the `payload` register with 100% zero heap allocation**! Consequently, `AnyError` can be used at zero cost even inside hard real-time functions that forbid `AllocGC`.
  * Only when an error payload exceeds 8 bytes (e.g., carrying a large diagnostic struct) does `payload` store a pointer to a heap-allocated error box.

### 3.2 Type-Safe Dynamic Downcasting (`if err is SpecificError`)
Because `AnyError` preserves the original error's `TypeId` and variant discriminant tag, high-level code that catches `AnyError` (or `BizError | AnyError`) via `catch err` can still use the **`is` pattern-matching operator** to compare `TypeId`s at zero cost and recover the concrete underlying error:

```rust
pub enum AuthError {
    InvalidCredentials,
    TokenExpired,
}

// Abstract interface: explicitly declares domain error AuthError while truncating unknown
// implementation failures (SQLite/Redis/gRPC) into AnyError
pub trait AuthProvider {
    fn authenticate(self, token: str) -> ^UserSession ! (AuthError | AnyError)
        effects [IO, Async]
}

// Top-level route controller: uses HttpResponse! (i.e., HttpResponse ! AnyError) full truncation signature
pub fn handle_login_request(provider: dyn AuthProvider, req: HttpRequest) -> HttpResponse! 
    effects [IO, Async] 
{
    val session = provider.authenticate(req.bearer_token()).await catch err {
        // 1. Exhaustively or selectively match explicit domain errors
        if err is AuthError.InvalidCredentials || err is AuthError.TokenExpired {
            return HttpResponse::unauthorized("Invalid or expired login credentials")
        }
        // 2. Dynamically downcast through AnyError to inspect a specific infrastructure error!
        if err is SqlError.PoolTimedOut(wait_ms) {
            log::warn("Database pool busy, wait_ms: " + wait_ms.to_string())
            return HttpResponse::service_unavailable("Service temporarily busy, please retry")
        }
        // 3. Re-raise any other unexpected infrastructure fault with its full propagation trace intact!
        raise err
    }

    return HttpResponse::ok(session.user_id)
}
```

---

## 4. Zero-Cost Error Trace RingBuffer

To solve the classic Rust and Go operational blind spot where value-returned errors lose their call stack—leaving top-level logs with a bare `FileNotFound` and no indication of which call site triggered it—Jenny builds in a **zero-overhead-on-success, full-trace-on-error** mechanism:

1. **Happy Path (Normal Execution): 100% Zero Overhead**
   * Emits zero stack-frame bookkeeping instructions on normal return paths and requires no bulky C++ `.eh_frame` unwind tables.
2. **Cold Error Path (`raise` and `?` Early Returns): Automatic Trace Recording**
   * Every `Fiber` / OS thread maintains a compact, fixed-size **16-slot Error Trace RingBuffer (occupying just 128 bytes of stack/TLS memory with zero dynamic heap allocation)**.
   * Whenever `raise err` executes or a `?` operator takes its `@cold` early-return branch, the compiler records a compact compile-time coordinate ID (mapping to `(file, line, function_name)`) into the ring buffer.
   * Calling `err.trace()` formats the complete step-by-step propagation chain from the originating `raise` site through every intermediate `?` hop up to the top-level handler.

---

## 5. Summary of Error Raising, Propagation & Inline Recovery Syntax (`raise`, `?`, `??`, `catch`)

* **`raise <err>`**: Explicitly raises an error (automatically lifting into union variants or erasing into `AnyError` as required by the function signature).
* **`expr?`**: Propagates an error or `null` early to the caller.
* **`opt ?? fallback`**: Null-coalescing default value or early exit for nullable types `T?` (e.g., `val x = get_opt() ?? return`).
* **`res catch [err] { ... }`**: Inline interception and recovery for result types `T ! E` or `T!` (supporting value shorthand `val port = parse(s) catch 8080`).

---

## 6. Static Effect Contract System (`effects [...]`)

### 6.1 Compile-Time Capability & Purity Contracts (100% Zero Runtime Overhead)
| Effect Tag | Triggering Operations | Static Guarantee & Engineering Value |
| :--- | :--- | :--- |
| **`IO`** | File, network, system clock, environment variable, stdio, or stateful external C calls | Marks non-deterministic external interaction; functions without `IO` are guaranteed free of external I/O |
| **`Async`** | Contains `.await` suspension points (compiled into stackless coroutine state machines) | Callable only within an asynchronous context or `Fiber` |
| **`Parallel`** | Dispatches multi-threaded data parallelism (e.g., `par_map`) or spawns concurrent tasks | Alerts callers to CPU-intensive thread-pool scheduling |
| **`AllocGC`** | Directly or transitively allocates `^T` managed heap memory | **Replaces `@nogc` cleanly**: any function without `AllocGC` is 100% statically guaranteed by the compiler to perform zero GC heap allocations across its entire call tree! |
| **`Unsafe`** | Dereferences raw C pointers `*c_raw<T>`, calls `.as_raw_ptr()`, or invokes raw external C functions | Narrows security and memory-safety auditing boundaries to explicit function signatures |

> **Pure Functions**: Any function declared with an empty effect set (`effects []`, or omitting `effects` in pure contexts) is a strictly **compile-time verified pure function**.

### 6.2 Explicit Public Boundaries & Automatic Internal Inference
1. **Public functions (`pub fn`) in `.jni` blueprints must explicitly declare `effects [...]`**: Guarantees 100% self-contained context locality when humans or AI agents inspect `.jni` blueprints across modules.
2. **Private helper functions and closures in `.jn` infer effects automatically**: Eliminates manual annotation noise inside implementation files, while higher-order functions (such as `map`) automatically forward the effect set of their closure arguments.
