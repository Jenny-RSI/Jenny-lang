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

### 2.3 专属 `pub error` 一等公民关键字与跨模块 64 位防冲突编码 (`[TypeHash32 | VariantHash32]`)
为彻底消除传统语言中“用普通 `enum` 混充具名错误”引发的编码两难与跨模块值冲突，Jenny 设立专属的 **`error`** 关键字声明具名错误域，与普通业务数据枚举 **`enum`** 正交解耦：

```jenny
// 1. 普通业务数据枚举：保持极简 0, 1, 2 连续序号编码，严禁出现在 T ! E 右侧或 raise 语句中
pub enum ConnState { Idle, Connecting, Established }

// 2. 专属具名错误域：使用 error 关键字声明，源码层支持任意参数载荷（底层自动执行三阶 SPO 优化）
pub error AuthError {
    InvalidCredentials,
    TokenExpired,
}

pub error SqlError {
    Deadlock,
    PoolTimedOut(i64),                              // Tier-1 (<=8B): 直接装入 payload 寄存器
    SyntaxError { line: i32, col: i32 },            // Tier-1 (4+4=8B): 位域打包进单个 payload 寄存器
    MissingColumn { table: str, column: str },      // Tier-2 (16+16=32B): 自动存入 Fiber-Local ErrorPayloadScratch (0 malloc)
}
```

1. **静态防呆与职责隔离**：
   * 编译器强制约束 **`T ! E` 的错误侧、`requires ... else ...` 契约以及 `raise` 语句仅接受 `error` 类型（或 `AnyError`）**；若误将普通 `enum` 当作错误抛出，编译器直接触发静态类型错误。
2. **源码级防名字冲突 + 运行期 64 位复合码防值冲突**：
   * **源码全限定路径隔离**：每个具名错误的规范身份绑定在 `<pkg>::<module>::<ErrorName>` 下，且强制书写错误类型前缀（如 `CursorError.UnexpectedEof` vs `CodecError.UnexpectedEof`）；若同文件导入同名错误类型，可通过模块前缀 `cursor::Error` 或 `import ... as ...` 消歧。
   * **运行期 64 位二元复合错误码（`[TypeHash32 | VariantHash32]`）**：每个 `error` 变体的运行期判别码由高 32 位模块+类型指纹 `fnv1a_32("pkg::mod::ErrorName")` 与低 32 位变体名语义哈希 `fnv1a_32("VariantName")` 组合而成：
     $$\text{ErrorCode}_{64} = \big(\text{TypeHash}_{32}(\texttt{"pkg::mod::ErrorName"}) \ll 32\big) \;\middle|\; \text{VariantHash}_{32}(\texttt{"VariantName"})$$
   * **三大工程优势**：（a）跨模块/跨包的同名变体（如两个 `UnexpectedEof`）高 32 位绝对不同，**100% 零错误值冲突**；（b）错误并集 `T ! (CursorError | CodecError)` 天然在同一 64 位编码空间正交不重叠，**0 字节额外包装开销**；（c）低 32 位采用变体名哈希而非顺序下标，动态库升级在枚举中间插入新变体时**绝不破坏二进制 ABI 兼容性**；（d）`Spindle` 在构建期与动态加载握手期执行全图 `TypeHash32` 唯一性扫描，静态保证 **0 哈希碰撞**。
3. **编译器自动合成 `std::core::error::Error` 与 `std::str::fmt::FmtInto` Trait**：
   * 任何 `pub error` 声明无需手写样板代码或引入类似 Rust `thiserror` 的过程宏，编译器自动为其合成 `std::core::error::Error` 与 `std::str::fmt::FmtInto`（天然满足 `Formattable`，可直接传入 `fmt::format("失败: ", err)`），内建提供 `.error_code() -> i64`、`.type_hash() -> i64`、`.variant_hash() -> i64`、`.variant_name() -> str`、`.format() -> String`、`.format_with_trace(trace: ErrorTrace) -> String`、`.to_any_error() -> AnyError` 以及调用栈查询方法。

---

## 3. 16 字节同构值级多态（Tag-Indexed Value Polymorphism）、三阶载荷优化（SPO）与多态格式化

### 3.1 同构 16 字节双寄存器 ABI：为什么 `E -> AnyError` 是零指令 No-op？
在传统面向对象语言（Java/C# `Exception`）或 Rust（`Box<dyn Error>` / `anyhow::Error`）中，多态错误依赖堆分配对象与虚表胖指针 `{ data_ptr, vtable_ptr }`。Jenny 另辟蹊径，让**所有具名 `pub error` 与顶层擦除容器 `AnyError` 在物理 ABI 上共享完全相同的 16 字节双寄存器值结构 `{ code: u64, payload: i64 }`（常驻 `RAX` + `RDX`）**：

1. **具名错误 `err: SqlError` 是 100% 编译期静态单态值**：在 `T ! SqlError` 层级调用 `err.format()` 或字段解构时，编译器直接静态内联调用 `SqlError_fmt_into`，零查表开销；
2. **`SqlError` $\rightarrow$ `AnyError` 向上转型是零成本 No-op**：当 `T ! SqlError` 通过 `?` 向上传播进入 `T!`（`T ! AnyError`）函数时，因为两者底层都是 `{ code: u64, payload: i64 }`，**无需 `malloc`、无需构造胖指针、无需任何位转换指令**，两个 CPU 寄存器原封不动直接返回；
3. **`AnyError` 的标签索引值级多态（Tag-Indexed Value Polymorphism）**：前 8 字节 `code: u64`（`[TypeHash32 | VariantHash32]`）同时扮演双重角色：
   * **热路径作为 RTTI 判别标签（1 个时钟周期）**：执行 `if any_err is SqlError` 时仅需单条寄存器移位比较 `(any_err.code >> 32) == TYPE_HASH_SQL_ERROR`；
   * **冷路径作为只读虚表索引（按需延迟触发）**：仅当程序真正调用 `any_err.format()` 打印未知错误时，才以 `any_err.code` 检索 `.rodata` 只读数据段的全局静态错误描述符表 `__jn_error_registry`，调用对应的解包格式化函数。

### 3.2 三阶小载荷优化（Small-Payload Optimization, SPO）：源码层载荷绝不限于 8 字节！
虽然 `Error` / `AnyError` 的物理返回值固定为 16 字节（其中 `payload: i64` 占 8 字节），但**开发者在声明 `pub error` 变体时绝不受 8 字节限制**！编译器对变体参数自动执行类似 `String` SSO 的**三阶透明载荷优化（Three-Tier SPO）**：

| 载荷层级 | 变体参数总字节数 | 典型示例 | 物理存储与寻址机制 (`payload: i64`) | 堆分配开销 |
| :--- | :---: | :--- | :--- | :---: |
| **Tier 1：寄存器位域直装**<br>*(Inline Register Packing)* | **`0 ~ 8 Bytes`**<br>*(占 95%+ 错误变体)* | `UnexpectedEof`<br>`PoolTimedOut(i64)`<br>`SyntaxError { line: i32, col: i32 }`<br>`InvalidByte(u32, u8, u8)` | 编译器自动将单参或多参按位域打包进 64 位 `payload: i64` 寄存器（如 `(line << 32) \| col`），解构与格式化时直接寄存器移位掩码提取。 | **0 堆分配**<br>*(100% 纯寄存器)* |
| **Tier 2：纤程局部暂存槽**<br>*(Fiber-Local Scratch Ring)* | **`9 ~ 64 Bytes`**<br>*(含 `String` / `str` / 多参数)* | `MissingColumn { table: str, column: str }` (32B)<br>`OutOfRange { idx: i64, min: i64, max: i64 }` (24B)<br>`KeyError { key: String, line: i64 }` (32B) | 每个 `Fiber` 控制块除 128B `ErrorTrace` 外，内嵌固定 **256B `ErrorPayloadScratch` 环形槽（4 槽 $\times$ 64B）**；`raise` 时将参数结构体 `memcpy` 至当前 Fiber 暂存槽，`payload: i64` 存放槽位指针。 | **0 `malloc` / 0 GC**<br>*(预置 Fiber 栈槽)* |
| **Tier 3：托管堆溢出兜底**<br>*(Managed Overflow Box)* | **`> 64 Bytes`**<br>*(极罕见超重型错误上下文)* | 携带大型诊断快照结构体 | 编译器自动在 Immix 托管堆分配 `^PayloadStruct`，`payload: i64` 存放 8 字节托管句柄。 | 冷路径按需托管分配 |

### 3.3 多态流式格式化 (`FmtInto` / `.format()` / `.format_with_trace()`) 与按需自定义覆写
1. **自动合成 `FmtInto` 与 `.rodata` 静态分发表**：
   * 编译器为每个 `pub error` 变体自动生成解包流式写出函数，并注册至只读段 `__jn_error_registry`：
     * `SqlError.Deadlock.format()` $\rightarrow$ `"SqlError.Deadlock"`（17B $\le 22\text{B}$，走 24B `String` SSO 栈内联，**0 堆分配**）；
     * `SqlError.SyntaxError { line: 10, col: 4 }.format()` $\rightarrow$ `"SqlError.SyntaxError(line: 10, col: 4)"`；
     * 即使被擦除为 `any_err: AnyError`，调用 `any_err.format()` 或直接传入 `std::str::fmt::format("失败原因: ", any_err)`，也会通过 `any_err.code` 查表自动还原出全部参数与嵌套子错误！
   * 调用 `err.format_with_trace(trace: ErrorTrace) -> String` 则在同一 `FmtBuffer` 中将**带参错误消息**与 **16 槽位因果 Continuation 调用栈**一并格式化输出。
2. **零宏噪音的自定义文案覆写**：
   * 若领域错误需要面向最终用户的定制文案（或根据 `Culture` 输出多语言提示），只需在 `impl SqlError` 中显式编写 `pub fn fmt_into(self, mut fb: FmtBuffer, culture: Culture) -> i64 ! FmtError`，编译器便会自动采用自定义实现替换默认合成，同时让 `any_err.format()` 多态分派自动指向该自定义函数！
3. **支持 `--debug-info=none` 零符号反逆向商业发布模式（详见[模块十 §4.2](./10_fast_compilation_and_anti_bloat.md)）**：
   * 当用户开启 `--debug-info=none`（及可选 `--symbol-salt=<key>`）以防止商业二进制被 IDA Pro / Ghidra 逆向分析时，编译器将 **100% 剔除 `.rodata` 中的所有模块名、函数名与错误变体明文字符串**；由于 `if err is SpecificError` 在底层完全基于 64 位数值码比对，运行期错误处理逻辑 **零行为退化**，而 `.format_with_trace()` 则自动切换为输出脱敏十六进制码 `E#<TypeHash>:<VariantHash>(...) @ [...]`，由服务端通过私有 `<app>.jnsym` 映射表离线还原（`spindle symbolicate`）。

### 3.4 类型安全的动态向下还原 (`if err is SpecificError`)
由于 `AnyError.code` 完整保留了原始 `error` 类型的 64 位 `[TypeHash32 | VariantHash32]`，当高层代码通过 `catch err` 捕获了 `AnyError`（或 `BizError | AnyError`）后，依然可以使用 **`is` 模式匹配运算符**（或 `.matches_code(...)`）执行 $O(1)$ 寄存器比对并还原出底层具名错误（无论是 Tier-1 寄存器载荷还是 Tier-2 暂存槽载荷，均由编译器自动解包绑定变量）：

```jenny
pub error AuthError {
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
        // 2. 穿透 AnyError 动态向下还原特定底层基础设施错误（自动解包参数 wait_ms）！
        if err is SqlError.PoolTimedOut(wait_ms) {
            // err 与 wait_ms 均直接支持 std::str::fmt::format 流式格式化
            log::warn(fmt::format("数据库繁忙，等待耗时(ms): ", wait_ms, ", 原始错误: ", err))
            return HttpResponse::service_unavailable("系统繁忙，请稍后重试")
        }
        // 3. 其他未知底层故障：继续向上抛出 AnyError，自动附带完整错误传播轨迹栈！
        raise err
    }

    return HttpResponse::ok(session.user_id)
}
```

---

## 4. 零成本错误传播轨迹栈 (Zero-Cost Error Trace RingBuffer & Callstack API)

针对 Rust / Go 中“值返回错误丢失调用栈，导致顶层收到 `IndexOutOfBounds` 却不知道是哪一层、哪一行代码触发”的工程顽疾，Jenny 通过**“错误值寄存器传递 + 线程/Fiber 局部轨迹环（`std::core::error::ErrorTrace`）物理分离、语义绑定”**，实现了正常路径零开销、具名错误与 `AnyError` 均可直接回溯完整 Callstack 的机制：

1. **正常成功路径（Happy Path）：100% 零开销**
   * 不生成任何栈帧构建指令，不依赖庞大的 C++ `.eh_frame` 异常展开表。
2. **错误触发与 `?` / `.await?` 传播路径（Cold Error Path）：逻辑因果栈织入与跨协程嫁接**
   * **Fiber-Local 隔离（杜绝协程切换串台）**：每个 `Fiber` 控制块内嵌一个极轻量的固定大小 **16 槽位环形轨迹缓冲区（`ErrorTrace` RingBuffer，仅占 `16 × 8 = 128` 字节，零动态堆分配）**，随协程跨越 `.await` 挂起与恢复移动，绝不因 OS 线程切换而与其他协程混杂。
   * **64 位（8 字节）`TraceFrame` 范式化位域编码（`[fn_sym_id:32 | frame_kind:2 | await_state:10 | line_no:20]`）**：
     * **为什么不在运行期 `TraceFrame` 中单独划分 `16-bit module_id + 16-bit fn_id`？**
       1. **突破单模块 64K 泛型/`@spin` 模板实例上限**：在重度使用泛型单态化与 `@spin` 变参展开（如 `format_with__spin_<hash>` 或算子库）的模块中，单模块派生的函数实例数极易突破 16-bit（`65,536`）；
       2. **消除位域第三范式（3NF）冗余**：在编译期，“一个函数符号归属于哪个模块（`fn_sym_id -> module_id`）”是 100% 静态确定的多对一映射，在运行期每个栈帧里重复存储 `module_id` 纯属位宽浪费。因此，Jenny 将 `module_id`、函数基础名 `base_name` 以及泛型/`@spin` 实例化类型签名 `mono_args` 全部收敛至 `.rodata` 只读符号表 `__jn_fn_symtab[fn_sym_id]` 中，把高 32 位完整交给 `fn_sym_id`！
     * **64 位精确位域划分**：
       * `bits [63..32]` (`32 bits`)：**`fn_sym_id`**（全局函数与泛型/`@spin` 单态化实例符号 ID，支持多达 **$2^{32} = 4,294,967,296$（42.9 亿）** 个函数实例，彻底根除单模块 64K 溢出隐患；Debug 字典传递模式下同一泛型共享单一 `fn_sym_id`，Release 单态化模式下每个实例可通过 `__jn_fn_symtab` 精确打印 `<T1, T2>` 类型实参）；
       * `bits [31..30]` (`2 bits`)：**`frame_kind`**（`0 = SYNC_RAISE` 最初根因点、`1 = SYNC_PROP` 同步 `?` 传播点、`2 = AWAIT_PROP` 异步 `.await?` 恢复传播点、`3 = SPAWN_JOIN` 跨协程 `fiber::all`/`join` 或 `CompletionCell` 事件汇聚嫁接点）；
       * `bits [29..20]` (`10 bits`)：**`await_state`**（函数内的 Continuation 状态机编号 **`0..1,023`**，相比 6-bit 提升 $16\times$，轻松容纳 `@spin for` 展开的密集 `.await` 挂起点）；
       * `bits [19..0]` (`20 bits`)：**`line_no`**（单文件源码行号 **`1..1,048,575`**，支持单文件百万行代码）。
   * **三类因果帧自动织入**：
     1. **第 0 帧（`SYNC_RAISE` 根因帧）**：当 `.jni` 前置契约 `requires ... else Err` 校验失败、`.jn` 执行 `raise Err`、或异步事件源调用 `CompletionCell.complete_err` 时，重置轨迹环并写入第 0 帧；
     2. **第 `1..N` 帧（`SYNC_PROP` / `AWAIT_PROP` 传播帧）**：同步 `expr?` 或 Continuation 状态机在 `.await?` 恢复分支收到子任务 `POLL_ERR` 时，自动沿着恢复链向上追加 `(fn_sym_id, frame_kind, await_state, line_no)`，彻底解决物理栈被状态机拍平导致的异步调用栈丢失问题；
     3. **跨协程嫁接帧（`SPAWN_JOIN`）**：当父协程在 `fiber::all` / `join_all` / `handle.join().await?` 处捕获到子协程失败时，自动调用 `ErrorTrace.stitch_from_child` 将失败子协程的根因帧复制到父协程 `ErrorTrace` 头部并压入 `SPAWN_JOIN` 边界帧。
3. **在具名 `error` 与 `AnyError` 上统一查询 Callstack**：
   * 无论 `catch err` 捕获的是底层具名错误（如 `VecError`、`TaskError`）还是顶层 `AnyError`，均可直接调用 `Error` Trait 方法：
     * `err.stack_depth() -> i64`：获取当前错误经过的调用栈帧数（`0..=16`）；
     * `err.root_cause_frame() -> TraceFrame ! TraceError`：一步获取最底层最初报错的根因函数符号与行号（`frame[0]`）；
     * `err.caller_frame_at(idx: i64) -> TraceFrame ! TraceError`：按层级遍历整条同步/异步因果传播链（通过 `__jn_fn_symtab[frame.fn_sym_id]` 还原所属模块名、函数名与泛型模板实参）！

---

## 5. 错误抛出、传播与就地恢复语法汇总 (`raise`, `?`, `??`, `catch`)

* **`raise <err>`**：显式抛出错误（支持自动装入枚举变体或自动擦除为 `AnyError`）。
* **`expr?`**：线性传播错误或 `null`。
* **`opt ?? fallback`**：可空类型 `T?` 的默认值回退或提前中断（如 `val x = get_opt() ?? return`）。
* **`res catch [err] { ... }`**：结果类型 `T ! E` 或 `T!` 的就地拦截与恢复（支持简写 `val port = parse(s) catch 8080`）。

---

## 6. 静态副作用契约系统 (`effects [...]`) 与受控阻断机制 (`mask [...]`)

### 6.1 编译期能力与纯度契约（100% 零运行时开销）
| 副作用标签 | 触发条件 | 静态约束与工程价值 |
| :--- | :--- | :--- |
| **`Mutate`** | 原地修改 `mut self` 或 `mut` 参数 | 标识单写者独占状态修改（非多线程共享安全，需独占借用或处于 `StrandSerial` 串行上下文中） |
| **`Sync`** | 调用互斥锁（`OsMutex`/`AsyncMutex`）、信号量（`OsSemaphore`）、条件变量、`Futex` 或硬件原子（`Atomic*`）在共享 `self` 上执行同步操作 | 标识内部并发同步操作（允许多线程持共享 `self` 并发调用，并触发编译期/运行期死锁与锁序审计；可通过 `mask [Sync]` 在封装边界阻断向上传染） |
| **`IO`** | 调用文件、网络、系统时钟、环境变量、标准输入输出或外部有状态 C 函数 | 标识非确定性外部交互；未声明 `IO` 的函数保证不会产生外部 I/O |
| **`Async`** | 函数内部包含 `.await` 挂起点（底层编译为无栈协程状态机） | 仅允许在异步上下文或 `Fiber` 中调用（若同时使用异步锁则组合为 `effects [Async, Sync]`） |
| **`Parallel`** | 内部触发多线程数据并行分发（如 `par_map`）或派生并发任务 | 帮助调用方识别 CPU 密集型线程池调度操作 |
| **`AllocNative`** | 在函数内分配 `*T` 原生独占堆或 `Arena` 内存 | 标识原生线性内存分配（若为函数内瞬态 Scratch 分配且在返回前 100% 释放，可通过 `mask [AllocNative]` 阻断传染） |
| **`AllocGC`** | 在函数内直接或间接分配 `^T` 托管堆内存 | **天然取代 `@nogc`**：任何未包含 `AllocGC` 的函数，编译器 100% 静态保证其调用链内绝不发生 GC 堆分配！ |
| **`Unsafe`** | 解引用裸 C 指针 `*c_raw<T>`、调用 `.as_raw_ptr()` 传递裸地址或调用外部裸 C 函数 | 将安全审计边界精确收敛到函数签名级（在底层安全容器实现中可通过 `mask [Unsafe]` 阻断向业务层传染） |

> **纯函数（Pure Functions）**：当一个函数未包含任何 `effects`（`effects []`）时，它即是严格的**编译期验证观测纯函数（Observationally Pure Function）**。

### 6.2 边界显式与内部自动推导规则
1. **`.jni` 蓝图中的公开函数（`pub fn`）强制显式声明向外传播的 `effects [...]`**：保障人类阅读 `.jni` 与 AI 跨模块检索时 100% 局部自包含。
2. **`.jn` 内部私有辅助函数与闭包自动推导**：免去内部实现层的手写负担，高阶函数（如 `map`）自动透传闭包实参的副作用集合。

### 6.3 受控效应阻断与代码审计信号机制 (`mask [...]` — Controlled Effect Containment & Audit Signals)

#### 1. 为什么不能采用“死板硬传染（Rigid Virality）”？
如果所有 `effects`（尤其是 `Sync`、`AllocNative`、`Unsafe`）都强制无条件向上传染，会引发严重的 **“抽象接口污染（Trait Coloring Problem）”**：
* 例如，抽象接口 `pub trait KvStore { pub fn get(self, key: str) -> String? }` 的某个具体实现 `ConcurrentLruStore` 在 `.jn` 内部使用 `OsMutex` 加锁更新了 LRU 访问计数并在返回前释放了锁。
* 从调用方视角看，锁已在函数返回前 100% 释放，该操作是线程安全且自包含的；若强迫 `KvStore::get` 加上 `effects [Sync]`，就会将 `.jn` 的内部实现细节泄露到顶层抽象 `trait` 中。

#### 2. `mask [<Effect>, ...]` 语法：显式阻断传染 + 注册代码审计锚点
Jenny 允许在 `.jn` 实现文件的**函数头**或**局部代码块**上使用 **`mask [...]`** 关键字，在确保边界安全的前提下显式阻断指定效应向上传播：

```jenny
// 函数级阻断：内部使用 OsMutex (effects [Sync])，但在返回前 100% 释放锁，对外实现纯净无标签的 KvStore trait
impl KvStore for ConcurrentLruStore {
    pub fn get(self, key: str) -> String? ! StoreError
        mask [Sync]
    {
        var guard = self.shard_mtx.lock()!
        return guard.lookup_and_touch(key)
    }
}

// 块级阻断：精准包裹临界区或瞬态内存分配区
pub fn format_metric(id: i64) -> String {
    mask [AllocNative, Mutate] {
        var fb = FmtBuffer.in_arena(128)!
        fb.put_i64(id)!
        val s = fb.to_sso_string()
        fb.drop_fmt()
        return s
    }
}
```

#### 3. 编译器在 `mask [...]` 边界执行的静态准入验证與 `spindle audit` 审计信号
`mask [...]` 绝非静默关闭检查，而是兼具**编译期边界封闭性验证**与**后期安全审计信标**双重职责：

| 阻断标记 | 编译器强制执行的静态准入红线（违例即编译失败） | `spindle audit` 后期代码审计分级信号 |
| :--- | :--- | :--- |
| **`mask [Sync]`** | **`E0709_MASKED_LOCK_ESCAPE`（锁守卫零逃逸铁律）**：在 `mask [Sync]` 作用域内获取的任何锁守卫（`OsMutexGuard`、`AsyncMutexGuard`）或信号量许可（`SemaphorePermit`）**严禁通过 `return`、结构体字段或可变参数逃逸出该作用域**，必须在退出前 100% 释放！ | • **`SAFE_LEAF_CRITICAL_SECTION`**（绿灯）：持锁期间仅访问本模块字段，无外部调用；<br>• **`W0710_EXTERNAL_CALL_UNDER_MASKED_SYNC`**（黄灯重点审计）：持锁期间调用了外部函数、`dyn Trait` 或闭包，标记由架构师/设计模型重点审计是否存在嵌套死锁风险。 |
| **`mask [AllocNative]`** | **原生堆分配净增量为 0**：作用域内分配的所有 `*T` 或 Scratch `Arena` 帧必须在退出前释放（或冻结为值类型），严禁泄漏未受管原生指针。 | 审计瞬态缓冲区容量上界与异常分支释放完整性。 |
| **`mask [Unsafe]`** | **`E0711_UNPROVEN_BOUNDS_CONTAINMENT`（编译期 `QF_LIA` 边界完备性证明）**：当 `mask [Unsafe]` 作用域内调用 `get_unchecked` / `set_unchecked` 或底层缓冲区寻址时，编译器自动调用 `Jenny-BoundsProver` 校验前置 `requires` / `guard` 是否 100% 覆盖下界（`>= 0`）、上界（`< len`）与无加法溢出；若存在未证路径，直接报错并输出**具体越界数值反例（Counterexample）**。 | • **`PROVEN_SAFE_BY_VCG`**（绿灯）：经 `QF_LIA` 验证条件生成器 100% 形式化证明边界完备；<br>• **`W0712_UNDECIDABLE_INDEX_ARITHMETIC`**（黄灯重点审计）：含非线性/外部 C 算术，收敛至 `effect_mask_audit_signals` 供重点审计。 |

