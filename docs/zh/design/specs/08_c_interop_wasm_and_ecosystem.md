# Jenny 语言规范 —— 模块八：白盒化 C 蓝图互操作、WebAssembly 双后端与工程生态 (White-Box C Interop, Wasm Dual-Backend & Toolchain Ecosystem)

> **状态**：已定稿 (v2.0-spec, 含 `std::ffi::c_abi` 与 `spindle bindgen-c` 实证)  
> **核心理念**：彻底废除传统业务模块直接引入无法审计的黑盒 C 头文件（`import c "header.h"`）。所有外部 C 库必须先通过 AI + `spindle bindgen-c` 提取为**白盒 `.jni` 蓝图**（像 `std::rt::intrinsics` 与 `std::ffi::c_abi` 一样），原生支持与 C 1:1 内存布局对齐的 **`@repr(C) struct`、`@repr(C) union` 与 `@bits(N)` 位域**，并自动织入前置/后置契约与位宽不变式；在 WebAssembly 后端首创 **Linear Memory (`*T`) + WasmGC (`^T`) + `table<anyref>` 跨堆根表** 的双轨合捻架构。

---

## 1. 白盒化 C 库 `.jni` 蓝图桥接与 1:1 C ABI 内存布局 (`@extern_c` & `spindle bindgen-c`)

### 1.1 为什么废除业务模块直接 `import c "header.h"`？
若允许普通 `.jn` / `.jni` 模块直接 `import c "header.h"`，外部 C 库将退化为无法静态审计的黑盒依赖：
* `Spindle` 无法在不解析任意 C 宏预处理器的情况下审计其内存副作用与能力边界；
* C 头文件缺乏前置条件（`requires`）、后置条件（`ensures`）与结构体位域越界不变式（`invariant`）；
* 下游调用方无法享受 `.jni` ABI 防火墙带来的 $O(1)$ 契约级语义版本（Contract-Verified SemVer）验证。

因此，Jenny 规定：**外部 C 库必须先通过 AI 辅助的 `spindle bindgen-c <header.h>` 生成白盒 `.jni` 蓝图模块（如 `std::ffi::c_abi`），业务代码仅 `import` 该白盒 `.jni` 模块！**（低层裸 `import c` 仅保留在受 `Tapestry.toml` `allow_effects = ["Unsafe"]` 显式授权的 FFI 封装层内，违者触发 `E0505_UNDECLARED_FFI_IMPORT`）。

### 1.2 1:1 C ABI 内存布局：`@repr(C)` `struct`、`union` 与 `@bits(N)` 位域
Jenny 在语言层完整支持 C99 的结构体、联合体与位域（Bitfields），并保证与 C 编译器完全一致的 1:1 物理字节与比特布局：
1. **`@repr(C) pub struct` 与 `@bits(N)` 位域**：
   * 字段支持 `@bits(N)`（或 `: N`）显式声明比特宽度（如 `pub version: u32 @bits(4) = 4`），直接降级为 C99 `uint32_t version : 4;`；
   * 编译器与 `spindle bindgen-c` 自动为每个 `@bits(N)` 位域织入位宽值域不变式 `invariant self.field >= 0 && self.field <= (2^N - 1)`，彻底消除 C 语言位域静默截断导致的逻辑漏洞。
2. **`@repr(C) pub union` 共享内存视图**：
   * 原生支持 `pub union Name { ... }`，直接映射为 C99 `typedef union Name { ... } Name;`，支持按指定成员初始化（如 `CWord32Union { raw_u32: val }` 或 `CWord32Union { halves: h }`）及零拷贝跨视图读取，无需像 Rust 那样将所有 `union` 字段读取包裹在冗长的 `unsafe { ... }` 块中。
3. **`@extern_c("c_symbol")` 白盒契约绑定**：
   * 在 `.jni` 蓝图中通过 `@extern_c("c_symbol")` 将底层 C 函数绑定为携带 `requires`、`ensures` 与 `effects [FFI]` 的白盒函数签名，编译器自动生成契约检查包装器与 C 符号调用。

### 1.3 严格的显式指针转换铁律 (`.as_raw_ptr()`)
为了彻底杜绝 Jenny 的安全借用或指针（`T`、`*T`、`[]T`、`str`）在开发者不知情时隐式退化为失去生命周期保护的 C 裸指针：
1. 将 Jenny 的切片、`str` 或 `*T` 传递给底层 C FFI 函数时，**必须显式调用 `.as_raw_ptr()`**（违者触发 `E0401_FFI_IMPLICIT_RAW_PTR`）；
2. 严禁将受管 GC 引用 `^T` 放入 `@repr(C)` 结构体/联合体或跨越 C FFI 边界传递（违者触发 `E0403_FFI_GC_PTR_TO_C`）。

```jenny
module std_ffi_c_abi

@repr(C)
pub struct CFrameHeader {
    pub version: u32 @bits(4) = 4
    pub ihl: u32 @bits(4) = 5
    pub dscp: u32 @bits(6) = 0
    pub ecn: u32 @bits(2) = 0
    pub total_len: u32 @bits(16) = 20
    pub seq_id: u32 = 0

    invariant self.version >= 4 && self.version <= 15
    invariant self.ihl >= 5 && self.ihl <= 15
    invariant self.dscp >= 0 && self.dscp <= 63
    invariant self.ecn >= 0 && self.ecn <= 3
    invariant self.total_len >= 20 && self.total_len <= 65535
    invariant self.total_len >= self.ihl * 4
}

@repr(C)
pub struct CHalfWords {
    pub low16: u32 @bits(16) = 0
    pub high16: u32 @bits(16) = 0
}

@repr(C)
pub union CWord32Union {
    pub raw_u32: u32
    pub halves: CHalfWords
    pub signed_i32: i32
}

@extern_c("jenny_c_sizeof_frame")
pub fn c_sizeof_frame(hdr: CFrameHeader) -> i64
    ensures result == 8

@extern_c("jenny_c_abi_adler32_words")
pub fn c_adler32_words(raw_ptr: i64, count: i64) -> i64
    requires raw_ptr > 0
    requires count >= 0
    effects [FFI]
    ensures result > 0
```

---

## 2. WebAssembly 双存储空间合捻架构 (Wasm Dual-Memory Backend)

Jenny 的 `*T` 与 `^T` 双轨内存模型在 WebAssembly（Wasm32 / Wasm64）后端实现了业界独一无二的**双存储空间分流与跨堆桥接**：

### 2.1 物理分流映射
* **`*T` $\longrightarrow$ Wasm Linear Memory（线性内存）**：
  * 与 Clang/LLVM 编译出的 C/C++ `.o` 目标文件共享同一个平坦字节地址空间。`import c` 引入的音视频解码器、加密库或物理引擎可直接零拷贝读写 `*T` 指向的线性内存偏移量。
* **`^T` $\longrightarrow$ WasmGC 原生引用（`structref` / `arrayref`）**：
  * 编译为标准 WasmGC 结构化引用指令，直接交由浏览器（V8 / SpiderMonkey / JavaScriptCore）或 Wasmtime 宿主 GC 引擎管理，**使 `.wasm` 产物实现 0 KB 的内置 GC 运行时体积开销**！

### 2.2 Wasm 下的 Cross-Heap Root Table 硬件级桥接
由于 WebAssembly 虚拟机规范禁止将不透明的 WasmGC 引用（`structref`）直接按字节写入 Linear Memory（线性内存）：
* **当 `^A`（WasmGC）持有 `*B`（Linear Memory）时**：`*B` 在 Wasm32 下本质上是一个 `i32` 线性地址偏移量，直接作为 `i32` 字段存储在 WasmGC `struct` 中，并在宿主 `FinalizationRegistry` / GC 终结钩子中注册线性内存释放回调。
* **当 `*A`（Linear Memory）持有 `^B`（WasmGC）时**：编译器自动将模块一定义的 **Cross-Heap Root Table** 在 Wasm 后端编译为一张 **Wasm 原生引用表 `table<anyref>`**！线性内存结构体 `*A` 内部实际存储的是该 `table` 的 `u32` 下标槽位索引（Slot Index），读写字段时自动生成 `table.get` / `table.set` 指令，`drop(*A)` 时自动归还槽位。**これにより、Native 与 Wasm 在语言语义层实现了 100% 零感知大一统**！

### 2.3 `@export(wasm)` 与 WASI 0.2 / TypeScript 零胶水绑定
* 对公开函数或结构体标注 `@export(wasm)` 时，编译器后端自动生成 **WASI Preview 2 WIT（Wasm Interface Types）** 描述文件及配套的 **TypeScript `.d.ts` 声明与轻量加载器**，前端 JS/TS 代码可直接以强类型方式调用 Jenny 模块。

---

## 3. 模块系统、门面重导出与三级正交可见性 (Modules, Re-Exports & Visibility)

### 3.1 模块声明、严禁通配符导入与 `pub import` 门面重导出
1. **双文件白盒模块与小写命名**：每个模块由全小写 `snake_case` 的 `<name>.jni`（蓝图，含 `jenny_decl` 与 `jenny_test` 两章）与 `<name>.jn`（实现）配对组成，首行通过 `module <path>` 声明模块路径。
2. **显式符号导入（禁止 `import *`）**：
   * 为确保人类与 AI 仅看当前文件顶部即可 100% 确定正文中每一个标识符的来源，Jenny **静态禁止通配符导入（如 `import utils::*`）**。
   * 仅允许导入模块命名空间（`import std::fs` $\rightarrow$ 调用 `fs::read`）或显式列出符号清单（`import std::collections::{Vec, HashMap}`）。
3. **`pub import` 子域/包门面重导出（零成本按需符号穿透）**：
   * 支持在子域门面（如 `std/collections/mod.jni`）或包根门面（`pkg.jni`）的 ```` ```jenny_decl ```` 中书写 `pub import std::collections::vec::{Vec, VecError}`，使调用方直接书写无冗余结巴的 `import std::collections::{Vec}`；编译器在解析时按符号名直达 `vec.jni`，绝不连带解析同目录下未被引用的其他模块。

### 3.2 三级可见性修饰符（默认模块内私有，仅存于 `.jn`）
为消除满屏 `priv` 关键字带来的视觉噪音并保持 `.jni` 蓝图绝对纯净，Jenny 采用严格物理分流的三级可见性设计：

| 修饰符写法 | 可见性范围 | 物理落盘位置与编译规则 |
| :--- | :--- | :--- |
| **无修饰符（默认 `fn` / `struct`）** | **模块内私有 (Module-Private)** | **仅存在于 `<mod>.jn` 实现文件内部（严禁出现在 `<mod>.jni` 蓝图中）**；编译器自动推导其 `effects` 并在 C99/Native 后端降级为 `static` 内部符号 |
| **`pkg`** | **包内跨模块可见 (Package-Internal)** | 在 `<mod>.jni` 的 `jenny_decl` 中声明，当前 `Tapestry.toml` 包内所有模块可访问，对包外依赖方隐藏（`E0504`） |
| **`pub`** | **完全公开导出 (Public API)** | 在 `<mod>.jni` 的 `jenny_decl` 中声明（`pub fn` 强制显式声明 `effects [...]`），对包外依赖方公开可见 |

---

## 4. 全套工程工具链与 AI 协同协议 (`Tapestry` & `spindle`)

围绕 **Spinning Jenny（珍妮纺纱机）** 的工业美学，工具链组件与 AI 内省接口规范如下：

### 4.1 核心工具链矩阵
| 工具 / 文件名称 | 职责与核心命令示例 |
| :--- | :--- |
| **`Tapestry.toml`** | **项目工程挂毯清单**：声明包版本、`spindle` 依赖、C 头文件与静态库链接配置、目标平台及 GC/RC 模式（`gc_strategy = "immix" \| "rc"`）。 |
| **`jenny`** | **编译器与工作流主程序**：<br>• `jenny build --target wasm32 -O3`（构建产物）<br>• `jenny run`（编译并立即运行）<br>• `jenny spin --inspect`（预执行 `@spin` 元编程并输出至 `.spun/`）<br>• `jenny debug-spin`（启动编译期 Meta-VM DAP 调试器） |
| **`spindle`** | **包管理器与 C 库纱锭集成器**：<br>• `spindle add std/http`（引入 Jenny 社区包）<br>• `spindle add c:ffmpeg --header "libavcodec/avcodec.h"`（自动拉取并配置 C 库头文件与链接参数） |
| **`.spun/`** | **白盒元编程镜像目录**：存放所有 `@spin` 格式化展开后的 `.spun.jn` 真实源码，接入版本控制忽略或只读审查视图。 |

### 4.2 面向 AI Coding Agent 的原生内省协议
1. **`jenny skeleton`（全项目高密度上下文骨架导出）**：
   * 一键剥离所有函数体实现细节与私有变量，仅输出全项目的模块依赖图、`struct`/`enum` 内存布局（含 `*`/`^` 标记）、`trait` 关系与 `pub fn` 完整签名（含错误与 `effects`），将 10 万行级项目压缩为数千 Token 的精确上下文。
2. **`jenny check --ai-json`（附带确定性修复补丁的机器诊断流）**：
   * 每次编译报错均输出结构化 JSON，包含错误码、精确行列 Span、期望与实际类型对比，以及可直接应用的 **Deterministic Quick-Fix Patch（Unified Diff 格式）**：
   ```json
   {
     "error_code": "E0402_IMPLICIT_RAW_PTR",
     "file": "src/image_loader.jn",
     "line": 28,
     "column": 35,
     "message": "C 函数 `stbi_load_from_memory` 期望 `*c_raw<u8>`，但传入了切片 `[]u8`（禁止隐式退化为裸指针）",
     "deterministic_quick_fix": {
       "description": "显式调用 `.as_raw_ptr()` 提取底层只读 C 裸指针",
       "replacement_span": { "line": 28, "start_col": 35, "end_col": 38 },
       "replacement_code": "buf.as_raw_ptr()"
     }
   }
   ```
