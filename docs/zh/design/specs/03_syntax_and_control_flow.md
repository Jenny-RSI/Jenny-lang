# Jenny 语言规范 —— 模块三：词法、正交语法与控制流 (Lexical Structure, Canonical Syntax & Control Flow)

> **状态**：已定稿 (v1.0-spec)  
> **核心公理**：正交无歧义语法（Canonical & Orthogonal Syntax）—— 严格遵循上下文无关文法（CFG），同一种逻辑语义在语言中**有且仅有一种标准写法**，最大化人类可读性与 AI 生成准确率。

---

## 1. 词法结构与正交声明规范 (Lexical & Declaration Rules)

### 1.1 变量绑定：`val` 与 `var`
Jenny 强制在声明变量时显式区分可变性，废除 `const` / `let` 的重叠概念：
* **`val`（不可变绑定，默认推荐）**：绑定后不可重新指向其他值或修改其栈内字段；对于 `*T`，不可修改其指向的对象。
* **`var`（可变绑定）**：允许重新赋值或通过 `&mut` 修改内部状态。
* **局部类型推导与签名强制显式**：
  * 函数体内部的局部变量支持双向类型推导（如 `val count = 0` 默认为 `i32` 或根据下文推导）。
  * **函数、方法与结构体字段签名禁止省略类型**，保证 100% 的上下文局部性（Locality）。

### 1.2 分号省略与换行续行规则 (Automatic Semicolon Insertion)
* **默认无分号**：语句以换行符（`\n`）自然结束；单行书写多条语句时才需用 `;` 分隔。
* **无歧义多行续行规则**：当一行以**二元运算符**（如 `+`、`&&`）、**管道符**（`|>`）、**逗号**（`,`）或**未闭合括号**（`(`、`[`、`{`）结尾，或下一行以 `.`（链式方法调用）或 `|>` 开头时，词法分析器自动将其视为同一语句的延续。

### 1.3 运算符优先级与无冲突设计
* **彻底废除 C 风格三元运算符 `cond ? a : b`**：从而将问号 `?` 100% 释放给可空类型后缀 `T?` 与错误传播后缀 `expr?`，词法分析零歧义。
* **彻底废除 C 风格前置/后置自增 `++i` / `i++`**：修改变量只能作为独立语句写 `i += 1`，杜绝表达式求值顺序未定义行为。

---

## 2. 函数、块表达式与返回规则 (Functions & Expressions)

### 2.1 具名函数必须显式 `return`
为了消除 Rust 中“少写一个分号就意外变成返回值”的心智陷阱：
* 任何返回类型非 `void` 的具名函数（`fn`）与多行闭包，其所有控制流出口**必须显式书写 `return expr`**。

### 2.2 `if / else` 与 `match` 作为一等值表达式
虽然具名函数体强制显式 `return`，但 `if / else` 和 `match` 本身可作为值表达式直接参与赋值或 `return`，完美替代三元运算符：

```rust
pub fn clamp_score(raw: i32) -> i32 {
    // if/else 直接作为值表达式求值，清晰且无 ? : 符号冲突
    val normalized = if raw < 0 {
        0
    } else if raw > 100 {
        100
    } else {
        raw
    }
    return normalized
}
```

### 2.3 调用处具名参数与默认参数 (Named & Default Arguments)
为了消除人类阅读代码时的“魔法布尔值/魔法数字（如 `foo(buf, true, false, 4)`）”困惑，并防止 AI 在生成多参数调用时搞混相同类型参数的顺序：
* **原生支持调用处具名参数 `param_name: expr`**：在调用任何函数或方法时，均可携带形参名标签（如 `resample(frame, ratio: 0.5, high_quality: true)`）。
* **布尔字面量与默认参数强制具名规则**：当实参为裸布尔字面量（`true`/`false`）或跳过前方可选默认参数时，编译器推荐/要求显式书写参数名标签，确保调用意图 100% 自解释。

---

## 3. 正交控制流与 RAII 资源收口 (Orthogonal Control Flow)

### 3.1 唯一标准循环原语：`for .. in` 与 `while`
Jenny 废除传统的三段式 `for (init; cond; step)`、`do-while` 以及冗余的 `loop` 关键字，仅保留两种正交循环：

1. **序列与区间迭代 `for`**：
   * 左闭右开区间：`for i in 0..n { ... }`
   * 闭区间：`for i in 0..=n { ... }`
   * 容器/生成器解构遍历：`for idx, item in list.enumerate() { ... }`
2. **条件与无限循环 `while`**：
   * 条件循环：`while queue.is_not_empty() { ... }`
   * 无限循环：统一标准写法为 **`while true { ... }`**（编译器静态识别 `while true` 为无条件循环，在控制流图 MIR 中享受与专用 `loop` 完全相同的到达性分析与 `never` 类型推导）。
   * 支持带标签的嵌套跳出：`break :outer` 与 `continue :outer`。

### 3.2 为什么不设 `defer`：100% 收口于 `drop()` 与 `@scoped`
遵循“同一种语义有且仅有一种标准写法”的公理，Jenny **不引入 `defer` 语句**：
* 若同时存在 `drop(mut self)`（RAII）与 `defer`，人类与 AI 在管理 C 指针、文件或锁时将面临两种机制混用的割裂感，且 `defer` 容易在循环体内被误写为函数退出才执行。
* 在 Jenny 中，**一切资源清理（包括原生堆 `*T`、C 语言句柄、互斥锁守卫）100% 统一通过结构体的 `fn drop(mut self)` 与 `@scoped` 线性作用域生命周期自动触发**。

---

## 4. 闭包（Closures）与双轨内存捕获规则

### 4.1 统一闭包语法（拒绝 `|x|` 竖线歧义）
为了避免 Rust 的 `|x|` 语法与按位或 `|`、逻辑或 `||` 及管道符 `|>` 产生视觉与语法冲突，Jenny 复用 `fn` 关键字定义闭包：
* **单表达式闭包**：`fn(x) => x * 2` 或带显式类型 `fn(x: i32) -> i32 => x * 2`
* **多语句块闭包**：
  ```rust
  val processor = fn(item: &Record) -> bool {
      if !item.is_valid() {
          return false
      }
      return item.score > 60
  }
  ```

### 4.2 双轨内存下的闭包捕获与逃逸规则
闭包对外部词法作用域变量的捕获策略，与模块一的双轨内存模型严密咬合：

| 闭包使用场景 | 默认捕获行为 | 闭包自身的内存轨道与生命周期 |
| :--- | :--- | :--- |
| **1. 非逃逸局部闭包**（如直接传给 `map`/`filter`/`par_map`） | **默认按借用捕获（`&T` / `&mut T`）** | 闭包环境直接内联分配在当前栈帧（二等公民视图），**零堆分配**，不会移走外部 `*T` 的所有权。 |
| **2. 逃逸闭包（仅捕获 `^T` 或 `TrivialCopy` 值）** | 自动复制句柄 `^T` 或按位拷贝基础值/`String` | 可被包装为托管闭包 **`^fn(A) -> B`**，自由存入结构体、跨函数返回或注册为 UI/异步事件回调。 |
| **3. 逃逸闭包（需捕获唯一所有权 `*T`）** | **必须显式声明移动捕获列表 `fn[move ptr](...)`** | 将 `*T` 的唯一所有权正式移入闭包内部（外部原变量立即失效），此时闭包自身成为 **`*fn(A) -> B`（单次/独占所有权闭包）**，销毁时自动级联释放内部持有的 `*T`。 |

```rust
pub fn make_uploader(buf: *ImageBuffer, endpoint: String) -> *fn() -> bool {
    // 逃逸闭包捕获唯一所有权指针 *ImageBuffer：必须使用 [move buf] 显式移入所有权！
    return *fn[move buf]() -> bool {
        return send_raw(endpoint, buf.pixels, buf.width * buf.height)
    }
}
```

---

## 5. 函数式管道操作符：`|>`（第一参数注入与 `_` 占位符）

为了将深层嵌套的函数调用 `collect(filter(map(items, f), p))` 转化为符合人类从左到右阅读直觉的线性数据流，Jenny 内置左结合管道操作符 **`|>`**：

### 5.1 语法降级规则（Desugaring Rules）
1. **默认第一参数注入（First-Argument Injection）**：
   * 当右侧调用未包含独立占位符 `_` 时，编译器自动将 `|>` 左侧表达式的求值结果作为右侧函数调用的**第一个实参**插入：
   * `x |> foo()` $\Longrightarrow$ `foo(x)`
   * `x |> bar(a, b)` $\Longrightarrow$ `bar(x, a, b)`
2. **显式位置占位符（Explicit Placeholder `_`）**：
   * 当目标函数的接收参数不在第一个位置时，可在实参列表中使用单个 `_` 指定注入位置：
   * `x |> write_to(stream, _, timeout)` $\Longrightarrow$ `write_to(stream, x, timeout)`
   * **唯一性约束**：每个 `|>` 右侧的直接实参列表中最多只能出现一个 `_`（求值一次，无重复求值副作用）。

```rust
// 数据流管道实战：兼具第一参数自动注入与 _ 精准位置绑定
val report = raw_text
    |> trim()
    |> split('\n')
    |> map(fn(line) => parse_entry(line))
    |> filter(fn(entry) => entry.is_active)
    |> format_table("Active Users", _) // 将过滤后的列表注入到第二个参数位置
```
