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
            writer.write_field(&self.$(f.ident()))?
        })
        decode_fields.push(quote {
            $(f.ident()): reader.read_field::<$(f.type_info())>()?,
        })
    }

    return quote {
        impl BinaryCodec for $(target.ident()) {
            pub fn encode(&self, writer: &mut ByteWriter) -> void ! IoError 
                effects [IO] 
            {
                $(...encode_stmts)
            }

            pub fn decode(reader: &mut ByteReader) -> $(target.ident()) ! IoError 
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

## 4. `@spin if`：泛型特征分支与跨平台条件编译

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

## 5. `.spun/` 白盒落盘与确定性沙箱虚拟机 (Meta-VM)

### 5.1 `.spun/` 一等公民源码体验
1. **格式化可读落盘**：每次执行 `jenny build`、`jenny check` 或 `jenny spin --inspect` 时，Stage 2 虚拟机将所有 `@spin` 产物通过官方 Formatter 格式化后写入项目根目录的 **`.spun/<module_path>.spun.jn`**。
2. **真实行号映射（Zero-Blackbox Debugging）**：
   * 在 IDE 中对 `packet.encode(&mut writer)` 执行 **Go to Definition（跳转到定义）**，编辑器直接打开 `.spun/models.spun.jn` 的第 4 行！
   * 运行时发生错误或断点单步进入生成方法时，调试器直接停在 `.spun/models.spun.jn` 的真实源码行上。
3. **编译期 DAP 断点调试**：开发者可在 `@spin fn derive_binary_codec` 内部的 `for f in target.fields()` 处直接打断点，运行 `jenny debug-spin` 即可在 IDE 中单步观察 `encode_stmts` 是如何一行行纺出的。

### 5.2 100% 确定性沙箱铁律 (Deterministic Sandbox)
为确保任何机器、任何时间以及增量编译缓存（Incremental Compilation Cache）下的构建结果 **100% 比特级一致（Reproducible Builds）**，运行 `@spin` 的内置字节码虚拟机（Meta-VM）执行严格沙箱隔离：
* **绝对禁止**：发起网络 Socket 请求、获取系统实时时钟、读取硬件随机数、读写项目外的宿主文件系统或执行外部 Shell 进程。
* **受控静态资产读取**：仅允许通过 `@spin.include_str("schema.sql")` 或 `@spin.include_bytes("icon.png")` 读取项目目录内的静态文件，且编译器自动将该文件納入增量构建的哈希依赖图中。
