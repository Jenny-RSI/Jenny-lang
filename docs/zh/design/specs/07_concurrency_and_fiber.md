# Jenny 语言规范 —— 模块七：并发模型（`Fiber`、结构化异步与无数据竞争并行）

> **状态**：已定稿 (v1.0-spec)  
> **核心母题**：以 **`Fiber`（纤维）** 为轻量级并发执行单元，底层基于无栈协程状态机（Stackless Coroutine Lowering），表层强制**显式 `.await` 挂起 + 结构化并发作用域 + 双轨内存编译期无数据竞争检查**，并将 `Channel` 与 `par_map` 下沉至官方标准库，保持语言内核极简正交。

---

## 1. 无栈协程与显式 `.await` 契约 (Stackless Async & Explicit `.await`)

### 1.1 `effects [Async]` 与 `.await` 后缀语法
1. **声明异步函数**：无需额外的 `async fn` 关键字前缀，统一在函数签名末尾通过 **`effects [Async]`** 声明该函数是一个可挂起的异步状态机函数。
2. **显式挂起点（Explicit Suspension Points）**：
   * 遵循“无隐式控制流跳转”原则，调用任何带有 `Async` 效应的函数时，**必须显式书写后缀 `.await`**，使每个让出执行权的挂起点在代码审查时 100% 肉眼可见。
   * **为什么采用后缀 `.await` 而非前缀 `await expr`？** 因为后缀 `.await` 可与错误传播后缀 `?` 及方法调用链无缝从左到右串联（如 **`http::get(url).await?.json().await?`**），彻底告别 `(await (await http::get(url))?.json())?` 的括号地狱！
3. **无栈状态机降级（State Machine Lowering）**：
   * 编译器在 MIR（Stage 4）阶段自动将 `effects [Async]` 函数及其 `.await` 挂起点间跨越的局部变量打包生成为一个紧凑的扁平结构体，**零独立调用栈分配开销**，在 Native 与 WebAssembly 环境下均可同时承载数百万个并发 `Fiber`。

---

## 2. 双层结构化并发与 `Fiber` 生命周期 (`std::fiber`)

为了彻底消灭“孤儿协程泄露”、安全允许子任务直接共享父函数栈帧上的只读参数，并最大化压缩并发样板代码（Token 经济学），Jenny 通过 `std::fiber` 标准库提供**双层结构化并发 API**：

### 2.1 第一层（覆盖 80% 场景）：一行式并发组合子 `fiber::all` 与 `fiber::race`
针对“同时发起固定数量的异步任务并等待全部完成（或取最快完成者）”的高频场景，无需编写繁琐的 `scope + spawn + join` 闭包样板，直接使用 `fiber::all` 或 `fiber::race`：
* **`fiber::all(t1, t2, ...).await?`**：并发启动所有传入的异步任务，全部成功时返回结果元组 `(r1, r2, ...)`；若任一任务抛出错误，**立即自动取消其余正在运行的兄弟任务**并安全回滚释放沿途的 `*T` 与 `@scoped` 资源！
* **`fiber::race(t1, t2, ...).await?`**：并发启动任务，当第一个任务完成时立即自动取消其余任务并返回最快结果（常用于超时控制或冗余备份请求）。

```rust
import std::fiber

pub fn load_dashboard(db: DbPool, uid: u64) -> Dashboard ! DbError 
    effects [Async, IO] 
{
    // 1 行代码替代传统的 7 行 spawn + join 样板！直接安全共享只读借用参数 db
    val (user, orders) = fiber::all(
        db.query_user(uid),
        db.query_orders(uid)
    ).await?

    return Dashboard { user: user, orders: orders }
}
```

### 2.2 第二层（覆盖 20% 动态场景）：`fiber::scope` 词法作用域派生
当需要在循环中动态派生数量不定的子任务时，使用 `fiber::scope`：
* **突破 `'static` 限制的局部栈共享**：由于 `fiber::scope` 静态保证所有派生的子 `Fiber` 必定在离开该词法块之前全部执行完毕，编译器**允许在 `s.spawn` 内部直接安全访问父函数栈上的只读借用变量与切片视图**！

```rust
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

## 3. 双轨内存的编译期无数据竞争铁律 (Data-Race Freedom)

当 `Fiber` 或并行任务在多线程工作窃取调度器（Work-Stealing Scheduler）上跨 OS 线程执行时，编译器通过自动合成的并发标记特征（`Send`：可跨线程转移所有权；`Sync`：可跨线程共享借用/引用），在编译期 **100% 静态拦截一切数据竞争（Data Race）**：

| 跨线程传递的数据类型 | 编译期并发检查规则 | 性能与安全收益 |
| :--- | :--- | :--- |
| **`*T`（原生唯一所有权指针）** | **天然 `Send`（`own` 显式移交）**：跨线程传入 `s.spawn(fn[own ptr] ...)` 或写入 `ch.send(own ptr)` 时正式移交所有权，发送方线程立即丧失访问权。 | **零拷贝、零加锁、零引用计数开销**，在线程间极速传递百万像素缓冲区或音频帧。 |
| **全 `val` 不可变的 `^T`** | **天然 `Send + Sync`（只读共享）**：若 `^T` 结构体及其递归字段全部声明为不可变 `val`，允许任意多线程同时持有 `^T` 句柄并发读取。 | 无需加锁即可在多线程间零拷贝共享全局配置树、路由表或只读字典。 |
| **含 `var` 可变字段的 `^T`** | **严禁裸跨线程（非 `Send` / 非 `Sync`）**！由于可变 `^T` 允许单线程内自由别名修改，编译器**静态禁止将其直接传给其他线程**。 | 彻底堵死 Go / Java 中多个协程同时读写同一个堆对象导致的数据竞争与内存损坏漏洞！ |
| **受同步原语保护的 `^T`** | 当可变状态被封装在标准库同步容器 **`^Mutex<T>`**、**`^RwLock<T>`** 或 **`Actor<T>`** 内部时，恢复 `Send + Sync` 跨线程共享能力。 | 强制所有跨线程可变状态修改必须经过编译期验证的锁守卫（`@scoped MutexGuard`）或串行消息队列。 |

---

## 4. 标准库并发通信与数据并行 (`std::sync` & `std::parallel`)

为保持语言核心语法精炼，高级并发通信与数据并行算子统一由官方标准库提供（利用语言原生的泛型、闭包、`@scoped` 与 `iter fn` 实现）：

### 4.1 类型安全通道：`std::sync::Channel<T>`
* 支持有界背压通道 `Channel::<T>::bounded(cap)` 与无界通道 `Channel::<T>::unbounded()`。
* 完美结合 `*T` 所有权移交语义：`ch.send(own raw_frame).await?` 直接将 `*RawFrame` 指针的唯一所有权零拷贝移交给消费者 `Fiber`。

### 4.2 数据并行管道算子：`std::parallel` (`par_map` / `par_filter` / `par_reduce`)
* 标准库基于分治工作窃取池（Native 线程池 / Wasm Web Workers 共享内存池）提供与串行迭代器同构的并行管道函数。
* **纯度与并发安全静态校验**：`par_map(items, closure)` 在泛型签名上强制要求元素与捕获环境满足 `Send / Sync` 约束，禁止在并行闭包内未加锁地修改外部可变变量：

```rust
import std::parallel::{par_map, collect}

pub fn batch_normalize(chunks: []*AudioChunk) -> []f32 
    effects [Parallel] 
{
    // 参数 chunk: AudioChunk 默认即为只读借用视图，自动解引用适配 *AudioChunk！
    return chunks
        |> par_map(fn(chunk: AudioChunk) -> f32 => compute_peak(chunk))
        |> collect()
}
```
