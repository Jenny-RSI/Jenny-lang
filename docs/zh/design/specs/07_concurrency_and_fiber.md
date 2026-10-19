# Jenny 语言规范 —— 模块七：并发模型（`Fiber`、Continuation 状态机、`SyncContext` 与无数据竞争并行）

> **状态**：已定稿 (v2.0-spec)  
> **核心母题**：以 **`Fiber`（纤维）** 为轻量级并发执行单元，底层基于**免 `Pin` 位置无关的无栈协程 Continuation 状态机（Relocatable Stackless Coroutine）**，表层由 **`std::fiber::task` 铁三角（`SyncContext` 同步上下文 + `CompletionCell` 异步事件完成信源 + `FiberScope` 结构化育儿所）** 驱动，配合**跨协程逻辑因果栈（Causal `ErrorTrace` Stitching）**与**双轨内存编译期无数据竞争检查**，彻底消灭孤儿协程泄漏、`ConfigureAwait(false)` 死锁、`Pin<&mut Self>` 样板地狱与异步 Callstack 丢失。

---

## 1. 免 `Pin` 无栈协程 Continuation 状态机与显式 `.await` (Stackless Continuation Lowering)

### 1.1 `effects [Async]` 与 `.await` 后缀语法
1. **声明异步函数**：无需额外的 `async fn` 关键字前缀，统一在函数签名末尾通过 **`effects [Async]`** 声明该函数是一个可挂起的异步状态机函数。
2. **显式挂起点（Explicit Suspension Points）**：
   * 遵循“无隐式控制流跳转”原则，调用任何带有 `Async` 副作用的函数时，**必须显式书写后缀 `.await`**，使每个让出执行权的挂起点在代码审查时 100% 肉眼可见。
   * **为什么采用后缀 `.await` 而非前缀 `await expr`？** 因为后缀 `.await` 可与错误传播后缀 `?` 及方法调用链无缝从左到右串联（如 **`http::get(url).await?.json().await?`**），彻底告别 `(await (await http::get(url))?.json())?` 的括号地狱！

### 1.2 编译器 Continuation 状态机转换与“免 `Pin` 位置无关”定理
当编译器遇到包含 $k$ 个 `.await` 语句的 `effects [Async]` 函数时，自动将其拆分为 **状态帧结构体 `<Fn>_Frame` + 状态步进函数 `<Fn>_step(mut frame, action)`**：
1. **跨挂起点活跃变量分析（Live-Variable Packing）**：
   * 仅在单个基本块内使用、未跨越任何 `.await` 边界的临时变量直接保留为 CPU 寄存器局部变量；
   * 只有跨越了 `.await` 挂起点的参数、局部变量及子任务状态槽才会被打包进 `<Fn>_Frame`（外加 `__state: i32`，`0` 为初始态，`1..k` 为挂起恢复点，`-1` 为已完成，`-2` 为已取消）。
2. **为什么 Jenny 的 Continuation 状态机 100% 位置无关（彻底消灭 Rust `Pin<&mut Self>`）？**
   * 在 Rust 中，允许在 `async fn` 内写 `let r = &local_x; foo().await;`，导致生成的 `Future` 结构体内部含有指向自身字段的裸指针（Self-Referential Struct），一旦按值移动就会悬垂，迫使全生态引入极其晦涩的 `Pin<&mut Self>` 与 `Unpin`。
   * **在 Jenny v2.0 中，语法根源上废除了 `&x` 取局部变量地址**！跨 `.await` 存活的变量要么是纯值（`i64`、24B SSO `String`），要么是堆指针（`*T` / `^T`），要么是基于相对偏移的视图（`StrSliceView`）。因此 **Jenny 的每个 Continuation 状态机帧 100% 是可任意按值移动的重定位纯值结构体（Relocatable Value Struct）**，全语言永远不需要 `Pin`！
3. **状态感知的 `ACTION_CANCEL` 精确析构表（Cancel-Safety RAII）**：
   * 当外部 `FiberScope` 因 `race` 胜出或兄弟任务报错而向挂起中的状态机下达 `ACTION_CANCEL` 指令时，`<Fn>_step` 根据当前 `frame.__state` 精确释放该挂起点已分配但尚未消费的所有 `*T` 独占堆指针与 `@scoped` 资源，保证**中途取消 100% 零内存泄漏**。
4. **沿着 Continuation 恢复链的逻辑因果调用栈（Causal `ErrorTrace`）**：
   * 每个 `Fiber` 控制块内嵌独立的 16 槽位 `ErrorTrace`（128 字节，Fiber-Local 隔离）；
   * 当子状态机返回 `POLL_ERR` 唤醒父状态机的 `.await?` 恢复分支（`case K:`）时，自动向 `ErrorTrace` 追加带有 **`AWAIT_PROP`** 类别与当前挂起点编号 `await_state = K` 的 8 字节 `TraceFrame`；跨协程 `join` 汇聚时自动执行 `stitch_from_child` 压入 **`SPAWN_JOIN`** 边界帧，使异步错误调用栈 100% 保持因果连续。

---

## 2. `std::fiber::task` 异步核心铁三角：`SyncContext` + `CompletionCell` + `FiberScope`

### 2.1 `SyncContext`：同步与调度上下文（消灭 C# `ConfigureAwait(false)` 死锁）
当 Continuation 状态机在 `.await` 挂起、后台事件完成后，“下半段恢复代码排入哪个队列、在哪个线程上恢复？”由 **`SyncContext`** 决定：

1. **四种正交派发模式 (`DispatchMode`)**：
   * **`DispatchMode.ThreadPinned`**：严格绑定原宿主线程恢复（适用于 UI 主线程、游戏帧循环、Wasm 单线程宿主）；
   * **`DispatchMode.StrandSerial`**：逻辑串行队列（Actor/Strand 模式：可在不同物理线程执行，但同一 `SyncContext` 内严格保证 **`active_running <= 1`**，天然保护含 `var` 可变字段的 `^T` 托管对象免加锁安全读写！）；
   * **`DispatchMode.WorkStealing`**：多线程工作窃取池（仅允许只含 `*T` 独占指针或全 `val` 不可变 `^T` 的 `Send` 协程）；
   * **`DispatchMode.DeterministicSim`**：内置虚拟单调时钟 `virtual_clock_ms` 的确定性单步仿真队列（专用于 `@example` 编译期沙箱与确定性重放测试）。
2. **核心数学不变式与免死锁事件泵 (`drain_ready` / `block_on`)**：
   * `SyncContext` 强制守卫不变式：`invariant (self.mode == DispatchMode.WorkStealing) || (self.active_running >= 0 && self.active_running <= 1)`；
   * 同步入口等待异步任务时，当前线程直接化身事件泵调用 `drain_ready()` 原地消费投递回本上下文的 Continuation，**从机制上根绝了 C# 主线程 `.Wait()` 与子任务 `Post` 互等的 `Sync-Over-Async` 死锁，全语言无需 `.ConfigureAwait(false)`**！

### 2.2 `CompletionCell`：在异步事件中主动返回结果与防死等保护
在异步调用链最底层的外部事件回调（OS `epoll`/`IOCP`、定时器到期、C 回调、RPC 响应）中，使用 **`CompletionCell`** 主动填入异步结果并唤醒挂起的 Continuation：

1. **四态终结状态机 (`CompletionState`)**：`Pending` $\rightarrow$ `ResolvedOk` | `ResolvedErr` | `Abandoned`。
2. **核心契约保证**：
   * **主动完成并自动投递 `SyncContext`**：事件回调调用 `cell.complete_ok(mut sync_ctx, val)` 或 `cell.complete_err(mut sync_ctx, err_code64)` 时，仅执行 $O(1)$ 状态转换并自动调用 `sync_ctx.post_continuation(waiter_frame_id)` 将等待协程排入其所属 `SyncContext` 的就绪队列，**绝不在事件中断栈上同步劫持执行等待方的后续代码**；
   * **契约防重复触发**：`complete_ok`/`complete_err` 强制 `requires self.state == CompletionState.Pending else TaskError.AlreadyCompleted`，并提供幂等的 `try_complete_ok` 供超时与正常响应竞速；
   * **析构自动破死等（RAII Abandonment Protection）**：若事件源异常退出销毁 `CompletionCell`（`abandon` / `drop`）时尚未填入结果（仍为 `Pending`），自动切换为 `CompletionState.Abandoned` 并唤醒等待协程返回 `TaskError.CompletionAbandoned`，**彻底消灭“事件源遗忘回调导致 `.await` 永久死等挂起”的顽疾**！

### 2.3 `FiberScope` & `CancelToken`：双层结构化并发与级联取消
为了彻底消灭“孤儿协程泄漏”并安全允许子任务直接共享父函数栈帧上的只读参数，`FiberScope` 强制守卫四态计数守恒不变式：
`invariant self.total_spawned == self.active_count + self.completed_count + self.failed_count + self.cancelled_count`，且在离开作用域时强制 `ensures self.active_count == 0`（因此子协程可**零拷贝直接借用父函数栈上的只读切片视图 `[]T`**，无需 Rust 的 `'static` 与 `Arc`）：

1. **`join_all` / `fiber::all(t1, t2, ...).await?`（全成功汇聚 + Fail-Fast 级联取消）**：
   * 等待全部子任务完成；若任一子任务抛出错误，**立即自动向其余活跃兄弟任务广播 `Cancelled`**，驱动其状态机执行 `ACTION_CANCEL` 释放 `*T` 资源后向上抛出首个错误（含跨协程嫁接的 `ErrorTrace`）。
2. **`race_first` / `fiber::race(t1, t2, ...).await?`（最快胜出竞速）**：
   * 第一个子任务成功完成时立即自动取消其余慢速兄弟任务并返回胜出结果；仅当全部子任务均失败时才抛出首个错误。
3. **`settle_all`（容错全收集）**：
   * 等待所有子任务全部水落石出而不中断兄弟任务，返回成功与失败统计。
4. **免参数传染的 `CancelToken`**：
   * 内嵌于 Fiber 控制块中（免去 Go `ctx context.Context` 首个参数传染），通过 `check_alive(elapsed_ms)?` 一行式校验主动取消信号与超时预算（`DeadlineExceeded`）。

---

## 3. 双轨内存的编译期无数据竞争铁律 (Data-Race Freedom)

当 `Fiber` 或并行任务在多线程工作窃取池（`DispatchMode.WorkStealing`）上跨 OS 线程执行时，编译器通过自动合成的并发标记特征（`Send` / `Sync`），在编译期 **100% 静态拦截一切数据竞争（Data Race）**：

| 跨线程传递的数据类型 | 编译期并发检查规则 | 性能与安全收益 |
| :--- | :--- | :--- |
| **`*T`（原生唯一所有权指针）** | **天然 `Send`（`own` 显式移交）**：跨线程传入 `s.spawn(fn[own ptr] ...)` 或写入 `ch.send(own ptr)` 时正式移交所有权，发送方立即丧失访问权。 | **零拷贝、零加锁、零引用计数开销**，在线程间极速传递百万像素缓冲区或音频帧。 |
| **全 `val` 不可变的 `^T`** | **天然 `Send + Sync`（只读共享）**：若 `^T` 结构体及其递归字段全部声明为不可变 `val`，允许任意多线程同时持有 `^T` 句柄并发读取。 | 无需加锁即可在多线程间零拷贝共享全局配置树、路由表或只读字典。 |
| **含 `var` 可变字段的 `^T`** | **严禁跨线程窃取（绑定 `ThreadPinned` / `StrandSerial`）**！编译器静态禁止含 `var` 字段的 `^T` 进入 `WorkStealing` 池或裸传给其他线程。 | 彻底堵死 Go / Java 中多个协程同时读写同一个堆对象导致的数据竞争与内存损坏漏洞！ |
| **受同步原语保护的 `^T`** | 当可变状态被封装在 `std::fiber::sync` 的受控同步容器或通过 `Channel` 传递时，恢复跨线程协同能力。 | 强制所有跨线程可变状态修改必须经过编译期验证的同步契约或串行消息队列。 |

---

## 4. 标准库并发通信、同步与数据并行 (`std::fiber::{channel, sync, parallel}`)

为避免 Rust 生态中 `std::sync`、`tokio::sync`、`rayon` 割裂的痛点，Jenny 将通道、同步原语与数据并行统一收敛于 `std::fiber` 子域下：

1. **`std::fiber::channel`（有界背压消息通道 `BoundedChannel`）**：
   * 基于 `RawBuf` 环形缓冲实现，强制守卫 `0 <= count <= cap` 水位不变式；支持 `send`、`recv`、`try_send`、`close` 与排空（Closed 状态下禁止新 `send`，但允许消费者排空已缓冲消息）。
2. **`std::fiber::sync`（原子操作、计数栅栏与受控互斥状态机）**：
   * 桥接 `std::rt::intrinsics` 原子原语，提供 `AtomicCounter`（`load`/`store`/`fetch_add`/`cas`）、协程等待组 `WaitGroup`（强制 `pending >= 0` 防负计数下溢契约）与排他锁状态机 `MutexState`。
3. **`std::fiber::parallel`（确定性无数据竞争数据并行算子）**：
   * 提供 `par_map`、`par_reduce`、`par_filter_count` 等分块并行算子，静态要求 `effects [Parallel]` 且闭包无未加锁可变混叠。

---

## 5. Layer 3 操作系统线程、硬件原子与原生同步底座 (`std::thread::{atomic, os_thread, sync, os_sync}`)

在用户态协作式纤程（`std::fiber`，Layer 4）之下，Jenny 提供白盒化的 **Layer 3 硬件原子与 1:1 操作系统内核线程基础设施（`std::thread`）**，既支撑 `std::fiber` 工作窃取调度器用 Jenny 自举，也满足硬实时音视频流、独立 CPU 核绑定与跨进程同步的系统级需求。

### 5.1 四大子模块与三大 OS 内核原语映射矩阵

| 模块路径 | 核心原语与数据结构 | Linux (Kernel / glibc) | Windows (NT / Win32) | macOS / BSD (XNU) | 核心契约与设计价值 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. `std::thread::atomic`**<br>*(硬件原子与防伪共享)* | • `AtomicBool`、`AtomicI64`、`AtomicUsize`、`AtomicPtr<T>`<br>• `MemoryOrder` (`Relaxed`..`SeqCst`)<br>• `CachePadded<T>`（64/128B 缓存行对齐）<br>• `spin_loop_hint()` | LLVM `atomicrmw` / `cmpxchg` + `PAUSE`/`YIELD` | LLVM Atomics + `_mm_pause` | LLVM Atomics + `yield` | 支撑无锁数据结构、`CompletionCell` 状态机与 Chase-Lev 工作窃取双端队列，消除多核伪共享（False Sharing） |
| **2. `std::thread::os_thread`**<br>*(1:1 内核线程与拓扑)* | • `OsThread`、`ThreadBuilder`（栈大小、优先级、`pin_to_core(cpu_id)` 物理核绑定）<br>• `ScopedThreadScope`（结构化借用父栈）<br>• `ThreadLocal<T>` | `pthread_create` + `sched_setaffinity` + `__thread` | `CreateThread` + `SetThreadAffinityMask` + `FlsAlloc` | `pthread_create` + `thread_policy_set` | 支撑硬实时线程独占物理核及 Immix GC / Scratch Arena 的线程局部存储（TLS） |
| **3. `std::thread::sync`**<br>*(进程内 OS 原生同步)* | • `Futex` (`wait_u32`, `wake_one`, `wake_all`)<br>• `SpinLock<T>`、`OsMutex<T>`（支持 `PriorityInherit`）、`OsRwLock<T>`<br>• `OsCondvar`（强制单调时钟 `Duration`）、`OsOnce`、`OsBarrier` | `futex` + `pthread_mutex_t` (`PTHREAD_PRIO_INHERIT`) + `CLOCK_MONOTONIC` | `WaitOnAddress` + `SRWLOCK` / `CONDITION_VARIABLE` + `INIT_ONCE` | `__ulock_wait` + `os_unfair_lock` / `pthread_mutex_t` | 1. 支持 `.as_raw_os_ptr()` 零胶水直传 C FFI；<br>2. 优先级继承防止硬实时线程反转；<br>3. 强制绑定单调时钟免疫 NTP 回拨卡死 |
| **4. `std::thread::os_sync`**<br>*(内核句柄与跨进程同步)* | • **`OsEvent`**（OS 线程 $\leftrightarrow$ Fiber 异步 Reactor 唤醒桥接）<br>• `OsSemaphore` / `NamedSemaphore`<br>• **`RobustNamedMutex`**（跨进程崩溃自动恢复锁）<br>• `FileAdvisoryLock` | **`eventfd`** + `sem_open` + `pthread_mutex_t` (`PROCESS_SHARED \| ROBUST`) + `flock` | **`CreateEventW`** + `CreateSemaphoreW` + Named `CreateMutexW` (`WAIT_ABANDONED`) + `LockFileEx` | `EVFILT_USER` + `sem_open` + `flock` | 1. `OsEvent` 既可阻塞 `wait()` 又可注册进 `std::fiber` 进行 `.await`；<br>2. `RobustNamedMutex` 在持锁进程崩溃时返回 `Err(SyncError.OwnerAbandoned)`，根绝跨进程死锁 |

---

## 6. 四道防死锁与死锁检测体系 (Four-Tier Deadlock Prevention & Detection Architecture)

针对并发编程中的四大死锁根源（跨 `.await` 持 OS 锁、同调用链自重入、多锁 AB-BA 顺序反转、跨线程/纤程动态环路等待），Jenny 构建了 **快路径零开销、且绝不污染抽象 `trait` 接口** 的四道防线：

### 6.1 防线一：编译期静态死锁根除（`E0705` ~ `E0707`，零运行期开销）
1. **`E0705_OS_LOCK_HELD_ACROSS_AWAIT`（禁止跨 `.await` 持有 OS 阻塞锁守卫）**：
   * `std::thread::sync` 中的所有阻塞型锁守卫（`SpinLockGuard<T>`、`OsMutexGuard<T>`、`OsRwLockReadGuard<T>`、`OsRwLockWriteGuard<T>`）均带有 `@non_suspendable` 属性。
   * 编译器在将 `effects [Async]` 函数降级为 Continuation 状态机时，静态扫描每个 `.await` 切点处的活跃局部变量；若存在未释放的 `@non_suspendable` 守卫跨越 `.await`，立即编译报错 **`E0705`**，提示在 `.await` 前释放或改用 `std::fiber::sync::AsyncMutex`。
2. **`E0706_TLS_BORROW_ACROSS_AWAIT`（禁止在 `WorkStealing` 纤程中跨 `.await` 借用 `ThreadLocal`）**：
   * 防止 Fiber 在 `.await` 恢复并迁移至另一物理 OS 线程后访问错误的线程局部存储（应改用 `FiberLocal<T>`）。
3. **`E0707_SELF_REENTRANT_LOCK_DEADLOCK`（同调用链非重入锁重复获取静态拦截）**：
   * 编译器在调用图上对同一接收者的同一锁字段（`self.<mtx>`）执行流敏感分析，静态拦截未释放即递归重入的必死锁代码。

### 6.2 防线二：API 级破除环路等待（`sync::lock_pair` 地址全序加锁 + `LockLevel` 层级契约）
1. **双锁/多锁地址全序原子获取（`sync::lock_pair` & `@spin pub fn lock_all`）**：
   * 当需要同时获取两个或更多锁（如账户转账 `transfer(mut a, mut b)`）时，`sync::lock_pair(mut a.mtx, mut b.mtx)` 内部自动按锁实例的**规范化物理内存地址（`addr_a < addr_b`）升序排列**后再依次加锁，从数学上打破 Coffman 环路等待条件！
   * **同锁别名保护**：若传入的两个锁指向同一地址（`addr_a == addr_b`），立即返回 **`Err(SyncError.AliasedSameLock)`** 而非自阻塞死锁。
2. **锁层级契约（`LockLevel` —— 单线程单元测试即可抓出潜在 AB-BA 逆序加锁）**：
   * 锁实例可绑定层级号 `level: u16`（如 `10`、`20`），每个线程/Fiber 控制块头用 2 字节维护当前已持有的最大锁层级 `max_held_level: u16`。
   * 前置契约：`requires self.level > current_max_held_level() else SyncError.LockOrderViolation`。
   * **核心收益**：无需等待多线程高并发压测碰巧撞出死锁，在 **`jenny_test` 单线程测试** 中一旦代码先拿了高层级锁再去拿低层级锁，当场立即触发 `SyncError.LockOrderViolation`！

### 6.3 防线三：慢路径 $O(D)$ 零分配“等待图（Wait-For Graph）”实时环路死锁检测器
对于未显式指定 `LockLevel` 的动态锁，Jenny 在运行期提供**快路径 0 开销、慢路径 $< 30\text{ns}$ 零堆分配**的实时死锁环检测：
1. **无争用快路径（Fast Path，占 99.9% 情况）**：CAS 直接成功并将锁头的 `owner_actor_id` 设为当前线程/Fiber ID，**0 额外指令开销**。
2. **争用阻塞慢路径（Slow Path，即将进入 `Futex.wait` 或 Fiber 挂起前）**：
   * 因为任意线程或 Fiber 在同一时刻**最多只能阻塞等待 1 把锁**，全局等待图（Wait-For Graph）中每个节点的出度 $\le 1$（即一条单向指针链）。
   * 当前线程/Fiber 在休眠前将 `self.waiting_for = target_lock`，随后顺着指针链最多遍历 $D = 16$ 步：
     $$\text{Self} \xrightarrow{\text{waiting\_for}} \text{Lock}_1 \xrightarrow{\text{owner}} \text{Actor}_B \xrightarrow{\text{waiting\_for}} \text{Lock}_2 \xrightarrow{\text{owner}} \dots$$
   * **一旦指针链回到 `Self`**：立即确认发生 100% 闭合死锁环！当前加锁调用**立即中止等待并返回 `Err(SyncError.DeadlockCycleDetected)`**，同时将环路上各节点的符号与行号写入 `ErrorTrace`！

### 6.4 防线四：`mask [Sync]` 受控副作用阻断（零抽象接口污染）与 `spindle audit` 审计信号
1. **不污染抽象 `trait` 接口**：
   * 底层锁与信号量操作带有 `effects [Sync]`；但当某个具体实现（如 `ConcurrentLruStore::get(self)`）在函数内部加锁并在返回前 100% 释放锁时，可在 `.jn` 实现中标注 **`mask [Sync]`** 阻断副作用向上传播，从而无需在顶层抽象接口 `pub trait KvStore` 上被迫添加 `effects [Sync]`。
2. **阻断点静态检查与后期安全审计信号**：
   * 编译器对所有 `mask [Sync]` 强制校验 **`E0709_MASKED_LOCK_ESCAPE`**（严禁任何未释放的锁守卫或信号量许可逃逸出 `mask [Sync]` 作用域）；
   * 同时，`spindle audit` 将全仓所有的 `mask [Sync]`、`mask [Unsafe]`、`mask [AllocNative]` 汇总为结构化代码审计信号（区分 `SAFE_LEAF_CRITICAL_SECTION` 与持锁调外部接口的 `W0710_EXTERNAL_CALL_UNDER_MASKED_SYNC`），供人类架构师或设计模型后期精准审计。
