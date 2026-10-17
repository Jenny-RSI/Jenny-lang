# Jenny 语言规范 —— 模块五：三层渐进式错误截断与静态副作用契约系统 (Layered Error Truncation & Static Effect Contracts)

> **状态**：已定稿 (v2.0 — AI-Native 演进版)  
> **核心理念**：彻底终结编程语言史上“底层精确枚举导致高层签名雪球爆炸（Rust `thiserror` 痛点）”与“抽象接口 `trait` 无法预知具体实现错误（Java `throws` 痛点）”的世纪矛盾；首创 **“底层精确错误 `T ! E` $\times$ 领域/接口层混合截断 `T ! (BizError | AnyError)` $\times$ 顶层全截断 `T!`（`T ! AnyError`）”** 三层错误架构，配合 **16 字节小错误寄存器内联（零堆分配）** 与 **线程局部零成本错误传播轨迹栈（Error Trace RingBuffer）**。

---

## 1. 为什么传统强类型错误系统在高层业务与抽象接口中会崩溃？

站在大型工程与 AI 生成代码的视角下，单一的静态错误枚举（如仅支持 `Result<T, E>`）面临两大不可调和的架构困境：
1. **深层调用链的“错误雪球效应”**：一个高层业务工作流往往调用了 DB、Redis、HTTP、JSON、文件系统等 8 个底层模块。若强迫高层函数将底层 30 种具体错误全部暴露在签名上，会导致顶层错误枚举极度臃肿，且最底层新增一个细微错误就会引发整条调用链签名的级联修改。
2. **可替换抽象接口（`trait`）的“未知实现悖论”**：定义抽象接口 `trait Storage` 时，架构师根本无法预知未来的实现是内存 Mock、SQLite、RocksDB 还是远程 S3（它们各自抛出截然不同的底层基础设施错误）。

为此，Jenny 在语言层原生提供**三层渐进式错误截断体系**，让每一层代码只暴露该层级真正关心的错误粒度！

---

## 2. 三层渐进式错误类型体系 (`T ! E` / `T ! (E | AnyError)` / `T!`)

### 2.1 三层架构全景矩阵

| 架构层级 | 标准签名语法 | 语义契约与 `?` 自动传播行为 | 典型应用场景 |
| :--- | :--- | :--- | :--- |
| **第一层：底层确定性模块**<br>*(封闭精确错误)* | **`T ! E`**<br>或联合 **`T ! (E1 \| E2)`** | 错误集合 100% 编译期封闭已知，栈上按值返回，调用方可通过 `match` 穷尽处理所有分支。 | 数据结构（`RingBuffer`）、编解码器、底层算法、系统原语 |
| **第二层：抽象接口 (`trait`) 与领域服务层**<br>*(业务显式 + 基础设施截断)* | **`T ! (BizError \| AnyError)`** | **神级解耦设计**：调用方在业务上必须显式关心 `BizError`（如 `UserNotFound`、`InsufficientFunds`）；而具体实现内部触发的任何底层基础设施错误（SQL 断连、磁盘满、超时），在使用 `?` 时**自动被截断擦除并吸收进 `AnyError`**！ | `trait` 多态接口定义、核心领域服务、跨模块 RPC 边界 |
| **第三层：顶层应用 / 控制器 / 脚本**<br>*(全量开放截断)* | **`T ! AnyError`**<br>*(语法糖简写为 **`T!`**)* | 后缀单感叹号 **`T!`** 即 `T ! AnyError` 的标准简写。一键自动吸收调用链上任意模块抛出的任何错误，彻底消灭顶层样板错误定义！ | HTTP Controller、CLI 入口 `main() -> void!`、业务编排管线、测试函数 |

### 2.2 类型修饰符结合优先级铁律
**前缀内存轨道修饰符（`*`、`^`、`[]`）的结合优先级严格高于后缀可空符 `?` 与结果符 `!`**：
* `*User?` $\equiv$ `(*User)?`（8 字节空位优化的可空原生指针）
* `*Buffer ! IoError` $\equiv$ `(*Buffer) ! IoError`
* `^Session!` $\equiv$ `(^Session) ! AnyError`（成功返回托管会话句柄，失败返回 `AnyError`）

---

## 3. `AnyError` 的零堆分配物理实现与 `is` 动态向下还原

### 3.1 16 字节小错误寄存器内联优化 (Small-Error Inline Optimization)
在传统语言中，将具体错误擦除为动态错误（如 `Box<dyn Error>`）意味着触发一次堆内存分配。Jenny 的 `AnyError` 采用 **16 字节双寄存器内联结构 `{ meta: u64, payload: u64 }`**：
* **`meta` (64-bit)**：高 32 位存储具体错误类型的全局唯一 `TypeId`（编译期生成），低 32 位存储枚举变体判别子（Discriminant Tag）与内联标志位。
* **`payload` (64-bit)**：
  * **当底层具体错误的负载大小 $\le 8$ 字节时**（覆盖 95% 以上的错误枚举，如空变体、错误码 `i32`、偏移量 `usize`、或单个引用句柄）：**直接将负载按位内联存储在 `payload` 寄存器中，100% 零堆分配（Zero Heap Allocation）**！因此，即使在禁止 `AllocGC` 的硬实时路径中，也可零成本使用 `AnyError`！
  * 仅当错误负载超过 8 字节（如携带长动态消息结构）时，`payload` 才存储指向堆分配错误块的指针。

### 3.2 类型安全的动态向下还原 (`if err is SpecificError`)
由于 `AnyError` 完整保留了原始错误类型的 `TypeId` 与变体 Tag，当高层代码通过 `catch err` 捕获了 `AnyError`（或 `BizError | AnyError`）后，依然可以使用 **`is` 模式匹配运算符** 零成本比对 `TypeId` 并还原出底层具体错误：

```rust
pub enum AuthError {
    InvalidCredentials,
    TokenExpired,
}

// 抽象接口：显式声明业务错误 AuthError，同时用 AnyError 截断未知实现（SQLite/Redis/gRPC）的底层故障
pub trait AuthProvider {
    fn authenticate(self, token: str) -> ^UserSession ! (AuthError | AnyError)
        effects [IO, Async]
}

// 顶层路由控制器：使用 Response! (即 Response ! AnyError) 全截断签名
pub fn handle_login_request(provider: dyn AuthProvider, req: HttpRequest) -> HttpResponse! 
    effects [IO, Async] 
{
    val session = provider.authenticate(req.bearer_token()).await catch err {
        // 1. 精确匹配显式业务错误
        if err is AuthError.InvalidCredentials || err is AuthError.TokenExpired {
            return HttpResponse::unauthorized("登录凭证无效或已过期")
        }
        // 2. 穿透 AnyError 动态向下还原特定底层基础设施错误（如数据库连接池耗尽）！
        if err is SqlError.PoolTimedOut(wait_ms) {
            log::warn("数据库繁忙，等待耗时: " + wait_ms.to_string())
            return HttpResponse::service_unavailable("系统繁忙，请稍后重试")
        }
        // 3. 其他未知底层故障：继续向上抛出 AnyError，自动附带完整错误传播轨迹栈！
        raise err
    }

    return HttpResponse::ok(session.user_id)
}
```

---

## 4. 零成本错误传播轨迹栈 (Zero-Cost Error Trace RingBuffer)

针对 Rust / Go 中“值返回错误丢失调用栈，导致顶层收到 `FileNotFound` 却不知道是哪一层、哪一行代码触发”的工程顽疾，Jenny 内置了**正常路径零开销、错误路径全轨迹**的追踪机制：

1. **正常成功路径（Happy Path）：100% 零开销**
   * 不生成任何栈帧构建指令，不依赖庞大的 C++ `.eh_frame` 异常展开表。
2. **错误触发与 `?` 传播路径（Cold Error Path）：自动追加轨迹帧**
   * 每个 `Fiber` / 线程维护一个极轻量的固定大小 **16 槽位环形轨迹缓冲区（Error Trace RingBuffer，仅占 128 字节栈/TLS 空间，零动态堆分配）**。
   * 当执行 `raise err` 以及沿途每一层 `?` 触发错误提前返回分支时（该分支被标记为 `@cold` 冷路径），编译器自动向环形槽位写入一行紧凑的编译期常量坐标 ID（对应 `(文件名, 行号, 函数名)`）。
   * 调用 `err.trace()` 时，即可直接打印出从最底层 `raise` 源头一路向上穿越 `?` 到达顶层的清晰传播链路！

---

## 5. 错误抛出、传播与就地恢复语法汇总 (`raise`, `?`, `??`, `catch`)

* **`raise <err>`**：显式抛出错误（支持自动装入枚举变体或自动擦除为 `AnyError`）。
* **`expr?`**：线性传播错误或 `null`。
* **`opt ?? fallback`**：可空类型 `T?` 的默认值回退或提前中断（如 `val x = get_opt() ?? return`）。
* **`res catch [err] { ... }`**：结果类型 `T ! E` 或 `T!` 的就地拦截与恢复（支持简写 `val port = parse(s) catch 8080`）。

---

## 6. 静态副作用契约系统 (`effects [...]`)

### 6.1 编译期能力与纯度契约（100% 零运行时开销）
| 副作用标签 | 触发条件 | 静态约束与工程价值 |
| :--- | :--- | :--- |
| **`IO`** | 调用文件、网络、系统时钟、环境变量、标准输入输出或外部有状态 C 函数 | 标识非确定性外部交互；未声明 `IO` 的函数保证不会产生外部 I/O |
| **`Async`** | 函数内部包含 `.await` 挂起点（底层编译为无栈协程状态机） | 仅允许在异步上下文或 `Fiber` 中调用 |
| **`Parallel`** | 内部触发多线程数据并行分发（如 `par_map`）或派生并发任务 | 帮助调用方识别 CPU 密集型线程池调度操作 |
| **`AllocGC`** | 在函数内直接或间接分配 `^T` 托管堆内存 | **天然取代 `@nogc`**：任何未包含 `AllocGC` 的函数，编译器 100% 静态保证其调用链内绝不发生 GC 堆分配！ |
| **`Unsafe`** | 解引用裸 C 指针 `*c_raw<T>`、调用 `.as_raw_ptr()` 传递裸地址或调用外部裸 C 函数 | 将安全审计边界精确收敛到函数签名级 |

> **纯函数（Pure Functions）**：当一个函数未包含任何 `effects`（`effects []`）时，它即是严格的**编译期验证纯函数**。

### 6.2 边界显式与内部自动推导规则
1. **`.jni` 蓝图中的公开函数（`pub fn`）强制显式声明 `effects [...]`**：保障人类阅读 `.jni` 与 AI 跨模块检索时 100% 局部自包含。
2. **`.jn` 内部私有辅助函数与闭包自动推导**：免去内部实现层的手写负担，高阶函数（如 `map`）自动透传闭包实参的副作用集合。
