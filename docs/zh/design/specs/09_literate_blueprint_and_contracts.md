# Jenny 语言规范 —— 模块九：文学化架构蓝图（`.jni`）与一等公民契约系统 (Literate Blueprints & Design by Contract)

> **状态**：已定稿 (v1.0-spec)  
> **核心母题**：将“原生 Markdown 文档”加冕为一等公民！人类只读写排版优美的 `<module>.jni` 文学化架构蓝图（形式化接口与契约块默认在 IDE 中折叠为状态胶囊），AI 自动在幕后生成并维护 `<module>.jn` 实现代码，编译器通过形式化契约（`requires` / `ensures` / `invariant` / `@example`）执行零信任自动验收。

---

## 1. `.jni` 文学化架构蓝图规范 (Literate Markdown Blueprint)

### 1.1 顶层 Markdown 自由文本与 ```` ```jenny ```` 契约块分流
* **顶层语法即标准 Markdown**：
  * `.jni` 文件的顶层解析器直接忽略所有非代码块区域，允许人类无拘无束地使用 Markdown 标题、段落、表格、Mermaid 流程图与 LaTeX 公式阐述业务背景与设计意图（**彻底废除 `///` 文档注释符号**）。
  * 编译器不对 Markdown 正文施加任何语法限制，确保人类书写体验如丝般顺滑。
* **形式化契约块（```` ```jenny ... ``` ````）**：
  * 编译器前端仅提取 `.jni` 文件中所有标记为 `jenny` 的围栏代码块（Fenced Code Blocks），按自上而下的出现顺序拼接构成该模块的**形式化接口蓝图 AST（Blueprint AST）**。
  * **IDE 默认折叠胶囊**：在支持 Jenny LSP 的编辑器中，`.jni` 内的 ```` ```jenny ```` 块默认折叠为单行可视化状态徽章：
    `▶ [✓ 契约已验证 | effects [IO] | (path: str) -> *Image ! IoError | 4/4 用例通过]`

### 1.2 `.jni` 与 `.jn` 的双向同构绑定铁律
每个模块由同名的 `<module>.jni`（蓝图）与 `<module>.jn`（实现）配对组成：
1. **公开契约唯一真相源（Single Source of Truth）**：所有 `pub` 与 `pkg` 级别的 `struct`、`enum`、`view struct`、`trait` 及函数签名必须在 `.jni` 的 ```` ```jenny ```` 块中声明。
2. **`.jn` 纯实现职责**：
   * `<module>.jn` 仅包含对 `.jni` 中已声明函数的具体函数体实现，以及模块内部私有的辅助函数/数据结构。
   * **签名免重复或严格校验**：在 `.jn` 中实现 `.jni` 声明的函数时，编译器强制校验两者的参数、返回类型与 `effects` 100% 一致；`.jni` 中已声明的 `requires`、`ensures`、`invariant` 无需在 `.jn` 中重复书写，由编译器在中端 IR（MIR）阶段**自动织入（Weave-in）**函数入口与出口！

---

## 2. 一等公民形式化契约语法 (First-Class Contract System)

为了使人类无需打开 `.jn` 阅读具体实现即可 100% 掌控代码行为，Jenny 在 `.jni` 的函数与类型声明中内建四大形式化契约原语：

### 2.1 前置条件契约：`requires <cond> [else <error_expr>]`
* **语义**：声明调用该函数时实参必须满足的布尔断言。
* **自动错误映射（免手写参数校验）**：
  * 当函数返回类型为 `T ! E` 时，支持书写 `requires cond else ErrorVariant`。
  * **编译器自动代码生成**：编译器直接在 `.jn` 函数体入口处自动插入 `if !(cond) { raise ErrorVariant }`！AI 在编写 `.jn` 时无需再写冗余的参数边界校验代码，可直接进入核心算法逻辑。

### 2.2 后置保证契约：`ensures <cond>`
* **语义**：声明函数正常返回（未触发 `raise`）时，返回值与对象状态必须满足的承诺。
* **专用内建标识符**：
  * **`result`**：指代函数的成功返回值（如 `ensures result >= 0.0 && result <= 1.0`）。
  * **`old(expr)`**：指代函数进入前某表达式或字段的快照值（仅用于 `&mut self` 方法，如 `ensures self.len == old(self.len) + 1`）。

### 2.3 数据结构不变量：`invariant <cond>`
* **语义**：声明在 `struct` 或 `view struct` 内部，規定该类型实例在构造完成时、以及任何公开方法（`pub fn`）调用前后必须恒成立的状态约束（如 `invariant self.len <= self.cap`）。

### 2.4 内联黄金验收用例：`@example <expr> == <expected>`
* **语义**：直接挂载在函数声明下方的输入-输出契约锚点。
* **编译期 Meta-VM 即时自动执行**：
  * 对于无外部 `IO` 副作用的函数（或使用编译期 Mock 数据的函数），编译器在完成 `.jn` 编译后，**立即在内置的确定性沙箱虚拟机（Meta-VM）中执行所有 `@example` 断言**！
  * 若任一 `@example` 求值结果不等于预期值（或抛出了非预期的错误），**编译直接判定失败**，并将实际输出与预期输出的差异通过 `--ai-json` 反馈给 AI Coding Agent 强制重修 `.jn`！

---

## 3. “三步渐进式纺纱”人机协同工作流 (Three-Stage Progressive Weaving)

```
┌────────────────────────────────────────────────────────────────────┐
│ Step 1: 人类架构师在 <module>.jni 中用原生 Markdown 写下设计意图     │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ 执行 `jenny spec`
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Step 2: AI 读取 Markdown，在章节下自动生成可折叠的 ```jenny 契约块   │
│         (含 *T/^T 内存拓扑、effects、requires/ensures、@example)   │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ 执行 `jenny weave`
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Step 3: AI 在幕后生成 <module>.jn 实现，编译器执行零信任契约验收：   │
│         • 静态校验签名、双轨内存安全与 effects 纯度                 │
│         • 自动织入 requires / ensures / invariant 守卫             │
│         • 在 Meta-VM 中实测全部 @example，未通过则自动打回 AI 重写  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 4. 完整实战范例：`ring_buffer.jni` 与幕后 `ring_buffer.jn`

### 4.1 人类读写的蓝图文件：`ring_buffer.jni`
````markdown
# 零拷贝定长环形缓冲区 (`ring_buffer`)

本模块提供用于硬实时音频/网络管线的原生堆环形缓冲区。
- **内存策略**：缓冲区分配于 Native Heap（`*RingBuffer<T>`），支持 `*in(arena)`，**100% 零 GC 参与**。
- **容量规则**：初始化容量 `capacity` 必须大于 0；写入满缓冲区时返回 `BufferFull` 错误，绝不隐式扩容。

```jenny
blueprint ring_buffer

pub enum RingError {
    InvalidCapacity,
    BufferFull,
}

pub struct RingBuffer<T: TrivialCopy> {
    buf: *mut c_raw<T>,
    cap: usize,
    len: usize = 0,
    head: usize = 0,
    tail: usize = 0,

    invariant self.cap > 0
    invariant self.len <= self.cap
    invariant self.head < self.cap && self.tail < self.cap
}
```

## 创建与读写操作

1. **`with_capacity`**：分配指定元素容量的原生环形缓冲区；若 `cap == 0` 则拒绝并抛出 `InvalidCapacity`。
2. **`push`**：向队尾追加一个元素，成功后当前长度严格加 1；若已满则抛出 `BufferFull`。
3. **`pop`**：从队首弹出一个最老的元素；若缓冲区为空则返回 `null`。

```jenny
impl<T: TrivialCopy> RingBuffer<T> {
    pub fn with_capacity(cap: usize) -> *RingBuffer<T> ! RingError
        effects []
        requires cap > 0 else RingError.InvalidCapacity
        ensures  result.cap == cap && result.len == 0

    pub fn push(mut self, item: T) -> void ! RingError
        effects []
        requires self.len < self.cap else RingError.BufferFull
        ensures  self.len == old(self.len) + 1

    pub fn pop(mut self) -> T?
        effects []
        ensures  if old(self.len) == 0 { result == null } else { self.len == old(self.len) - 1 }

    @example {
        var rb = RingBuffer::<i32>::with_capacity(2)?
        rb.push(10)?
        rb.push(20)?
        assert(rb.push(30) == RingError.BufferFull)
        assert(rb.pop() == 10 && rb.pop() == 20 && rb.pop() == null)
    }
}
```
````

### 4.2 AI 在幕后自动生成的实现文件：`ring_buffer.jn`（人类日常无需打开）
```rust
module ring_buffer

// 注意：requires 参数校验、ensures 后置断言与 invariant 检查已由编译器从 .jni 自动织入！
// AI 生成的 .jn 代码只需专注纯粹的核心状态变更逻辑：
impl<T: TrivialCopy> RingBuffer<T> {
    pub fn with_capacity(cap: usize) -> *RingBuffer<T> ! RingError {
        val raw = mem::alloc_array::<T>(cap)
        return *RingBuffer<T> {
            buf: raw,
            cap: cap,
        }
    }

    pub fn push(mut self, item: T) -> void ! RingError {
        mem::write_at(self.buf, self.tail, item)
        self.tail = (self.tail + 1) % self.cap
        self.len += 1
    }

    pub fn pop(mut self) -> T? {
        guard self.len > 0 else {
            return null
        }
        val item = mem::read_at(self.buf, self.head)
        self.head = (self.head + 1) % self.cap
        self.len -= 1
        return item
    }

    fn drop(own self) {
        mem::free_array(self.buf, self.cap)
    }
}
```
