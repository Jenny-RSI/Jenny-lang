# Jenny Language Specification — Module 07: Concurrency Model (`Fiber`, Structured Async, and Data-Race-Free Parallelism)

> **Language**: English | [中文版 (Chinese)](../../zh/design/specs/07_concurrency_and_fiber.md)  
> **Status**: Finalized (v2.0-spec)  
> **Core Theme**: Built around **`Fiber`** as the lightweight concurrent execution unit, powered under the hood by stackless coroutine state-machine lowering, and enforcing **explicit `.await` suspension + structured concurrency scopes + compile-time data-race freedom across dual-track memory** at the surface level, while pushing `Channel` and `par_map` into the official standard library to keep the language core minimal and orthogonal.

---

## 1. Stackless Coroutines and the Explicit `.await` Contract

### 1.1 `effects [Async]` and Postfix `.await` Syntax
1. **Declaring Asynchronous Functions**: No separate `async fn` keyword prefix is needed. Instead, a suspendable asynchronous state-machine function is declared uniformly at the end of its signature via **`effects [Async]`**.
2. **Explicit Suspension Points**:
   * Following the principle of "no implicit control-flow jumps", calling any function carrying the `Async` effect **must explicitly use the postfix `.await` operator**, making every suspension point that yields execution 100% visible during code review.
   * **Why postfix `.await` instead of prefix `await expr`?** Because postfix `.await` chains naturally from left to right with the error-propagation postfix `?` and method calls (e.g., **`http::get(url).await?.json().await?`**), completely eliminating the parenthesis hell of `(await (await http::get(url))?.json())?`!
3. **Stackless State Machine Lowering**:
   * During the MIR stage (Stage 4), the compiler automatically packs an `effects [Async]` function and all local variables live across `.await` suspension points into a compact, flat state struct with **zero independent call-stack allocation overhead**, allowing millions of concurrent `Fiber` instances to run simultaneously on both Native and WebAssembly targets.

---

## 2. Two-Tier Structured Concurrency and `Fiber` Lifetimes (`std::fiber`)

To completely eliminate "orphan coroutine leaks", safely allow child tasks to share read-only borrowed parameters directly from the parent stack frame, and maximally compress concurrency boilerplate (Token economics), Jenny provides a **two-tier structured concurrency API** via `std::fiber`:

### 2.1 Tier 1 (Covers 80% of Scenarios): One-Line Concurrency Combinators `fiber::all` and `fiber::race`
For the common pattern of launching a fixed set of asynchronous tasks concurrently and waiting for all of them (or the fastest one) to finish, there is no need to write verbose `scope + spawn + join` closure boilerplate—use `fiber::all` or `fiber::race` directly:
* **`fiber::all(t1, t2, ...).await?`**: Launches all passed asynchronous tasks concurrently and returns the result tuple `(r1, r2, ...)` when all succeed; if any task raises an error, it **immediately cancels all remaining sibling tasks** and safely unwinds and releases any `*T` and `@scoped` resources along the way!
* **`fiber::race(t1, t2, ...).await?`**: Launches tasks concurrently, immediately cancels the remaining tasks as soon as the first task completes, and returns the fastest result (commonly used for timeouts or hedged requests).

```jenny
import std::fiber

pub fn load_dashboard(db: DbPool, uid: u64) -> Dashboard ! DbError 
    effects [Async, IO] 
{
    // 1 line replaces 7 lines of traditional spawn + join boilerplate!
    // Directly and safely shares the read-only borrowed parameter `db`
    val (user, orders) = fiber::all(
        db.query_user(uid),
        db.query_orders(uid)
    ).await?

    return Dashboard { user: user, orders: orders }
}
```

### 2.2 Tier 2 (Covers 20% Dynamic Scenarios): `fiber::scope` Lexical Scope Spawning
When dynamically spawning a variable number of child tasks inside a loop, use `fiber::scope`:
* **Local Stack Sharing Without `'static` Constraints**: Because `fiber::scope` statically guarantees that all spawned child `Fiber` instances finish executing before control exits the lexical block, the compiler **safely allows code inside `s.spawn` to directly access read-only borrowed variables and slice views on the parent function's stack**!

```jenny
import std::fiber::{self, FiberScope, Fiber}

pub fn fetch_all_shards(db: DbPool, shard_ids: []u32) -> []ShardData! 
    effects [Async, IO] 
{
    return fiber::scope(fn(s: FiberScope) -> []ShardData! {
        var fibers = Array::<Fiber<ShardData!>>::new()
        for id in shard_ids {
            fibers.push(own s.spawn(fn() => db.query_shard(id).await))
        }
        return fibers |> map(fn(f) => f.join().await?) |> collect()
    }).await
}
```

---

## 3. Compile-Time Data-Race Freedom Across Dual-Track Memory

When `Fiber` instances or parallel tasks execute across OS threads on a multi-threaded work-stealing scheduler, the compiler uses automatically synthesized concurrency marker traits (`Send`: safe to transfer ownership across threads; `Sync`: safe to share read-only borrows/references across threads) to **statically intercept 100% of data races at compile time**:

| Data Type Passed Across Threads | Compile-Time Concurrency Rule | Performance & Safety Benefit |
| :--- | :--- | :--- |
| **`*T` (Native Unique Ownership Pointer)** | **Naturally `Send` (Explicit `own` Transfer)**: Passing `s.spawn(fn[own ptr] ...)` or writing `ch.send(own ptr)` across threads formally transfers ownership, and the sender thread immediately loses access. | **Zero copy, zero locking, zero reference-counting overhead**—transfers multi-megapixel buffers or audio frames across threads at wire speed. |
| **All-`val` Immutable `^T`** | **Naturally `Send + Sync` (Read-Only Sharing)**: If a `^T` struct and all of its recursive fields are declared as immutable `val`, any number of threads may hold `^T` handles and read them concurrently. | Shares global configuration trees, routing tables, or read-only dictionaries across threads with zero copying and zero locks. |
| **`^T` Containing `var` Mutable Fields** | **Bare Cross-Thread Transfer Strictly Forbidden (Neither `Send` Nor `Sync`)!** Because a mutable `^T` permits unrestricted aliased mutation within a single thread, the compiler **statically forbids passing it directly to another thread**. | Completely closes the loophole of concurrent read/write data races and heap corruption common in Go and Java! |
| **`^T` Protected by Synchronization Primitives** | When mutable state is encapsulated inside standard-library synchronization containers **`^Mutex<T>`**, **`^RwLock<T>`**, or **`Actor<T>`**, `Send + Sync` cross-thread sharing is restored. | Enforces that every cross-thread state mutation goes through a compile-time-verified lock guard (`@scoped MutexGuard`) or serialized message queue. |

---

## 4. Standard Library Concurrency Communication and Data Parallelism (`std::sync` & `std::parallel`)

To keep the core language syntax lean, high-level concurrency communication primitives and data-parallel operators are provided by the official standard library (built atop Jenny's native generics, closures, `@scoped`, and `iter fn`):

### 4.1 Type-Safe Channels: `std::sync::Channel<T>`
* Supports both bounded backpressure channels `Channel::<T>::bounded(cap)` and unbounded channels `Channel::<T>::unbounded()`.
* Combines seamlessly with `*T` ownership transfer semantics: `ch.send(own raw_frame).await?` transfers unique ownership of a `*RawFrame` pointer to the consumer `Fiber` with zero copying.

### 4.2 Data-Parallel Pipeline Operators: `std::parallel` (`par_map` / `par_filter` / `par_reduce`)
* Built on a divide-and-conquer work-stealing pool (Native thread pool / Wasm Web Workers shared-memory pool), the standard library provides parallel pipeline operators isomorphic to sequential iterators.
* **Static Verification of Purity and Concurrency Safety**: In its generic signature, `par_map(items, closure)` enforces `Send / Sync` constraints on both elements and the captured environment, forbidding unlocked mutation of external mutable variables inside parallel closures:

```jenny
import std::parallel::{par_map, collect}

pub fn batch_normalize(chunks: []*AudioChunk) -> []f32 
    effects [Parallel] 
{
    // Parameter `chunk: AudioChunk` defaults to a read-only borrow view, automatically dereferencing `*AudioChunk`!
    return chunks
        |> par_map(fn(chunk: AudioChunk) -> f32 => compute_peak(chunk))
        |> collect()
}
```
