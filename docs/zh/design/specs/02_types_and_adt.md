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

### 1.2 元组、固定长度数组、切片与动态数组的正交区分
为了消除 C/C++/Go 中数组与切片概念混淆的痛点，Jenny 严格区分以下四种序列/聚合形态：

1. **元组 `(T1, T2, ...)`**：匿名积类型，按值内联在栈或父结构体中，支持 `.0`、`.1` 下标访问与模式解构。
2. **固定长度值数组 `[N]T`**（如 `[4]f32`、`[256]u8`）：
   * 编译期已知长度 `N`（`usize` 常量），**100% 内联存储在栈上或结构体内部**，无任何额外堆分配或头信息。
   * 与 C 语言数组 `T[N]` 的物理内存布局完全一致，可直接嵌入 `@repr(C) struct` 零拷贝传给 C 函数。
3. **借用切片视图 `[]T` / `mut []T`**：
   * 栈绑定胖指针 `{ ptr: *T, len: usize }`（16 字节），是对连续内存（来自 `[N]T`、`*Array<T>`、`^Array<T>` 或 C 缓冲区）的局部非拥有视图。
4. **动态扩容数组 `Array<T>`**：
   * 标准库一等泛型容器（`{ buf, len, cap }`），可根据前缀分配为 `*Array<T>`（原生堆唯一所有权）、`^Array<T>`（GC 托管共享）或栈上值容器。

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
* **高频构建与修改**：当需要循环拼接或原地修改字节时，使用标准库的 `StringBuilder`（内部基于 `Array<u8>`），构建完毕后调用 `.into_string()` 零拷贝转为 `String`。

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

## 4. 和类型：`enum`（代数数据类型与内存空位优化）

### 4.1 统一和类型定义
Jenny 的 `enum` 既是传统的 C 风格枚举，也是完整的代数和类型（Tagged Union），每个变体（Variant）可携带无负载、元组负载或具名结构体负载：

```rust
pub enum NetEvent {
    Connected,                                      // 单元变体
    Ping(u64),                                      // 元组负载变体
    Message { sender: String, payload: *Buffer },   // 具名结构体负载变体（内部可含 *T 或 ^T）
}
```

### 4.2 递归数据类型与空位优化 (Niche Optimization)
1. **直观的递归定义**：得益于显式的 `*T` 与 `^T`，定义 AST 或树结构时无需像 Rust 那样套一层 `Box<T>`，直接用 `*Expr`（原生堆树，可配合 `*in(arena)`）或 `^Expr`（GC 托管树）：
   ```rust
   pub enum Expr {
       Number(f64),
       Add { left: ^Expr, right: ^Expr },
   }
   ```
2. **零开销可空优化（Niche Filling）**：
   * 内置可空类型 `T?` 本质上是 `enum Option<T> { Some(T), None }`（字面量 `null` 即 `None`）。
   * 当 `T` 为非空指针/引用类型（`*U`、`^U`、`&U`、`&mut U`、函数指针）时，编译器保证 **`(*U)?` 与 `*U` 的物理大小严格相等（64 位下均为 8 字节）**，直接使用全零地址 `0x0` 表示 `null`。

---

## 5. 模式匹配系统：`match`、`is` 与 `guard`

为了同时满足函数式模式解构的表达力与过程式控制流的扁平可读性，Jenny 规定了三种正交且无歧义的模式匹配语法（**彻底废除语义晦涩的 `if let` 与 `let ... else`**）：

### 5.1 全分支穷尽匹配：`match` 表达式
* **强制穷尽性（Exhaustiveness）**：编译器静态验证 `match` 必须覆盖所有可能的变体或数值区间，遗漏分支将直接报错（AI 诊断器自动生成缺失分支骨架）。
* **支持嵌套解构、守卫条件（`if`）与区间匹配**：

```rust
pub fn describe_event(ev: &NetEvent) -> String {
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

```rust
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

```rust
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
