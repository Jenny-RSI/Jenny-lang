# Jenny 语言规范 —— 模块二：基础类型系统与代数数据类型 (Primitive Types & Algebraic Data Types)

> **状态**：已定稿 (v1.0-spec)  
> **核心原则**：内存布局透明、零隐式数值转换、不可变 SSO 字符串底座、以 `struct`（积类型）+ `enum`（和类型）+ `match`/`is`（穷尽与条件模式匹配）构建正交的数据表示层。

---

## 1. 基础标量与复合值类型 (Primitives & Value Compounds)

### 1.1 标量类型表与“无损拓宽自动放行”规则
为了兼顾数值安全与代码清爽度（消除满屏无意义的 `.as<i64>()` 视觉噪音），Jenny 对数值转换实行精准分级：
* **100% 零精度损失的同符号拓宽转换（Lossless Widening）自动完成**：如 `u8 -> u16 -> u32 -> u64`、`i8 -> i16 -> i32 -> i64`、`f32 -> f64`，无需手写转换。
* **有损窄化、浮点转整数、或跨有符号/无符号转换强制显式 `.as<T>()`**：任何可能截断、丢失精度或改变符号位解释的转换，必须显式调用 `.as<T>()`（或带边界检查的 `.try_as<T>()?`）。

| 类别 | 类型关键字 | 物理大小与语义说明 |
| :--- | :--- | :--- |
| **有符号整数** | `i8`, `i16`, `i32`, `i64`, `i128` | 二进制补码有符号整数（Debug 模式默认开启溢出 Trap，Release 模式可通过 `wrapping_add` 等显式控制） |
| **无符号整数** | `u8`, `u16`, `u32`, `u64`, `u128` | 无符号整数；字节数据统一使用 `u8`（废除独立的 `byte` 别名以保持唯一标准写法） |
| **平台字长整数** | `isize`, `usize` | 与目标架构指针等宽（64 位 Native 为 64-bit，Wasm32 为 32-bit），专用于数组索引与内存偏移量 |
| **浮点数** | `f16`, `f32`, `f64` | 遵循 IEEE-754 标准 |
| **布尔与字符** | `bool`, `char` | `bool` 占 1 字节（仅 `true`/`false`）；`char` 占 4 字节，表示单个 Unicode 标量值（Unicode Scalar Value） |
| **单元与永不返回** | `void` (或 `()`), `never` | `void` 表示无返回值；`never`（底类型 $\bot$）用于必然触发 `panic`、无限循环或 `raise` 的分支推导 |

### 1.2 元组与四级连续序列类型（`[N]T`、`[]T`、`Array<T>`、`Vec<T>`）的正交区分
为了消除 C/C++/Go/Rust 中定长数组、切片与动态扩容容器概念混淆的痛点，Jenny 严格区分元组及以下四级连续序列形态：

1. **元组 `(T1, T2, ...)` 与 `std::core::tuple` 白盒底座**：
   * 匿名积类型，按值内联在栈或父结构体中，支持 `.0`、`.1` 下标访问、`val (a, b) = pair` 解构绑定与多返回值。
   * **语法糖与标准库白盒同构**：二元组 `(A, B)`、三元组 `(A, B, C)` 及多元组 `(T1, T2, ...)` 在前端解糖为 `std::core::tuple` 中的 `Pair<A, B>`、`Triple<A, B, C>` 及 `@spin` 编译期变参生成的 `Tuple<...Ts>`，天然具备按位比较（`Eq`）、字典序比较（`Ord` / `lex_cmp`）与复合键哈希（`Hash` / `hash_combine`）契约，可直接作为 `HashMap` 复合键或排序键使用。
2. **编译期定长内联值数组 `[N]T`**（如 `[4]f32`、`[256]u8`）：
   * 编译期已知长度 `N`（`usize` 常量），**100% 内联存储在栈上或结构体内部**（`sizeof([N]T) == N * sizeof(T)`），零堆分配、零额外头信息；支持字面量 `[1, 2, 3, 4]` 与重复初始化 `[0; 256]`。
   * 与 C 语言数组 `T[N]` 的物理内存布局 1:1 完全一致，可直接嵌入 `@repr(C) struct` 零拷贝传给 C 函数，并可零成本借用降级为 `[]T` / `mut []T` 切片视图。
3. **借用切片视图 `[]T` / `mut []T`**（`std::slice`）：
   * 栈绑定胖指针 `{ ptr: *T, len: usize }`（16 字节），是对任意连续内存（来自栈上 `[N]T`、`Array<T>`、`Vec<T>`、`Arena` 或 C 缓冲区）的局部非拥有视图，受词法作用域二阶借用规则保护，零堆分配开销。
4. **运行期定长堆数组 `Array<T>`**（16 字节 `{ ptr: *T, len: usize }`）：
   * 用于创建**运行期确定长度 `n`、创建后长度固定不再改变**的密集数据块（如矩阵、图像像素缓冲区、音频帧或网络包载荷）。比 `Vec<T>` 省去 8 字节 `cap` 字段与扩容分支开销，支持 `*Array<T>`（Native 唯一所有权）、`*in(arena) Array<T>`（Arena 区域分配）与 `^Array<T>`（Immix GC 托管）。
5. **动态可扩容数组 `Vec<T>`**（`std::collections::Vec`，24 字节 `{ buf: RawBuf, len: i64, cap: i64 }`）：
   * 标准库一等动态顺序容器，支持 `push` / `pop` / 几何级数（$2\times$）动态扩容，并由 `.jni` 形式化契约强制保障 `0 <= self.len && self.len <= self.cap`。

### 1.3 三级序列下标访问与编译期形式化边界证明器 (`Jenny-BoundsProver` & `E0711`)

为了彻底终结系统编程语言中**“每次下标访问都插分支影响吞吐”**与**“手写 `unsafe get_unchecked` 漏检边界酿成内存越界 CVE”**的两难困境，Jenny 为所有连续序列（`[N]T`、`[]T`、`Array<T>`、`Vec<T>`）确立了 **“默认安全 + 编译期 `QF_LIA` 形式化完备性证明器”** 架构：

#### 1. 三级序列下标访问模型

| 层级与语法 | 函数签名与副作用 | 编译期与运行期行为语义 |
| :--- | :--- | :--- |
| **1. 显式受检访问**<br>`seq.get(i)` / `seq.get_opt(i)` | `-> T ! BoundsError` 或 `-> T?`<br>*(无 `Unsafe` 副作用)* | 100% 边界安全，越界通过值返回错误链或 `null` 显式处理，适合外部不可信索引输入。 |
| **2. 默认安全下标**<br>`seq[i]` / `seq[i] = val` | `-> T` / `-> void`<br>*(无 `Unsafe` 副作用)* | **语义上 100% 受边界保护**；但**若编译期边界证明器（`Jenny-BoundsProver`）证明当前支配路径满足 $0 \le i < \text{seq.len}$，编译器自动消去运行期比较分支（Zero-Cost Bounds Check Elision，直接生成单条寻址指令 `*(seq.ptr + i)`）**；仅当无法静态得证时保留单条无符号比较指令 `cmp i, len; jae trap`。 |
| **3. 底层免检原语**<br>`seq.get_unchecked(i)`<br>`seq.set_unchecked(i, val)` | `-> T effects [Unsafe]`<br>`requires 0 <= i && i < self.len` | 底层零分支寻址原语，携带 `effects [Unsafe]` 与霍尔前置契约。调用方若在外层完成一次性批量边界检查并用 **`mask [Unsafe]`** 阻断 `Unsafe` 传染，**必须通过编译期 `QF_LIA` 完备性证明，否则触发 `E0711_UNPROVEN_BOUNDS_CONTAINMENT` 编译错误！** |

#### 2. 为什么 Jenny 能在编译期 $< 1\text{ms}$ 内自动证明边界完备性？

通用程序验证在图灵完备域上是不可判定的，但**数组下标与长度的边界完备性证明**天然落在 **无量词线性整数算术与位向量域（Quantifier-Free Linear Integer Arithmetic, `QF_LIA` / `QF_BV`，即 Presburger 算术可判定子集）** 内，无需人工手写 Coq/Lean 引理即可 100% 机械判定。

同时，Jenny 的三项语言设计直接消除了 C/C++/Rust 编译器无法跨语句/跨函数消除边界检查的障碍：
1. **`guard ... else` 的线性支配保证（SSA Path Dominance）**：`guard cond else { raise/return }` 的 `else` 分支必为 `never`（发散），因此 `guard` 之后的所有基本块在 SSA 控制流图上 **100% 支配性继承 `cond` 为真这一路径公理（Path Fact）**；
2. **`.jni` 契约的跨函数模块化公理注入（Modular Verification）**：无需内联被调函数体，证明器直接将被调函数 `.jni` 中的 `requires` / `ensures` 以及结构体的 `invariant`（如 `0 <= self.len && self.len <= self.cap`）作为公理注入当前证明上下文；
3. **默认只读借用与 `mut` 独占无别名（Zero Aliasing）**：参数 `buf: []u8` 保证在当前作用域内 `buf.len` 绝不会被任何别名指针或外部调用篡改。

#### 3. 两级编译期形式化边界证明引擎 (`Jenny-BoundsProver`)

* **Tier 1：八角形域路径敏感抽象解释（Octagon Abstract Domain，$\pm x \pm y \le c$，耗时 $< 0.1\text{ms}$，覆盖 $\sim 85\%$ 场景）**
  * 在 SSA 控制流图上实时维护每个整型变量的上下界 $[l, u]$ 及任意两变量的差分约束矩阵 $x - y \le c$。
  * 对标准循环 `for i in 0 .. buf.len` 自动注入 $0 \le i \le \text{buf.len} - 1$；对 `guard buf.len >= 16 else { ... }` 自动证明内部 `buf[0]` .. `buf[15]` 恒安全并消除全部 16 次运行期分支检查。
* **Tier 2：内嵌 `QF_LIA` 验证条件生成与反例求解器（SMT-Backed VCG，耗时 $0.5 \sim 2\text{ms}$，覆盖多变量协议解析与分块计算）**
  * 对每个包含下标访问或 `mask [Unsafe]` 的作用域，编译器收集支配路径上的前提集合 $\Gamma = \text{Requires} \land \text{Invariants} \land \text{DominantGuards}$，构造内部所有下标访问 $k \in \{1..m\}$ 的完备性证明义务：
    $$\text{VC}: \quad \Gamma \;\implies\; \bigwedge_{k=1}^{m} \Big(0 \le \text{idx}_k < \text{len}_k \;\land\; \neg\text{Overflow}(\text{idx}_k)\Big)$$
  * 编译器对否定式 $\Gamma \land \neg\Phi$ 求解反例（Counterexample Search）：
    * **求解结果为 `UNSAT`（无反例 = 证明完备 ✅）**：
      1. 普通安全下标 `buf[offset + k]` 自动抹除运行期边界检查（零 `Unsafe` 达到裸指针性能）；
      2. 若使用了 `get_unchecked` + `mask [Unsafe]`，静态准入通过并在 `spindle audit` 中标记为 **`PROVEN_SAFE_BY_VCG`**。
    * **求解结果为 `SAT`（发现越界或溢出反例 ❌）**：
      若在 `mask [Unsafe]` 作用域内调用了 `get_unchecked` / `set_unchecked`，编译器立即拒绝编译，报 **`E0711_UNPROVEN_BOUNDS_CONTAINMENT`**，并**直接输出触发越界的具体数值反例与防溢出修复补丁**！

#### 4. 反例拦截与零 `Unsafe` 证明消除实战示例

```jenny
// ❌ 反例拦截：外层 guard 漏检了 offset >= 0 下界与 offset + 4 溢出，试图用 mask [Unsafe] 阻断传染
pub fn bad_read_u32_le(buf: []u8, offset: i64) -> u32 ! CodecError mask [Unsafe] {
    guard offset + 4 <= buf.len else { raise CodecError.BufferUnderflow }
    // ❌ 编译报错 [E0711_UNPROVEN_BOUNDS_CONTAINMENT]:
    //   Unproven obligation: `0 <= offset + 0 && offset + 3 < buf.len`
    //   Counterexample: `{ buf.len = 4, offset = -2 }` satisfies `offset + 4 <= buf.len` (`2 <= 4`),
    //                   but `offset + 0 = -2 < 0` violates lower bound!
    //   Suggested fix: `guard offset >= 0 && offset <= buf.len - 4 else { raise CodecError.BufferUnderflow }`
    return buf.get_unchecked(offset + 0).as<u32>() | (buf.get_unchecked(offset + 3).as<u32>() << 24)
}

// ✅ 完备守卫 + 零 Unsafe 自动消除：证明器判定 UNSAT 后，自动抹除全部 4 次 buf[...] 运行期边界分支！
pub fn safe_read_u32_le(buf: []u8, offset: i64) -> u32 ! CodecError {
    guard offset >= 0 && offset <= buf.len - 4 else {
        raise CodecError.BufferUnderflow
    }
    val b0 = buf[offset + 0].as<u32>()
    val b1 = buf[offset + 1].as<u32>()
    val b2 = buf[offset + 2].as<u32>()
    val b3 = buf[offset + 3].as<u32>()
    return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
}
```

---

## 2. 字符串体系：`String`（SSO 不可变值）与 `str`（借用切片）

在双轨内存架构下，为了避免业务代码中传递字符串时发生烦人的所有权转移（Move 掏空原变量），同时兼顾硬实时环境的性能，Jenny 采用 **“不可变 SSO `String` + 借用视图 `str` + 可变 `StringBuilder`”** 三位一体架构：

### 2.1 `str`（UTF-8 字符串切片视图）
* 物理布局：`{ ptr: *const u8, len: usize }`（16 字节，保证有效 UTF-8 编码）。
* 所有的字符串字面量（如 `"hello"`）静态驻留于只读数据段（`.rodata`），其类型既是 `str`，也可零分配直接构造为 `String`。
* 函数参数若仅需读取文本，**规范标准写法一律使用 `str`**（`String` 可零成本自动隐式降级为 `str`）。

### 2.2 `String`（24 字节 SSO 不可变拥有型字符串）
* **不可变值语义（`TrivialCopy` 级体验）**：`String` 一旦创建内容不可原地修改。赋值给新变量或传参时**绝不触发 Move 失效**，原变量依然可用。
* **24 字节三态内联布局（Small String Optimization, SSO）**：
  1. **小字符串（长度 $\le 23$ 字节）**：直接将 UTF-8 字节与 1 字节长度标记内联存储在 24 字节栈空间内，**零堆分配、零指针跳转、直接按位拷贝**！
  2. **静态字面量（Static Literal）**：存储指向 `.rodata` 的指针与长度，零堆分配、零析构开销。
  3. **长字符串（长度 $> 23$ 字节）**：指向带原子引用计数（或托管堆）的不可变 UTF-8 共享字节块；复制 `String` 仅增加轻量级共享计数或拷贝句柄，零内存复制。
* **高频构建与修改**：当需要循环拼接或原地修改字节时，使用标准库的 `StringBuf` / `FmtBuffer`（位于 `std::str::{string_buf, fmt}`），构建完毕后调用 `.to_sso_string()` 零拷贝或内联转为 24 字节 `String`。

### 2.3 AI 原生零解析、编译期变参展开字符串格式化 (`str::format` & `std::str::fmt`)

在传统编程语言（C 的 `printf("%d %s")`、Go 的 `fmt.Sprintf("%v")`、Rust 的 `format!("{:08x}, {:?}", a, b)`）中，字符串格式化为了迁就人类手写时的视觉紧凑度，普遍将**无类型的格式化微语言（Mini-DSL）塞进字符串字面量内部**。这种妥协带来了三大系统级恶果：
1. **运行时解析与装箱开销**：C/Go 必须在运行时逐字符扫描 `%` 状态机并配合 `va_list` / `interface{}` 装箱；
2. **代码体积爆炸与编译缓慢**：Rust 的 `core::fmt` 依赖过程宏生成复杂的 `Arguments` 与函数指针虚表（vtable），是二进制体积膨胀与编译减速的头号元凶；
3. **LLM 生成幻觉高发**：大模型在生成含 `{` / `}` 的 JSON 或代码模板时，极易因忘记转义 `{{` / `}}` 或混淆格式占位符语法而触发编译错误。

**Jenny 的第一性原理重构（`@spin` 变参模板纯函数 + 元组强类型格式控制 + `Arena` 零堆分配暂存）**：

1. **顶层编译期变参纯函数 `str::format(...args) -> String` 与 `str::format_with(culture: Culture, ...args) -> String`**：
   * 调用方无需手工创建、追加和释放 `FmtBuffer`，直接以一行纯函数表达式完成多类型拼接与格式化：
     ```jenny
     // 普通参数直接按静态类型拼接；元组参数 `(arg, format, ...fmt_args)` 携带强类型格式控制
     val s = str::format("id=", -42, ",hex=0x", (48879, FmtSpec.HexLower, 4), ",ok=", true)
     // 结果: "id=-42,hex=0xbeef,ok=true"

     // 显式传入 Culture（绝不依赖 C 全局可变 setlocale 锁）
     val price = str::format_with(Culture.DeDE, "total=", (1234567, FmtSpec.GroupedInt), " EUR")
     // 结果: "total=1.234.567 EUR"
     ```
   * **编译期展开与 `Arena` 零动态内存分配**：编译器通过 `@spin` 变参模板元编程在编译期静态遍历 `...args` 的每个实参类型，自动在函数栈帧内的临时 `Arena`（Scratch Arena）上分配 `FmtBuffer` 完成直写，随后冻结为 24 字节 SSO `String`（$\le 22$ 字节 100% 栈内联，`> 22` 字节晋升至 Immix 块）并立即自动重置/销毁临时 `Arena`，全程 **零 `malloc`/`free` 堆分配、零格式串扫描、零虚表分派**。

2. **元组化强类型格式描述符 `(arg, format)` 与 `(arg, format, ...fmt_args)`**：
   * 彻底废除嵌在字符串里的 `"%04x"` 或 `"{:#06x}"` 隐式微语言，改用编译期强类型检查的元组：
     * **二元组 `(arg, FmtSpec)`**：如 `(1234567, FmtSpec.GroupedInt)`（按当前 `Culture` 添加千分位分隔符）；
     * **多元组 `(arg, FmtSpec, ...fmt_args)`**：第 1 项为被格式化值，第 2 项为 `FmtSpec` 格式枚举值，后续项为静态类型化的格式参数：
       * `(val, FmtSpec.HexLower, digits)` / `(val, FmtSpec.HexUpper, digits)`：小写/大写十六进制（`1 <= digits <= 8`）；
       * `(val, FmtSpec.PadZero, width)`：前导零填充十进制整数（`1 <= width <= 20`）；
       * `(val, FmtSpec.Bin, bits)`：固定位宽二进制输出（`1 <= bits <= 32`）；
       * *(预留扩展枚举变体)*：`FmtSpec.Fixed(precision)`（定点小数）、`FmtSpec.Scientific(precision)`（科学计数法）、`FmtSpec.AlignLeft(width, pad_char)`、`FmtSpec.Currency`、`FmtSpec.IsoDate` 等复杂区域与排版规则在后续迭代中按相同元组协议渐进扩展。

3. **显式区域文化控制 (`Culture` Enum) 与底层流式 `FmtBuffer`**：
   * `Culture` 一等枚举（`Culture.Invariant`、`Culture.EnUS`、`Culture.DeDE`、`Culture.ZhCN` 等）作为纯参数显式传递，保证确定性可重现格式化；
   * 底层 `FmtBuffer` 对象继续保留，并原生支持 **`FmtBuffer.in_arena(mut arena: Arena, cap: i64)`**（在调用方指定的 `Arena` 区域上分配缓冲区，随 `Arena` 一并释放，无需单独 `drop_fmt`），供跨循环流式构建场景使用。

---

## 3. 积类型：`struct`（结构体、默认字段与三态接收者）

### 3.1 声明与字段默认值
Jenny 废除繁琐的构造函数（`constructor`）重载机制，支持在字段声明处直接指定默认值，配合结构体字面量完成清晰的无歧义初始化：

```rust
@repr(C) // 可选：强制按 C ABI 规则对齐与排列字段；默认允许编译器自动重排字段以消除内存对齐空洞
pub struct HttpClientConfig {
    pub host: String = "localhost",
    pub port: u16 = 443,
    pub timeout_ms: u32 = 5000,
    pub api_key: String, // 无默认值：构造时强制必填
}

// 构造实例：未指定默认值的字段必填，其余字段自动填充默认值
val cfg = HttpClientConfig {
    api_key: "sk-jenny-01",
    port: 8080, // 覆盖默认端口
}
```

### 3.2 方法绑定与三态接收者自动适配 (`impl Type`)
配合模块一 v2.0 的参数传递模式，在 `impl Type` 块中定义方法时**彻底废除 `&self` 与 `&mut self` 符号**，直接使用三态意图接收者：

| 接收者语法 | 传递意图 | 调用方适配规则（全轨道自动解引用适配） |
| :--- | :--- | :--- |
| **`self`** *(默认)* | **只读借用模式** | **全轨道通用**：无论调用方持有的是栈值 `v`、原生指针 `*v` 还是托管句柄 `^v`，均可直接调用 `v.method()`，不夺走所有权 |
| **`mut self`** | **原地修改模式** | **全轨道通用**：调用方持有可变栈值 `var v`、可变 `*v` 或 `^v` 时可调用，原地修改字段状态 |
| **`own self`** | **所有权移交/销毁模式** | 消费并接管对象所有权（用于 `drop(own self)`、`into_xxx(own self)` 转换器或 `@scoped` 资源的显式关闭） |

---

## 4. 和类型：`enum`（代数数据类型、空位优化与 `error` 职责解耦）

### 4.1 统一和类型定义与 `enum` / `error` 严格解耦
Jenny 的 `enum` 既是传统的 C 风格枚举，也是完整的代数和类型（Tagged Union），每个变体（Variant）可携带无负载、元组负载或具名结构体负载：

```jenny
pub enum NetEvent {
    Connected,                                      // 单元变体
    Ping(u64),                                      // 元组负载变体
    Message { sender: String, payload: *Buffer },   // 具名结构体负载变体（内部可含 *T 或 ^T）
}
```

> **核心语义边界：`pub enum`（纯数据状态）vs `pub error`（具名错误域）**
> * **`pub enum`** 专用于表达业务状态、AST 节点与代数数据变体，编译器使用紧凑连续序号（`0, 1, 2...`）作为局部判别式以支持极速跳转表（Jump Table）；
> * **`pub error`**（详见[模块五 §2.3](./05_errors_and_effects.md)）专用于声明具名错误类型（如 `pub error ParseError { EmptyInput, Overflow }`）。编译器为 `pub error` 自动生成全局防冲突的 **64 位复合错误码 `[TypeHash32 | VariantHash32]`**、自动合成 `std::core::error::Error` Trait 并绑定 16 槽位线程局部调用栈轨迹（`ErrorTrace`）。**严禁将普通 `enum` 用于 `T ! E` 错误签名或 `raise` 语句！**

### 4.2 递归数据类型与三层可空架构 (`T?` + `std::core::option::Option<T>` + 空位优化)
1. **直观的递归定义**：得益于显式的 `*T` 与 `^T`，定义 AST 或树结构时无需像 Rust 那样套一层 `Box<T>`，直接用 `*Expr`（原生堆树，可配合 `*in(arena)`）或 `^Expr`（GC 托管树）：
   ```jenny
   pub enum Expr {
       Number(f64),
       Add { left: ^Expr, right: ^Expr },
   }
   ```
2. **三层可空架构（语法糖优先 + 白盒契约底座 + 后端空位优化）**：
   * **第 1 层（一等语法糖）**：日常代码一律书写 `T?`、字面量 `null`、空值合并 `x ?? default` 与模式窄化 `if x is Some(v)`，拒绝冗长的 `std::optional<T>` 模板噪音；
   * **第 2 层（`std::core::option` 白盒契约底座）**：拒绝编译器黑盒魔法！`T?` 在前端确定性解糖为 `std::core::option::Option<T>`（其 `.jni` 蓝图完整定义了 `is_some`、`is_none`、`unwrap_or`、`map`、`and_then`、`ok_or` 等霍尔契约方法，对 LLM 100% 白盒可见）；
   * **第 3 层（后端 Niche Optimization 空位填充）**：
     * 当 `T` 为非空指针/句柄（`*U`、`^U`、函数指针）时，编译器利用全零地址 `0x0` 表示 `None`（`null`），保证 **`(*U)?` 与 `*U` 物理大小严格相等（64 位下均为 8 字节，零额外 Tag 开销）**；
     * 当 `T` 为 `bool` 或有限枚举时，利用非法位模式（如 `0x02`）表示 `None`（大小仍为 1 字节）；
     * 当 `T` 为普通满位宽值类型（如 `i64`）时，降级为 `{ tag: u8, val: T }` 带标签联合体。

---

## 5. 模式匹配系统：`match`、`is` 与 `guard`

为了同时满足函数式模式解构的表达力与过程式控制流的扁平可读性，Jenny 规定了三种正交且无歧义的模式匹配语法（**彻底废除语义晦涩的 `if let` 与 `let ... else`**）：

### 5.1 全分支穷尽匹配：`match` 表达式
* **强制穷尽性（Exhaustiveness）**：编译器静态验证 `match` 必须覆盖所有可能的变体或数值区间，遗漏分支将直接报错（AI 诊断器自动生成缺失分支骨架）。
* **支持嵌套解构、守卫条件（`if`）与区间匹配**：

```jenny
pub fn describe_event(ev: NetEvent) -> String {
    return match ev {
        NetEvent.Connected => "已连接",
        NetEvent.Ping(ms) if ms > 1000 => "高延迟心跳: " + ms.to_string(),
        NetEvent.Ping(ms) => "正常心跳: " + ms.to_string(),
        NetEvent.Message { sender, payload } => "来自 " + sender + " 的消息",
    }
}
```

### 5.2 条件测试与绑定运算符：`is`
当仅需在 `if` 或 `while` 中判断单个分支并提取内部变量时，使用符合自然语言直觉的 **`is` 运算符**。
* **核心优势**：`x is Pattern` 本身是一个返回 `bool` 的表达式，**可以直接与 `&&` 逻辑与运算符串联组合**，提取出的绑定变量在右侧 `&&` 条件及后续 `{ ... }` 块中直接生效！

```jenny
// 自然流畅：模式解构与布尔条件无缝串联（无需像 Rust 那样受困于 if let 链）
if ev is NetEvent.Message { sender, payload } && payload.len > 0 {
    process_payload(sender, payload)
}

// 同样适用于可空类型 T? 的解包
if user.email is Some(addr) && addr.ends_with("@jenny.dev") {
    send_welcome(addr)
}
```

### 5.3 线性提前返回守卫：`guard ... else`
为了保持函数主干逻辑处于最外层缩进（黄金路径不缩进），提供 Swift 风格的 **`guard` 语句**：
* `else` 块内**必须以改变控制流的语句结尾**（`return`、`raise`、`break`、`continue` 或返回 `never` 的函数），编译器强制校验。
* 解构绑定的变量在 `guard` 语句之后的**整个当前外层作用域内直接可用**。

```jenny
pub fn handle_packet(ev: NetEvent) -> usize ! NetError {
    // 若不匹配 Message，立即在 else 中提前中断；若匹配，sender 与 payload 直接在下方主干作用域生效！
    guard ev is NetEvent.Message { sender, payload } else {
        raise NetError.UnexpectedEvent
    }

    guard payload.len >= 4 else {
        return 0
    }

    return payload.len
}
```

---

## 6. 语言语法糖白盒底座与跨语言动态桥接 (`std::core` & `Any`)

### 6.1 `std::core` 七大语言原语白盒蓝图映射表
Jenny 坚持 **“编译器前端语法糖 + `std::core` 白盒 `.jni` 契约 + 后端寄存器级布局优化”** 的统一架构，绝不将基础类型原语藏入不可见的编译器黑盒：

| 语言语法糖 / 原语 | `std::core` 白盒模块 | 核心类型与契约能力 |
| :--- | :--- | :--- |
| `T?`, `null`, `??` | `std::core::option` | `Option<T>`（`Some(T)` / `None`），空位优化（Niche Optimization） |
| `T ! E`, `?`, `!` | `std::core::result` | `Result<T, E>`（`Ok(T)` / `Err(E)`），双寄存器返回 ABI |
| `pub error`, `T!` | `std::core::error` | `Error` Trait、64 位 `[TypeHash32 \| VariantHash32]`、16 字节 `AnyError`、16 槽位 `ErrorTrace` 调用栈环 |
| `(A, B)`, `(A, B, C)` | `std::core::tuple` | `Pair<A, B>`、`Triple<A, B, C>`、`@spin` 变参 `Tuple<...Ts>`、字典序比较 `lex_cmp` 与复合哈希 `hash_combine` |
| `a..b`, `a..=b` | `std::core::range` | `Range`（半开/闭区间转换、`len`、`contains`、`clamp`、`overlap`） |
| `==`, `<`, `<=`, `>` | `std::core::cmp` | `Ordering`（`Less`/`Equal`/`Greater`）、`Eq`/`Ord`/`Hash`/`Clone`/`Drop` Trait、`min`/`max`/`clamp` |
| 动态语言/异构值交互 | `std::core::any` | 16 字节免装箱强校验动态值容器 `Any`（含 `AnyKind.Extern` 外部宿主句柄） |

### 6.2 受控动态类型 `std::core::any::Any`（零装箱 16 字节值 + 外部动态句柄桥接）
在与 Python（`PyObject*`）、JavaScript / TypeScript（Wasm `externref` / `napi_value`）、Lua 或无 Schema 的 JSON / MessagePack / LLM Tool-Calling 参数交互时，静态结构体无法预先穷尽动态树结构。但若像 TypeScript `any` 那样允许静默跳过类型检查，又会彻底摧毁静态类型安全。

为此，Jenny 在 `std::core::any` 中提供**受控、零隐式污染、免堆装箱的 16 字节 `Any` 值类型**（注意：`Any` 是标准库显式类型而非泛滥关键字）：

1. **16 字节栈内联物理布局（标量 100% 零堆分配）**：
   * `{ kind: AnyKind (u32), aux: u32, payload: u64 }`（共 16 字节，2 个 64 位寄存器直接传值）：
     * `AnyKind.Null (0)`：空值；
     * `AnyKind.Bool (1)` / `AnyKind.Int (2)` / `AnyKind.Float (3)`：`bool`、`i64`、`f64` 直接内联存储在 `payload` 64 位槽中，**绝不像 Java/Python 那样为整数分配堆对象（Zero Boxing）**；
     * `AnyKind.Str (4)` / `AnyKind.List (5)` / `AnyKind.Map (6)`：引用 SSO 字符串、托管动态列表或键值字典；
     * `AnyKind.Extern (7)`：携带 `runtime_id: u32`（标识宿主引擎：如 `1 = CPython`、`2 = WasmExternRef`、`3 = QuickJS/V8`）与 64 位不透明宿主句柄 `handle: u64`。
2. **三大安全铁律（防止动态类型污染静态核心）**：
   * **禁止隐式赋予静态类型**：`val x: i64 = dyn_val` 直接触发编译期类型错误，彻底杜绝 TypeScript `any` 的传染性失控；
   * **强制显式模式窄化或契约解包**：必须通过 `if dyn_val is Any.Int(n)`、`match dyn_val` 或带前置契约的 `dyn_val.as_i64()?`（失败返回 `TypeError.KindMismatch`，自动记录 `ErrorTrace` 调用栈）才能进入静态代码域；
   * **零拷贝跨语言宿主桥接**：Python C-API 返回的 `PyObject*` 或 Wasm 传入的 `externref` 可直接封装为 `Any.from_extern(runtime_id, handle)` 在管道中流转，仅在提取具體字段时按需窄化。

