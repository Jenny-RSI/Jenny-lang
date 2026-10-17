# Jenny 语言规范 —— 模块一：AI 原生双轨内存与参数意图模型 (AI-Native Dual-Track Memory & Parameter Passing Modes)

> **状态**：已定稿 (v2.0 — AI-Native 演进版)  
> **核心突破**：彻底抛弃传统语言（C++/Rust）将“物理存储位置”与“参数传递方式”混为一谈的历史包袱（**全面废除 `&T`、`&mut T`、`&*T`、`&^T` 等套娃引用符号**）；确立 **“存储层双轨分流（`T` / `*T` / `^T`） $\times$ 参数层三态意图（默认只读借用 / `mut` 原地修改 / `own` 所有权移交）”** 的正交架构，让 AI 生成代码实现 **0 借用/移动幻觉报错**，让人类阅读 `.jni` 蓝图一目了然。

---

## 1. 为什么站在 AI 视角必须重构传统内存模型？

在传统手写编程语言（如 Rust）中，为了控制内存，引入了 `&T`、`&mut T` 借用指针类型以及“传参默认隐式 Move（移动后原变量失效）”的规则。然而站在 **大语言模型（LLM）自回归生成与人类阅读 `.jni` 蓝图** 的视角下，旧模型暴露出三大致命缺陷：

1. **隐式 Move 是 LLM 的第一大报错温床**：LLM 从上往下逐行生成代码，若在第 10 行调用只读辅助函数 `check(buf)` 时不小心按值传递触发了隐式 Move，到第 25 行再次使用 `buf` 时就会触发 `Use of moved value` 崩溃。
2. **物理存储与借用符号叠加导致视觉灾难**：当双轨堆指针（`*T`、`^T`）与借用符号（`&`、`&mut`）组合时，会产生 `&*AudioChunk`、`&mut ^TrackNode` 等反人类的符号噪音。
3. **手动标注 `view struct` 的冗余负担**：一个结构体是否包含切片视图（`[]T` / `str`），编译器在解析完字段的瞬间即可 100% 静态获知，无需强迫人类或 AI 手动添加额外关键字。

为此，Jenny v2.0 将内存模型解耦为两个完全正交的维度：**【维度一：数据存储拓扑（对象住在哪里）】** 与 **【维度二：参数传递意图（函数如何对待输入）】**。

---

## 2. 维度一：数据存储三态体系 (`T` vs `*T` vs `^T`)

在定义结构体字段、局部变量与返回值时，仅存在三种纯粹的数据存储形态（**语言中不再存在 `&T` 类型**）：

| 存储语法 | 规范名称 | 物理存储区域 | 所有权与赋值语义 | 核心应用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **`T`** | **内联值 / 视图 (Value / View)** | 调用栈 (Stack) 或直接内联于父容器内部 | 纯值类型按位拷贝（`TrivialCopy`）；若内部包含 `*U` 字段则具备唯一所有权属性（`UniqueMove`） | 基础标量、小型向量（`Vec3`）、不可变 SSO `String`、切片视图（`[]T` / `str`） |
| **`*T`** | **原生独占指针 (Native Box Pointer)** | **Native Heap**（全局 `mimalloc`、自定义 `*in(arena)` 或 Wasm Linear Memory） | **唯一所有权（Single-Owner）**。离开词法作用域自动触发 `drop()` 并立即释放内存 | C 语言结构体零拷贝映射、音视频/图形缓冲区、硬实时零 GC 路径 |
| **`^T`** | **托管共享句柄 (Managed Shared Handle)** | **Managed Heap**（可插拔并发 Immix GC / 优化 ARC，或 WasmGC `structref`） | **多所有者自由共享**。赋值与传参仅拷贝轻量句柄，天然支持图结构与循环引用 | 复杂业务领域图/树结构、UI 状态树、闭包共享环境 |

---

## 3. 维度二：参数传递三态意图模式 (Parameter Passing Modes)

Jenny **彻底废除 `&T` 与 `&mut T` 引用类型符号**。在函数与方法签名中，直接通过参数前缀修饰符声明**对实参的访问与所有权意图**（借鉴 Val/Hylo 与 Swift 值语义的最新理论突破）：

| 参数声明语法 | 传递模式名称 | 语义契约与底层实现 | 调用方语法与 AI 友好度收益 |
| :--- | :--- | :--- | :--- |
| **`x: T`**<br>*(默认，无修饰符)* | **只读借用模式**<br>(Read-Only Borrow / `in`) | **90% 场景的默认行为**！函数仅读取 `x`，绝不修改它，也**绝不夺走它的所有权**。<br>• 底层实现：标量走寄存器传值；大结构体、`*T`、`^T` 自动由编译器按只读地址传入（零拷贝，且对 `T`/`*T` 自动适配）。 | 直接写 `foo(x)`。<br>🌟 **AI 零 Move 报错**：调用任何默认参数函数后，原变量 `x` **100% 继续有效**！且传参时 `*T`、`^T`、`T` 可自动解引用匹配 `x: T`！ |
| **`mut x: T`**<br>*(或 `mut self`)* | **原地修改模式**<br>(In-Place Mutation / `inout`) | 函数需要在原地修改 `x` 的内容，但修改完后所有权仍归调用方。<br>• 底层实现：编译期传入可变借用指针，并在当前调用期间锁定独占性（防止容器重分配悬垂）。 | 调用方传入可变变量（如 `arr.push(...)` 或 `fill(mut buf)`），修改意图在签名上一目了然。 |
| **`own x: T`**<br>*(或 `own self`)* | **所有权移交模式**<br>(Ownership Transfer / `sink`) | 函数正式**接管（吞掉）** `x` 的所有权（如将其存入容器、跨线程发送给别的 `Fiber`、或在 `drop(own self)` 中销毁）。 | **调用处必须显式写 `own x`**（如 `list.push(own chunk)`）！<br>🌟 **消灭隐式 Move 陷阱**：只有写了 `own` 的地方变量才会失效，人类与 AI 一眼看穿所有权去向！ |

### 代码对比：看看干掉 `&`、`&mut`、`&*`、`&^` 后的极致清爽！

```rust
// ❌ 旧版（Rust 混合风）：充满 &self、&mut self、&*PcmFrame、&^TrackNode 等符号噪音
// pub fn process(node: &^TrackNode, frame: &*PcmFrame, out: &mut Buffer) -> usize

// ✅ Jenny v2.0（AI 原生参数模式）：零 & 符号！意图自解释！
pub struct TrackNode {
    pub title: String,
    pub frame: *PcmFrame,     // 独占拥有一帧原生音频
    pub next: ^TrackNode?,    // 共享指向下一个托管图节点
}

// 1. 默认只读借用：node 与 frame 均为只读借用，不转移所有权，且自动解引用适配 * 与 ^！
pub fn inspect_node(node: TrackNode, frame: PcmFrame) -> usize 
    effects [] 
{
    return frame.length
}

// 2. mut 原地修改 与 own 显式所有权接管：
impl<T> Array<T> {
    // mut self 表示原地修改数组；own item 表示数组正式接管 item 的所有权！
    pub fn push(mut self, own item: T) {
        if self.len == self.cap { self.grow() }
        self.buf.write_at(self.len, own item)
        self.len += 1
    }

    // self 默认只读借用；返回只读借用投影（或者可空拷贝）
    pub fn len(self) -> usize {
        return self.len
    }

    // own self 表示消费并销毁自身
    fn drop(own self) {
        @spin if T is UniqueMove {
            for i in 0..self.len {
                drop(own self.buf.read_and_take(i))
            }
        }
        self.buf.dealloc()
    }
}
```

---

## 4. 切片视图 (`[]T` / `str`) 与编译器自动栈绑定推导 (Auto-View Inference)

### 4.1 告别手写 `view struct` 与生命周期 `'a`
在模块一早期版本中，为了允许结构体包含切片 `[]T` 或 `str`（用于零拷贝解析），曾要求用户显式声明 `view struct`。
站在 AI 原生视角下，**这一区分完全由编译器 100% 自动完成**：
1. **自动视图传染推导（Automatic Stack-Bound Inference）**：
   * 用户只需统一声明普通的 `pub struct HttpHeader { pub name: str, pub value: str }`。
   * 编译器在解析字段时检测到 `str` 或 `[]T`（借用切片），自动在类型表内将该结构体标记为 **栈绑定视图（Stack-Bound View）**。
2. **安全边界与免 `'a` 交集规则**：
   * 含切片的结构体自动禁止被装箱为 `*HttpHeader` 或 `^HttpHeader`（防止悬垂指针逃逸到堆上）。
   * 当函数返回切片或含切片的结构体时（如 `fn parse_kv(line: str) -> KvPair?`），编译器自动将返回值的有效生命周期绑定为**输入只读借用参数的交集生命周期**，在保持 100% 内存安全的同时，彻底免除 `<'a>` 语法和 `view` 关键字！

### 4.2 零成本内联生成器 (`iter fn` & `yield`)
容器遍历与流式生成统一使用 `iter fn` + `yield`，在 MIR 阶段通过流融合优化（Stream Fusion）100% 内联展开为普通循环：

```rust
impl<T> Array<T> {
    // self 默认只读借用，yield 产出的元素在循环体内作为只读借用视图访问
    pub iter fn iter(self) -> T {
        for i in 0..self.len {
            yield self.buf.ref_at(i)
        }
    }
}
```

---

## 5. 局部借用安全、跨堆互指与 `@scoped` 线性资源

### 5.1 局部突变排他保护（防止容器扩容悬垂）
* 在执行 `mut x` 原地修改调用期间，编译器在当前栈帧静态确保没有指向 `x` 内部连续缓冲区的活跃切片或迭代视图（无论 `x` 是栈值、`*Array` 还是 `^Array`），从根源上杜绝一边遍历容器一边 `push` 扩容导致的 Use-After-Free。
* 而对于多个 `^T` 托管句柄之间的普通字段读写，完全允许像 Go/C# 一样自由别名操作。

### 5.2 原生堆 Arena 区域分配 (`*in(arena)`)
```rust
var arena = Arena::with_capacity(64 * 1024)
val packet = *in(arena) PacketHeader { magic: 0x4A4E, payload_len: 128 }
// 离开 arena 作用域时 O(1) 整块回收，且编译器禁止 *in(arena) 指针逃逸出当前作用域
```

### 5.3 跨堆引用与 `@scoped` 线性作用域资源
1. **跨堆互指自动维护**：`^A` 持有 `*B` 时由 GC 终结器自动级联触发 `*B.drop()`；`*A` 持有 `^B` 时由编译器自动内联 **Cross-Heap Root Table**（Wasm 下映射为 `table<anyref>` 槽位索引）保护 `^B`。
2. **`@scoped` 线性系统资源**：标注了 `@scoped` 的类型（如 `File`、`Socket`、`MutexGuard`）静态禁止存入 `^T` 托管堆，强制在栈作用域退出或 `*T` 销毁瞬间确定性释放系统句柄。
