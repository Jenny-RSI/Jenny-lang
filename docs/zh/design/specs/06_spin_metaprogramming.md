# Jenny 语言规范 —— 模块六：`@spin` 编译期白盒元编程 (`@spin` White-Box Metaprogramming)

> **状态**：已定稿 (v1.0-spec)  
> **核心母题**：“纺纱（Spinning）”即代码生成 —— 将过程式控制流与声明式 AST 准引用（`quote`）融为一体，全语言编译期能力 100% 收口于 `@spin`，所有生成代码白盒化落盘至 `.spun/` 目录，支持直接跳转与断点单步调试。

---

## 1. `@spin` 三位一体语法体系

为遵循正交极简原则，Jenny 彻底废除 C 风格预处理器（`#ifdef`）、Rust 风格声明宏（`macro_rules!`）与外部过程宏包，将所有编译期计算、类型派生与条件编译统一于 **`@spin`** 关键字之下：

| 语法形态 | 适用场景 | 编译器执行阶段与行为 |
| :--- | :--- | :--- |
| **`@spin fn` + `@apply(...)`** | **类型/函数级派生与参数化配置纺纱**（支持 `@apply(crud_repo(table: "users", cache: true))`） | 在 Stage 2（Meta-VM）执行，接收目标类型的只读反射信息 `MetaType` 及结构化配置参数，将生成的 `CodeFragment` 格式化输出至 `.spun/<module>.spun.jn` |
| **`@spin <dsl_name>(...) { ... }`** | **块级声明式领域 DSL**（如有限状态机 FSM、HTTP 路由表、数据流拓扑、UI 树） | 将花括号内的声明式领域 AST 交由对应的 `@spin fn` 解析，一键纺出整套业务结构体、状态转移函数与样板实现（实现 10x~50x Token 压缩率） |
| **`@spin <expr>`** | **内联编译期求值**（如编译期构建查找表、预编译正则状态机、静态校验 SQL 字符串） | 在编译期 Meta-VM 中直接求值表达式，将结果折叠为静态只读数据段（`.rodata`）常量或内联 AST 节点 |
| **`@spin if <cond> { ... }`** | **泛型特征静态裁剪与跨平台条件编译**（替代传统 `#if`） | 在泛型实例化或目标平台确定时，静态评估布尔条件（如 `T is UniqueMove` 或 `platform.target == "wasm32"`），未命中的分支在编译期被彻底抹除 |

---

## 2. 纯增量追加铁律 (Additive-Only Principle)

为了确保人类与 AI 阅读源码时 **“所见即所得（源码即 100% 物理真相）”**，Jenny 对 `@apply` 派生元编程施加严格的**纯增量追加约束**：

1. **严禁篡改原定义**：`@spin fn` 接收的 `target: MetaType` 是完全**只读**的。任何 `@apply(...)` **绝对不允许暗中增加、删除、重命名或修改原 `struct` 已声明的字段、内存布局或原函数的签名**。
2. **仅允许追加与静态审计**：
   * 允许为目标类型追加新的 `impl` 方法块、实现 `Trait`（如 `impl Equatable for User`）或生成配套的辅助结构体（如 `UserRepository`、`UserBuilder`）。
   * 允许通过 `@spin.error(msg, span)` 与 `@spin.warn(msg, span)` 执行自定义编译期架构规则审计（例如拦截在 `@repr(C)` 结构体中误用 `^T` 句柄）。

---

## 3. 反射 API、`quote` 模板与高密度领域 DSL 模板库 (Spindle Pattern Library)

### 3.1 核心编译期反射类型 (`std::spin`)
在 `@spin fn` 内部，可直接使用与日常业务代码 100% 相同的 `for`、`while`、`if`、`match` 遍历以下内置反射对象：
* **`MetaType`**：提供 `.ident()`（类型标识符）、`.fields() -> []MetaField`、`.variants() -> []MetaVariant`、`.attributes() -> []MetaAttr`、`.is_native_ptr()`、`.is_gc_handle()`、`.is_trivial_copy()` 等内省方法。
* **`MetaField`**：提供 `.ident()`、`.type_info() -> MetaType`、`.default_expr()`、`.has_attr(name: str)` 及精确源码坐标 `.span`。
* **`MetaAstBlock`**：用于解析 `@spin dsl_name { ... }` 传入的结构化自定义 DSL 语法块。
* **`CodeFragment` & `CodeList`**：类型安全的 AST 代码片段容器。

### 3.2 `quote { ... }` 与 `$(...)` 插值规则
* **单节点插值 `$(expr)`**：将 `Ident`、字面量数值/字符串、`MetaType` 或子 `CodeFragment` 注入 AST 模板。
* **列表展开插值 `$(...list)`**：将 `CodeList` 中的多个代码片段按语句行或参数列表无缝展开。
* **词法卫生性（Lexical Hygiene）**：`quote` 块内部定义的局部临时变量（如 `val _tmp = ...`）自动附加唯一卫生前缀，绝不污染或遮蔽宿主作用域变量；而显式声明的 `pub fn` 或拼接标识符 `$(f.ident() + "_Changed")` 则正常对外可见。

```rust
module models

// 1. 定义编译期代码纺锤 (@spin fn)
@spin fn derive_binary_codec(target: MetaType) -> CodeFragment {
    var encode_stmts = CodeList::new()
    var decode_fields = CodeList::new()

    for f in target.fields() {
        // 编译期架构防呆：拦截不可直接字节序列化的托管句柄
        if f.type_info().is_gc_handle() {
            @spin.error("二进制协议结构体禁止包含 ^T 托管句柄，请改用值类型或 *T", f.span)
        }

        encode_stmts.push(quote {
            writer.write_field(self.$(f.ident()))?
        })
        decode_fields.push(quote {
            $(f.ident()): reader.read_field::<$(f.type_info())>()?,
        })
    }

    return quote {
        impl BinaryCodec for $(target.ident()) {
            pub fn encode(self, mut writer: ByteWriter) -> void ! IoError 
                effects [IO] 
            {
                $(...encode_stmts)
            }

            pub fn decode(mut reader: ByteReader) -> $(target.ident()) ! IoError 
                effects [IO] 
            {
                return $(target.ident()) {
                    $(...decode_fields)
                }
            }
        }
    }
}

// 2. 应用纺锤：生成的代码自动落盘至 .spun/models.spun.jn
@apply(derive_binary_codec)
pub struct PacketHeader {
    pub magic: u32 = 0x4A4E5900,
    pub seq_id: u64,
    pub flags: u16,
}
```

### 3.3 面向反上下文爆炸的领域 DSL 模板生态 (Spindle Patterns & `jenny distill`)
为了将业务代码量与大模型上下文 Token 压缩 10~50 倍，Jenny 鼓励通过 **`spindle` 领域模板库**构建声明式业务骨架：

1. **参数化策略派生（Parameterized `@apply`）**：
   ```rust
   @apply(patterns::crud_service(
       table: "invoices",
       cache: RedisCache(ttl: 600.sec),
       retry: ExponentialBackoff(max_attempts: 3)
   ))
   pub struct Invoice {
       pub id: u64,
       pub total_cents: i64,
   }
   ```
2. **块级声明式领域 DSL（`@spin <dsl_name> { ... }`）**：
   ```rust
   // 仅 6 行声明式状态机 DSL，自动在 .spun/ 中纺出数百行类型安全的状态转换与事件分发实现
   @spin fsm::state_machine(InvoiceFsm) {
       Draft     --[Issue]---> Issued    guard (inv.total_cents > 0)
       Issued    --[Pay]-----> Paid
       Issued    --[Void]----> Voided
   }
   ```
3. **`jenny distill`（项目共性代码反向提炼工作流）**：
   * 当项目中积累了多个结构相似的 `.jn` 实现模块时，运行 `jenny distill` 将驱动编译器 AST 克隆检测器与 AI 协同，自动将重复的业务骨架提炼为项目内的 `@spin fn` 模板，并将原文件替换为精简的 `@apply(...)` 配置，持续对抗代码库膨胀。

---

## 4. 过程式 `@spin` 模板展开与受限变参包 (`...args: Trait` + `@spin for` + `@spin if`)

### 4.1 为什么过程式 `@spin` 模板展开远优于传统声明式类型推导展开？
在传统系统语言（如 C++ 的模板特化 / SFINAE / 递归变参模板，或 Rust 针对不同长度元组 `(A,)`, `(A, B)`, `(A, B, C)` 的碎片化 `Trait` 族体操）中，编译期多态与异构参数展开被迫拆散为成百上千行碎片化的声明式类型推导规则：
* 原本只需十余行顺序逻辑就能表达清楚的算法（如：初始化缓冲区 $\rightarrow$ 遍历参数包按能力分派写入 $\rightarrow$ 冻结返回并释放缓冲区），在声明式类型体操中被割裂成难以追踪的辅助 Trait、关联类型投影与递归基例，既造成严重的上下文膨胀，又极易诱发大模型推理幻觉。
* Jenny 采用 **“签名级正交 Trait 联合约束（Bounded Variadic Pack `...args: Formattable`）+ 函数体内过程式编译期展开（`@spin for` + `@spin if`）+ 全局类型签名哈希去重池”** 的三位一体范式：
  1. **三层正交 Trait 联合约束与调用点静态防线（`...args: Formattable`）**：严禁无约束的 C++ 鸭子类型变参包；将格式化能力拆分为轻量视图转换 `ToStr`、流式直写 `FmtInto` 与带参格式控制 `FmtSpecInto`，定义联合约束 `pub type Formattable = FmtInto | ToStr | (FmtSpecInto, FmtSpec, ...i64)`，在调用点即静态检验每个实参，违者直接报结构化编译错误 `E0309_VARIADIC_TRAIT_BOUND_UNSATISFIED`。
  2. **函数体内零具体原语判断的过程式展开（`@spin for` & `@spin if`）**：模板体内不再枚举任何 `str`、`bool`、`i64` 具体原语类型，仅包含 `(val_item, spec, ...params)`、`FmtInto`、`ToStr` 三个正交语义分支。
  3. **保留一等元组类型的 `.spun` 落盘与跨模块/跨包全局去重（`.jenny-cache/spin/`）**：
     * 展开后的 `.spun` 函数完整保留一等元组类型（如 `_arg3: (i64, FmtSpec, i64)`），在函数体内通过 `_arg3.0` / `_arg3.1` / `_arg3.2` 解构；
     * 展开函数名按 **`(模板唯一标识, 规范化实参类型元组)`** 计算确定性短哈希（如 `format_with__spin_7f3a9c12`），缓存在 `.jenny-cache/spin/` 全局单态化池中；多个模块或第三方包传入相同类型组合时 **100% 共享同一份 `.spun` 展开与目标码**。

```jenny
pub trait ToStr {
    pub fn to_str(self) -> str
}

pub trait FmtInto {
    pub fn fmt_into(self, mut fb: FmtBuffer, culture: Culture) -> i64 ! FmtError
        effects [Mutate]
}

pub trait FmtSpecInto {
    pub fn fmt_spec_into(self, mut fb: FmtBuffer, culture: Culture, spec: FmtSpec, ...params: i64) -> i64 ! FmtError
        effects [Mutate]
}

pub type Formattable = FmtInto | ToStr | (FmtSpecInto, FmtSpec, ...i64)

@spin pub fn format_with(culture: Culture, ...args: Formattable) -> String {
    var fb = FmtBuffer.in_arena(512)!
    @spin for arg in args {
        @spin if arg is (val_item, spec, ...params) {
            val_item.fmt_spec_into(mut fb, culture, spec, ...params)!
        } else if arg is FmtInto {
            arg.fmt_into(mut fb, culture)!
        } else if arg is ToStr {
            fb.put_str(arg.to_str())!
        }
    }
    val out = fb.to_sso_string()
    fb.drop_fmt()
    return out
}
```

### 4.2 `@spin if`：泛型特征分支与跨平台条件编译

在泛型容器或系统级跨平台代码中，使用 `@spin if` 实现零运行时开销的编译期分支裁剪：

```rust
impl<T> Array<T> {
    fn drop(mut self) {
        // 1. 泛型合成特征裁剪：若 T 为 f32 或 ^User，整个循环在编译期被彻底消除！
        @spin if T is UniqueMove {
            for i in 0..self.len {
                drop(self.buf.read_and_take(i))
            }
        }

        // 2. 跨平台目标裁剪：根据后端架构选择释放指令
        @spin if platform.target == "wasm32" {
            wasm_linear_free(self.buf.raw_ptr())
        } else {
            mimalloc_free(self.buf.raw_ptr())
        }
    }
}
```

---

## 5. 五级 `@spin` AOP 切面织入与代码埋点架构 (`L1 ~ L5` Aspect-Oriented Weaving)

传统语言的面向切面编程（AOP）长期处于两极分化的困境：Java（Spring AOP / AspectJ）依赖运行期动态代理、`Object[]` 装箱反射与隐晦的正则表达式切点，不仅运行期开销高昂，且源码对切面完全不可见；Rust（`#[tracing::instrument]`）则必须手写复杂的编译器 `proc_macro` 操纵抽象语法树 Token 流，极易沦为难以单步调试的宏黑洞。

Jenny 直接复用第 4 节确立的**过程式 `@spin` 模板展开（Procedural `@spin` Template Unrolling）**，提供一套**零闭包/零反射开销、100% `.spun` 白盒落盘、且与 `.jni` 契约及静态效应系统（`effects`）深度协同**的五级编译期 AOP 体系。

### 5.1 过程式函数切面定义 (`@target fn_meta: SpinFn, ...args: Any`)

编写一个函数切面无需拼接 AST 字符串（`quote { ... }`），而是直接编写接收 `@target fn_meta: SpinFn` 与 `...args: Any` 的过程式 `@spin` 包装函数：

```jenny
// 通用可观测性埋点切面：支持入参按需格式化采样、耗时统计与错误传播拦截
@spin pub fn trace_span(
    @target fn_meta: SpinFn,
    ...args: Any
) -> fn_meta.Return {
    val start_ns = rt_mono_now_ns()
    var span = TraceSpan.enter(fn_meta.module_name, fn_meta.name)

    // 1. [Before] 编译期静态遍历参数包：仅对满足 FmtInto / ToStr 的参数生成埋点代码
    @spin for (param_name, arg) in zip(fn_meta.param_names, args) {
        @spin if arg is FmtInto {
            span.tag_fmt(param_name, arg)
        } else if arg is ToStr {
            span.tag_str(param_name, arg.to_str())
        }
        // 未实现格式化的内部指针或敏感凭证在编译期自动跳过，生成 0 行运行期代码！
    }

    // 2. [Around / AfterThrowing] 调用原函数并捕获错误传播路径
    val result = fn_meta.invoke(...args) catch err {
        span.record_err(err, rt_mono_now_ns() - start_ns)
        span.leave()
        raise err
    }

    // 3. [AfterReturning] 正常返回路径耗时统计
    span.record_ok(rt_mono_now_ns() - start_ns)
    span.leave()
    return result
}
```

当 `@apply(trace_span)` 织入目标函数 `checkout(mut self, user: str, amount: i64)` 时，编译器将原函数体提取为内联函数 `checkout__body`，并在 `.spun/` 中生成 **100% 标准、无闭包包装的 Jenny 代码**：

```jenny
// .spun/payment.spun.jn —— 白盒落盘，支持 IDE 直接单步断点调试
fn checkout__body(mut self: PaymentEngine, user: str, amount: i64) -> OrderId ! PayError {
    // 原始纯净业务逻辑
    ...
}

// @spin woven by `@apply(trace_span)`
pub fn checkout(mut self: PaymentEngine, user: str, amount: i64) -> OrderId ! PayError {
    val start_ns = rt_mono_now_ns()
    var span = TraceSpan.enter("payment", "checkout")
    span.tag_str("user", user.to_str())
    span.tag_fmt("amount", amount)

    val result = checkout__body(mut self, user, amount) catch err {
        span.record_err(err, rt_mono_now_ns() - start_ns)
        span.leave()
        raise err
    }

    span.record_ok(rt_mono_now_ns() - start_ns)
    span.leave()
    return result
}
```

---

### 5.2 L1 ~ L5 五级 `@spin` AOP 作用域矩阵

Jenny 将切面挂载粒度细化为从宏观构建到微观语句块的 **5 个正交层级**：

| 层级 | 作用域粒度 | 挂载位置（载体） | 织入目标（Join Point） | 典型工程场景 |
| :---: | :--- | :--- | :--- | :--- |
| **L1** | **全局 / 构建级**<br>*(Build / Workspace)* | `Tapestry.toml` `[profile.*]` 或 CLI `--aspect` | 全工作区及所有依赖包（`.jnast`）中满足静态过滤条件的函数 | **全局内存分配调用审查**、全链路火焰图剖析、全局 Chaos 故障注入 |
| **L2** | **包 / 模块树级**<br>*(Package / Subtree)* | `pkg.jni` 的 `export module` 或包声明处 | 整个包或指定模块子树（如 `std::io::*`）下的所有公开函数 | 包级 API 鉴权、子系统出入参脱敏审计、模块树统一超时熔断 |
| **L3** | **源码文件级**<br>*(File / Module)* | `.jn` / `.jni` 顶部的 `module xxx` 声明处 | 当前源码文件内的所有函数与方法 | 单模块集中调试追踪、文件级性能热点回归分析 |
| **L4** | **类型 / 函数级**<br>*(Type `impl` / `fn`)* | `impl Struct` 块或单个 `pub fn` / `fn`（支持 `@no_apply` 豁免） | 指定结构体的全部方法，或单个具体函数 | 状态机流转审计（`impl OrderFsm`）、单函数自动重试 `@apply(retry)` |
| **L5** | **语句 / 块级**<br>*(Statement / Block)* | 函数体内部的 `{ ... }` 局部代码块或循环块 | 局部语句块（`@target blk: SpinBlock`，**原地内联展开**） | 函数内分阶段耗时打点、热点循环零分配守卫（`assert_zero_alloc`） |

#### 典型范式 1：L1 全局构建级 + 静态效应过滤实现“全局内存分配调用审查”
得益于 Jenny 每个函数都具备编译器强制验证的 `effects [AllocNative, AllocGC, AllocRegion]` 标签，以及依赖包携带 `lib/pkg.jnast` 规范化 AST 归档（见[模块十二](./12_package_management_and_module_system.md) §5.3），L1 全局切面无需靠脆弱的函数名正则匹配，即可按效应标签对全工程（含第三方库）的每一次堆内存分配进行 **100% 零漏报、零误报的静态织入审查**：

```jenny
@spin pub fn audit_memory_alloc(@target fn_meta: SpinFn, ...args: Any) -> fn_meta.Return {
    // 编译期静态筛选：不涉及堆分配的纯计算函数 100% 原样直通，零任何运行期开销！
    @spin if !fn_meta.has_effect(AllocNative) && !fn_meta.has_effect(AllocGC) {
        return fn_meta.invoke(...args)
    }

    val before_boxes = active_native_boxes()
    val result = fn_meta.invoke(...args) catch err {
        val leaked = active_native_boxes() - before_boxes
        mem_audit::log_err_alloc(fn_meta.module_name, fn_meta.name, leaked)
        raise err
    }
    val delta = active_native_boxes() - before_boxes
    mem_audit::log_alloc(fn_meta.module_name, fn_meta.name, delta)
    return result
}
```
在 `Tapestry.toml` 中一键开启（无需改动任何业务源码）：
```toml
[profile.mem-audit]
global_aspects = ["std::rt::audit::audit_memory_alloc"]
```

#### 典型范式 2：L4 批量挂载与 `@no_apply` 局部豁免
当在 L2 / L3 / L4 批量挂载切面时，针对被调用上亿次的高频内联访问器（如 `len()`、`capacity()`），支持通过 `@no_apply(aspect_fn)` 在编译期静态豁免：
```jenny
@apply(prof::trace_span)
impl Vec {
    @no_apply(prof::trace_span) // 高频 O(1) 访问器豁免埋点
    pub fn len(self) -> i64 {
        return self.len
    }

    pub fn push(mut self, val: i64) -> i64 ! VecError { ... }
}
```

#### 典型范式 3：L5 语句/块级原地内联切面 (`@target blk: SpinBlock`)
L5 切面直接修饰函数体内部的局部语句块 `{ ... }`，在 `.spun` 中**原地内联展开（In-Place Block Weaving）**，既不产生闭包调用开销，也完全保留块内使用 `?` 或 `return` 向上层函数直接返回的控制流能力：

```jenny
@spin pub fn assert_zero_alloc(label: str, @target blk: SpinBlock) -> blk.Return {
    val mark_boxes = active_native_boxes()
    val out = blk.eval()
    assert(active_native_boxes() == mark_boxes)
    return out
}

pub fn process_batch(mut self, items: []i64) -> i64 ! BatchError {
    // 仅对函数内部的核心热循环块织入零堆分配守卫
    val sum = @apply(assert_zero_alloc("hot_loop")) {
        var acc = 0
        for x in items {
            acc += self.transform_in_arena(x)?
        }
        acc
    }
    return sum
}
```

---

### 5.3 五级切面与 `.jni` 契约的洋葱嵌套顺序及职责边界

1. **确定性洋葱嵌套铁律**：
   当多级切面同时命中同一函数时，编译器严格按**“作用域由外向内（`L1 -> L2 -> L3 -> L4`）、契约守卫居中、函数体与 `L5` 居内”**的顺序织入：
   $$\text{Caller} \rightarrow \underbrace{\text{L1 (全局)} \rightarrow \text{L2 (包级)} \rightarrow \text{L3 (文件级)} \rightarrow \text{L4 (函数级)}}_{\text{同签名切面自动幂等去重，支持 } \texttt{@no\_apply} \text{ 豁免}} \rightarrow \mathbf{[\text{.jni } \texttt{requires/ensures}]} \rightarrow \text{函数体 (含 } \mathbf{\text{L5 块级切面}}\text{)}$$
   * L1~L4 包裹在 `requires` 契约外侧，确保即便调用方传入了违反前置契约的非法参数，外层可观测性切面依然能完整记录该次失败请求与耗时；
   * L5 位于函数体内部，其执行结果在函数返回时继续接受外层 `ensures` 后置契约的校验。
2. **`.jni` 蓝图切面 vs `.jn` 实现切面的职责分离**：
   * **架构/业务语义切面（声明于 `.jni` 蓝图）**：如 `@apply(auth::require_admin)`、`@apply(tx::transactional)`——改变调用方必须知晓的权限、重试或事务契约；
   * **纯观测/剖析埋点切面（声明于 `.jn` 实现或 `Tapestry.toml`）**：如 `@apply(trace_span)`——不改变任何输入输出契约，保持 `.jni` 架构蓝图的绝对纯净。

---

## 6. 基于 `@spin` AOP 的按需零冗余类型反射与契约感知反射 (`On-Demand Reflection`)

### 6.1 破局传统类型反射的两难死锁
* **Java / C# / Go 的全量强制反射之痛**：无论是否用到反射，编译器都将全工程所有结构体的字段表塞入二进制，且每个对象实例头部被迫携带 8~16 字节的 `Klass*` / `MethodTable*` 指针，导致二进制膨胀、对象内存浪费与逆向工程裸奔。
* **Jenny 的“编译期全知（`SpinType`），运行期按需织入（On-Demand Zero-Header Reflection）”**：
  * **默认零开销**：未挂载反射切面的 `struct` / `enum` 保持 100% 纯净的 C99 紧凑内存布局（0 字节对象头、0 字节反射表）；
  * **按需白盒生成**：通过 L1~L5 `@spin` 切面（接收 `@target ty_meta: SpinType`），仅为需要反射的目标类型按需生成纯静态分支的运行期类型查询与字段访问方法！

### 6.2 类型反射切面定义 (`@target ty_meta: SpinType`) 与 `.spun` 展开

```jenny
pub struct FieldInfo {
    pub name: str,
    pub type_name: str,
    pub offset_bytes: i64,
}

pub struct TypeInfo {
    pub name: str,
    pub size_bytes: i64,
    pub field_count: i64,
    pub layout_hash: i64,
}

// 按需类型反射切面：不修改原结构体物理内存布局，纯增量织入运行期反射方法
@spin pub fn reflect_type(@target ty_meta: SpinType) {
    impl $(ty_meta.Type) {
        pub fn type_info(self) -> TypeInfo {
            return TypeInfo {
                name: $(ty_meta.name),
                size_bytes: $(ty_meta.sizeof),
                field_count: $(ty_meta.fields.len()),
                layout_hash: $(ty_meta.layout_hash),
            }
        }

        pub fn field_info(self, idx: i64) -> FieldInfo? {
            @spin for (i, fld) in enumerate(ty_meta.fields) {
                if idx == $(i) {
                    return some(FieldInfo {
                        name: $(fld.name),
                        type_name: $(fld.type_name),
                        offset_bytes: $(fld.offset),
                    })
                }
            }
            return null
        }

        // 按字段名运行期动态读取字段值（直接复用三层正交 Formattable + str::format）
        pub fn get_field_str(self, field_name: str) -> String? {
            @spin for fld in ty_meta.fields {
                @spin if fld.Type is Formattable {
                    if field_name.eq_str($(fld.name)) {
                        return some(str::format(self.$(fld.ident)))
                    }
                }
            }
            return null
        }
    }
}
```

当对 `OrderRecord` 应用 `@apply(reflect_type)` 后，`.spun/` 展开产物**全部是零哈希查找、零 `void*` 堆装箱的静态内联分支**，且 `sizeof(OrderRecord)` 保持原样不变：

```jenny
// .spun/order.spun.jn
impl OrderRecord {
    pub fn type_info(self) -> TypeInfo {
        return TypeInfo { name: "OrderRecord", size_bytes: 32, field_count: 3, layout_hash: 918273645 }
    }

    pub fn field_info(self, idx: i64) -> FieldInfo? {
        if idx == 0 { return some(FieldInfo { name: "order_id", type_name: "i64", offset_bytes: 0 }) }
        if idx == 1 { return some(FieldInfo { name: "buyer", type_name: "str", offset_bytes: 8 }) }
        if idx == 2 { return some(FieldInfo { name: "paid", type_name: "bool", offset_bytes: 24 }) }
        return null
    }

    pub fn get_field_str(self, field_name: str) -> String? {
        if field_name.eq_str("order_id") { return some(format_with__spin_9b12c401(Culture.Invariant, self.order_id)) }
        if field_name.eq_str("buyer")    { return some(format_with__spin_44a0e112(Culture.Invariant, self.buyer)) }
        if field_name.eq_str("paid")     { return some(format_with__spin_88c3d005(Culture.Invariant, self.paid)) }
        return null
    }
}
```

### 6.3 结合五级 AOP 作用域的三种按需反射姿势与“契约感知反射”

1. **L4 单类型精准反射**：直接在目标 `struct` / `enum` 上标注 `@apply(reflect_type)`。
2. **L2 / L3 模块/包级批量按需反射（零侵入 DTO 目录）**：
   * 在模型文件头部 `module`（L3）或 `pkg.jni`（L2）声明 `@apply(reflect::reflect_type, where: target.is_struct())`，即可让该模块下所有数据结构自动获得运行期反射能力。
3. **L5 调用点外部类型自省（无需原类型预挂载切面）**：
   * 即使引入的第三方结构体当时未挂载 `reflect_type`，由于依赖包携带了 `.jni` 蓝图，调用方仍可编写接收 `obj: Any` 的 `@spin fn`（通过 `typeof(obj).fields` 编译期自省），在调用点按需单态化生成该类型的专属检查或序列化函数。
4. **契约感知反射（Contract-Aware Reflection）**：
   * 与传统反射只能获取字段名和类型不同，Jenny 的 `ty_meta: SpinType` 还可直接访问 `.jni` 蓝图中的 **`ty_meta.invariants`**（如 `invariant self.port >= 1 && self.port <= 65535`）；
   * 反射切面可将结构不变式一并织入运行期描述符与校验器中，直接赋能**带契约自检的 JSON/配置反序列化**以及**面向 AI Agent 的 Tool Call JSON Schema（自动导出数值边界与前置约束）**生成！

---

## 7. `.spun/` 白盒落盘与确定性沙箱虚拟机 (Meta-VM)

### 7.1 `.spun/` 一等公民源码体验
1. **格式化可读落盘**：每次执行 `jenny build`、`jenny check` 或 `jenny spin --inspect` 时，Stage 2 虚拟机将所有 `@spin` 产物通过官方 Formatter 格式化后写入项目根目录的 **`.spun/<module_path>.spun.jn`**。
2. **真实行号映射（Zero-Blackbox Debugging）**：
   * 在 IDE 中对 `packet.encode(mut writer)` 执行 **Go to Definition（跳转到定义）**，编辑器直接打开 `.spun/models.spun.jn` 的第 4 行！
   * 运行时发生错误或断点单步进入生成方法时，调试器直接停在 `.spun/models.spun.jn` 的真实源码行上。
3. **编译期 DAP 断点调试**：开发者可在 `@spin fn derive_binary_codec` 内部的 `for f in target.fields()` 处直接打断点，运行 `jenny debug-spin` 即可在 IDE 中单步观察 `encode_stmts` 是如何一行行纺出的。

### 7.2 100% 确定性沙箱铁律 (Deterministic Sandbox)
为确保任何机器、任何时间以及增量编译缓存（Incremental Compilation Cache）下的构建结果 **100% 比特级一致（Reproducible Builds）**，运行 `@spin` 的内置字节码虚拟机（Meta-VM）执行严格沙箱隔离：
* **绝对禁止**：发起网络 Socket 请求、获取系统实时时钟、读取硬件随机数、读写项目外的宿主文件系统或执行外部 Shell 进程。
* **受控静态资产读取**：仅允许通过 `@spin.include_str("schema.sql")` 或 `@spin.include_bytes("icon.png")` 读取项目目录内的静态文件，且编译器自动将该文件纳入增量构建的哈希依赖图中。

