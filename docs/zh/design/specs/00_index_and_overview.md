# 《Spinning Jenny (Jenny) 编程语言规范总纲 v1.0》

> *“1764, the Spinning Jenny wove the Industrial Revolution. Today, Jenny weaves Human Intent and AI Intelligence into Native & WebAssembly code.”*  
> （1764年，珍妮纺纱机织就了工业革命的序幕；今天，Jenny 将人类意图与 AI 智慧交织为原生与 WebAssembly 代码。）

---

## 🏛️ 最高设计宪章与工程演进路线 (Manifesto & Evolutionary Roadmap)

* **[《Jenny 语言设计宪章与 AI 原生架构总纲》](../哲学与总纲.md)**
  * 确立“人类读原生 Markdown 蓝图（`.jni`）、AI 写形式化契约与实现（`.jn`）、编译器执行零信任契约验收”的第一性原理、六大架构法则与三步渐进式纺纱工作流。
* **[《Jenny 渐进式实证演进方案与最小验证集 (v0.1 -> v1.0)》](../演进路线与最小验证集.md)**
  * 确立从 `Jenny-Nano (v0.1)` 最小契约核出发的五阶同心圆演进路线、各阶段量化准出红线（Gate Criteria）以及首期 10 个黄金种子验证任务（`Jenny-Seed-10`）。
* **[《对象生命期与内存管理：AI 跨语言开发痛点、实证研究与 Stage 2 对比基线》](../对象生命期管理_AI跨语言痛点与实证基线.md)**
  * 深度剖析 C/C++（隐性悬垂与提前返回泄漏）、Rust（借用检查器死锁与生命周期级联雪崩）、Go（可变混叠与隐式逃逸）在 AI 编程中的痛点、顶会实证数据（ICSE 2025 `RustAssistant`、`CRust-Bench`、`CyberSecEval`、`MultiPL-E`）及 `Mem-Bench-5` 对照预案。

---

## 📚 规范分卷索引 (Specification Volumes `v2.0-spec`)

本目录收录了经过逐模块深度推演与拍板定稿的 **Jenny 语言核心规范（`v2.0-spec`，共 13 卷）**：

1. **[模块一：AI 原生双轨内存与参数意图模型 (v2.0)](./01_memory_and_ownership.md)**
   * **彻底废除 `&T` / `&mut T` / `&*T` 套娃引用类型**！解耦为“三态存储拓扑（`T` 值/视图、`*T` 原生独占堆、`^T` 托管共享堆）”与“三态参数传递意图（**默认只读借用**、`mut` 原地修改、`own` 显式移交所有权）”；编译器自动推导含切片的栈绑定视图（免手写 `view struct` 与 `'a`）、三轨闭包生命期（`fn` / `*fn[own]` / `^fn`）、`iter fn (yield)`、可插拔 Immix GC / ARC、`*in(arena)` 与 `@scoped` 线性资源。
2. **[模块二：基础类型系统与代数数据类型 (ADT)](./02_types_and_adt.md)**
   * 标量类型与 `.as<T>()` 显式转换、元组与 `std::core::tuple`、四级连续序列正交区分（`[N]T` 编译期定长内联数组、`[]T` 16B 借用切片视图、`Array<T>` 16B 运行期定长堆数组、`Vec<T>` 24B 动态扩容容器）、**三级序列下标访问与编译期 `QF_LIA` 形式化边界证明器（`Jenny-BoundsProver`：Octagon 抽象解释 + 内嵌 `QF_LIA` VCG，已证路径 100% 零成本自动消除运行期边界检查，未证 `mask [Unsafe]` 拦截报错 `E0711_UNPROVEN_BOUNDS_CONTAINMENT` 并自动生成具体越界数值反例）**、24 字节 SSO 不可变 `String` 与 `str`、`struct` 字段默认值、三态接收者适配（`self` / `mut self` / `own self`）、带负载和类型 `enum`（与 `pub error` 职责解耦）、`T?` 三层可空架构（`std::core::option` 白盒契约 + 8 字节空位优化）、`match` 穷尽匹配、`is` 模式条件测试、`guard ... else` 线性守卫、以及 `std::core` 七大语言原语白盒底座与 16 字节免装箱受控动态类型 `std::core::any::Any`。
3. **[模块三：词法、正交语法与控制流](./03_syntax_and_control_flow.md)**
   * `val` / `var`、无分号续行规则、废除 `? :` 与 `++`、具名函数强制显式 `return`、`if/else` 与 `match` 值表达式、`for .. in` 与 `while` 唯一循环原语、100% 收口于 `drop(own self)` 的 RAII（不设 `defer`）、`fn(x) => ...` 闭包与 `*fn[own ptr]` 捕获、`x |> f(a, _)` 管道操作符。
4. **[模块四：Trait 契约、泛型系统与容器适配](./04_traits_and_generics.md)**
   * `trait` 关联类型与直观的 `T.Item` 点号投影、`delegate` 自动组合委托、包级孤儿规则、`@operator("+")` 方法注解与高内聚领域接口（`Numeric`/`Comparable`）、动态多态胖指针（`dyn Trait` / `*dyn Trait` / `^dyn Trait`）、Debug 默认字典传递 + Release 单态化 + `^T` 同构指针擦除、内建三态合成特征（`TrivialCopy`/`UniqueMove`/`GcTrace`）。
5. **[模块五：三层渐进式错误截断与静态副作用契约系统 (v2.0)](./05_errors_and_effects.md)**
   * 一等公民 `pub error` 具名错误声明关键字与 64 位复合防冲突编码 `[TypeHash32 | VariantHash32]`；三层错误截断体系：底层精确错误 `T ! E`、抽象接口/领域层混合截断 `T ! (BizError | AnyError)`、顶层全截断简写 `T!`（`T ! AnyError`）；**16 字节同构值级多态（Tag-Indexed Value Polymorphism，`E -> AnyError` 零指令 No-op）**、**三阶小载荷优化（Three-Tier SPO：$\le 8\text{B}$ 寄存器位域直装、$9 \sim 64\text{B}$ 预置 256B `ErrorPayloadScratch` 纤程局部暂存槽零 `malloc`、$> 64\text{B}$ 托管块溢出，源码层载荷不限于 8 字节）**、编译器自动合成 `FmtInto` / `.format()` / `.format_with_trace()`（查 `.rodata` `__jn_error_registry` 静态分发表）、`if err is SpecificError` 动态向下还原、**Fiber-Local 零分配因果调用栈环（16 槽位 `ErrorTrace` RingBuffer，8 字节位域编码 `[fn_sym_id:32 | frame_kind:2 | await_state:10 | line_no:20]`）**、**`effects [IO, Net, Fs, Env, Process, Sync, Async, Parallel, AllocNative, AllocGC, Unsafe]` 静态能力契约**，以及**受控效应阻断与代码审计信号机制（`mask [Sync]` / `mask [AllocNative]` / `mask [Unsafe]`，阻断效应向 `trait` 抽象接口恶性传染并作为 `spindle audit` 一等安全审计信标，`E0709_MASKED_LOCK_ESCAPE` + `W0710_EXTERNAL_CALL_UNDER_MASKED_SYNC` + `E0711_UNPROVEN_BOUNDS_CONTAINMENT`）**。
6. **[模块六：`@spin` 编译期白盒元编程](./06_spin_metaprogramming.md)**
   * `@spin fn` + 参数化 `@apply`、块级声明式 `@spin dsl { ... }`、`@spin expr`、`@spin if` 特征裁剪、纯增量追加原则（严禁篡改原结构体已声明字段）、**五级 `@spin` AOP 切面织入与代码埋点架构（`L1` 全局/构建级 `Tapestry.toml` 含 `AllocNative` 内存分配审计、`L2` 包/模块树级 `pkg.jni`、`L3` 源码文件级、`L4` 类型/函数级与 `@no_apply` 豁免、`L5` 语句/块级原地展开及五级洋葱嵌套次序）**、**按需零对象头类型反射与契约感知反射（`@target ty_meta: SpinType` + `ty_meta.invariants`）**、`.spun/<module>.spun.jn` 白盒落盘与 `.jenny-cache/spin/` 去重、`jenny distill` 共性代码反向提炼、100% 确定性 Meta-VM 沙箱。
7. **[模块七：并发模型（免 `Pin` 延续体状态机、`std::thread` 底层并发原语、四道防死锁体系与 `std::fiber` 结构化并发）](./07_concurrency_and_fiber.md)**
   * `effects [Async]` 与 `.await` 的**免 `Pin` 可重定位 Continuation 状态机降级**（得益于 Jenny v2.0 禁止局部栈变量取址 `&x`，挂起帧 `<Fn>_Frame` 100% 位置无关，彻底消灭 `Pin<&mut Self>` / `Unpin` 与按状态确定性 `ACTION_CANCEL` 析构）；`std::fiber::task` 并发铁三角：**`SyncContext`**（`ThreadPinned` / `StrandSerial` / `WorkStealing` / `DeterministicSim` 四大调度上下文与防死锁 `drain_ready` 事件泵）、**`CompletionCell<T ! E>`**（`Pending -> ResolvedOk | ResolvedErr | Abandoned` 一次性主动异步事件完成槽与 RAII `abandon` 防悬挂保护）、**`FiberScope` & `CancelToken`**（结构化保育院不变量、零拷贝共享父栈切片、`join_all`/`race_first`/`settle_all`）；**Layer 3 底层并发基石 `std::thread::{atomic, os_thread, sync, os_sync}`**（硬件原子操作、`CachePadded<T>`、核亲和度 `OsThread`、`FutexWord`/`OsMutex`/`OsRwLock`/`OsCondvar`、`eventfd`/`CreateEventW` 跨层 `OsEvent`、`OsSemaphore` 与跨进程防崩溃死锁 `RobustNamedMutex`）；以及**四道防死锁与死锁检测体系（`E0705` `@non_suspendable` 跨 `.await` 持锁拦截、`E0706` TLS 借用跨 `.await` 拦截、`E0707` 同锁重入拦截、`sync::lock_pair` 地址全序加锁与 `LockLevel` 层级契约、慢路径 $<30\text{ns}$ $O(D)$ 等待图环路检测 `SyncError.DeadlockCycleDetected` 及 `mask [Sync]` 受控效应阻断）**。
8. **[模块八：零胶水 C 互操作、WebAssembly 双后端与工程生态](./08_c_interop_wasm_and_ecosystem.md)**
   * 内置 `libclang` 零胶水 `import c`、强制 `.as_raw_ptr()` 显式跨越 C 指针边界、Wasm Linear Memory (`*T`) + WasmGC (`^T`) + `table<anyref>` 跨堆根表映射、`@export(wasm)` 自动生成 WIT 与 `.d.ts`、`pub import` 门面重导出、三级可见性（`.jn` 专属模块内私有 `fn` / `pkg` / `pub`）、`jenny skeleton` 与 `--ai-json` 确定性修复补丁。
9. **[模块九：文学化架构蓝图（`.jni`）双区结构与一等公民契约系统](./09_literate_blueprint_and_contracts.md)**
   * `.jni` 顶层原生 Markdown 自由文档 + **双区围栏块架构（第一章 ```` ```jenny_decl ```` 纯声明与契约区 + 第二章 ```` ```jenny_test ```` 验收与测试区）**、`<expr> => <expected>` / `<expr> => err(...)` 单行极简断言与 `test "..." { ... }` 多行测试块、`.jni` 与 `.jn` 双向同构绑定与 `.jn` 专属私有 `fn`、`requires ... else` 前置契约自动错误织入、`ensures (result / old)` 后置保证、`invariant` 结构不变量，以及**零信任盲测隔离（Code Agent 默认物理剥离 `jenny_test`）、`E0905` 反硬编码作弊审计与 `Heal@3` 耗尽后的架构设计模型根因审计兜底协议（`Architect Root-Cause Audit`）**。
10. **[模块十：极速增量构建与零膨胀中间产物架构](./10_fast_compilation_and_anti_bloat.md)**
    * 深度复盘 Rust `target/` 膨胀五大病灶；确立 `.jni` 蓝图编译防火墙（实现改动下游零重编）、泛型“Debug 默认字典传递 vs Release 单态化”双模引擎、内置字节码 Meta-VM 免动态库膨胀、**双轨调试信息与四级编译开关（`Level 0: none` 100% 剔除运行期 `.rodata` 与 DWARF 明文符号防逆向 + `--symbol-salt` 盐值混淆 + 离线 `<app>.jnsym` `spindle symbolicate` 还原、`Level 1: line-tables` 默认轻量行号表、`Level 2: split .dwo` 链接器零拷贝与 `.jni`/`.jn`/`.spun.jn` 三源映射、`Level 3: full`）**、以及默认硬上限 2GB 的 LRU 内容寻址构建缓存池（`.jenny-cache/`）。
11. **[模块十一：语言-模型联合演进与量化实证工程 (PL-LLM Co-Design)](./11_llm_codesign_and_empirical_training.md)**
    * 确立五大硬性量化标尺（TCR Token 压缩比、ECC 有效上下文架构容量、盲测 $\text{Pass}@1 / \text{Heal}@k$ 编译自愈率、SHR 语义幻觉率、HCS 人类意图审计效率）、**盲测防走捷径 + `Heal@3 -> Architect Audit` 双模型升级兜底机制（`RC1_BLUEPRINT_UNDERSPECIFIED` / `RC2_TEST_CASE_DEFECT` / `RC3_ALGORITHMIC_BOTTLENECK`）**、基于基座模型困惑度（Perplexity）与报错码热力图的语法磨平机制、以及编译器内嵌可验证奖励强化学习（Compiler-in-the-Loop RLVR / GRPO，含 `-P_overfit` 反作弊惩罚）双向协同训练闭环。
12. **[模块十二：包管理、模块解析与供应链效应防火墙 (`Spindle` & `Tapestry.toml`)](./12_package_management_and_module_system.md)**
    * 确立双文件（`<mod>.jni` + `<mod>.jn`）模块映射法则、禁止通配符导入（`E0501`）与环状依赖拦截（`E0502`）、**`pub import` 门面重导出与零成本按需符号穿透（Zero-Cost Barrel Forwarding）**、`Tapestry.toml` 包级 `allow_effects` 供应链权限沙箱（`E0503`）、`Tapestry.lock` 双哈希（仅针对 `jenny_decl` 的 `jni_abi_hash` + `jn_impl_hash`）与最小版本选择（MVS）、`spindle semver-check` 机械化契约语义版本校验（`E0504`）、`spindle pack` / `decompile` 统一 AST 归档（`lib/pkg.jnast`）与无损反编译，以及 `spindle context` AI 契约摘要导出协议。
13. **[模块十三：语义契约驱动的原生动态链接、优雅降级与零泄漏热替换架构 (`Jenny-Dylib` 设计草案)](./13_dynamic_linking_and_semantic_hotswap.md)**
    * 系统拆解传统动态链接 6 大 DLL Hell 死穴与业界 5 大流派（含 .NET `ALC` 卸载泄漏根因）；确立“具象机器码进 `.dll` + `@spin` 薄模板进 `.jn_spin` 元数据 + 共享 `jenny_rt.dll` 底座”双层架构、运行期三级语义契约握手（$O(1)$ 整表哈希快路径 + 按需符号子图 `layout_hash` 与霍尔契约子类型校验 + 自动回退/`catch` 优雅降级与 `E0511`~`E0514` 结构化升级诊断），以及依托“视图不逃逸铁律”与导入函数槽表（`__jn_dylib_slots`）的五步原子热替换与 $O(1)$ 零泄漏立即卸载。

---

## ⚡ Jenny v2.0 全特性融汇实战代码 (`audio_weaver.jn`)

下面这段代码完整呈现了我们在 10 大模块中敲定的 AI 原生规范（注意：**全篇零 `&` 借用符号，默认传参即只读借用，修改标 `mut`，移交所有权标 `own`**）：

```jenny
module audio_weaver

import c "samplerate.h" as libsr
import std::fiber::{self, FiberScope, Fiber}
import std::parallel::{par_map, collect}

// 1. @spin 编译期白盒元编程（纯增量追加，自动落盘至 .spun/audio_weaver.spun.jn）
@spin fn derive_memory_audit(target: MetaType) -> CodeFragment {
    var native_count: usize = 0
    var gc_count: usize = 0
    for f in target.fields() {
        if f.type_info().is_native_ptr() { native_count += 1 }
        if f.type_info().is_gc_handle()  { gc_count += 1 }
    }
    return quote {
        impl $(target.ident()) {
            // self 默认即为只读借用，无需写 &self！
            pub fn memory_profile(self) -> String {
                return "Native(*): " + $(native_count).to_string() + 
                       ", Managed(^): " + $(gc_count).to_string()
            }
        }
    }
}

// 2. 一等具名错误定义（使用专属 error 关键字，自动生成 64 位防碰撞码并绑定 ErrorTrace 调用栈）
pub error AudioError {
    Io(IoError),
    EmptyFrame,
    ResampleFailed(i32),
}

// 3. 原生堆数据结构（*PcmFrame：唯一所有权，与 C 共享线性内存）
@repr(C)
pub struct PcmFrame {
    pub samples: *mut c_raw<f32>,
    pub length: usize,
    pub sample_rate: u32 = 48000,

    // own self 表示消费并销毁自身所有权
    fn drop(own self) {
        if self.samples != null {
            libsr.free_buffer(self.samples.as_mut_void_ptr())
        }
    }
}

// 4. 零拷贝切片视图（编译器检测到含 []f32 切片，自动推导为栈绑定视图，免手写 view struct 与 'a！）
pub struct FrameWindow {
    pub left_channel: []f32,
    pub right_channel: []f32,
}

// 5. GC 托管业务图节点（^TrackNode：支持多所有者与图关联，跨堆持有 *PcmFrame）
@apply(derive_memory_audit)
pub struct TrackNode {
    pub title: String,             // 24 字节 SSO 不可变字符串
    pub raw_frame: *PcmFrame,      // 唯一所有权原生音频帧
    pub next: ^TrackNode?,         // 前缀 ^ 优先级高于后缀 ?，等价于 (^TrackNode)?
}

// 6. 纯计算函数（无 effects 子句 = 编译期验证 100% 纯函数）
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

// 7. 异步结构化并发 + C 互操作显式指针边界 + 管道流处理
pub fn process_tracks(nodes: []*PcmFrame, ratio: f64) -> []f32 ! AudioError 
    effects [Async, Parallel, IO, Unsafe] 
{
    // 结构化并发作用域：s: FiberScope 与 frame: PcmFrame 默认均为零拷贝只读借用，再无 &*PcmFrame 噪音！
    val resampled_peaks = fiber::scope(fn(s: FiberScope) -> []f32 ! AudioError {
        val job: Fiber<[]f32 ! AudioError> = s.spawn(fn() -> []f32 ! AudioError {
            return nodes
                |> par_map(fn(frame: PcmFrame) -> f32 => {
                    // 显式调用 .as_raw_ptr() 跨越 C 语言 FFI 边界
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
