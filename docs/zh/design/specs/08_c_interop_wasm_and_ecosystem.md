# Jenny 语言规范 —— 模块八：零胶水 C 互操作、WebAssembly 双后端与工程生态 (C Interop, Wasm Dual-Backend & Toolchain Ecosystem)

> **状态**：已定稿 (v1.0-spec)  
> **核心理念**：编译器内置 `libclang` 实现免 `bindgen` 的零胶水 C 头文件直导，但**严格强制 `.as_raw_ptr()` 显式指针跨越边界**；在 WebAssembly 后端首创 **Linear Memory (`*T`) + WasmGC (`^T`) + `table<anyref>` 跨堆根表** 的双轨合捻架构；并以 `Tapestry.toml`、`spindle`、`.spun/` 与 AI 自愈诊断协议构筑完整的现代工具链。

---

## 1. 零胶水、显式边界的 C 语言互操作 (`import c`)

### 1.1 内置 Clang AST 映射引擎
当源码中声明 `import c "sqlite3.h" as sql` 时，Jenny 编译器直接调用内嵌的 `libclang` 前端解析 C 头文件，自动在内存中构建 Jenny 符号表，**无需任何外部胶水代码生成步骤**：
* **C 结构体与联合体**：自动映射为 `@repr(C) pub struct` 与 `@repr(C) pub union`。
* **C `#define` 常量与枚举**：数值与字符串字面量宏自动提取为模块级不可变绑定 `pub val`；C `enum` 映射为等宽整数常量集。
* **C 函数副作用自动染色**：所有通过 `import c` 导入的外部 C 函数，签名自动附加 **`effects [IO, Unsafe]`** 契约。

### 1.2 严格的显式指针转换铁律 (`.as_raw_ptr()`)
为了彻底杜绝 Jenny 的安全借用或指针（`T`、`*T`、`[]T`）在开发者不知情时隐式退化为失去生命周期保护的 C 裸指针：
1. **专用 C 裸指针类型 `*c_raw<T>` 与 `*mut c_raw<T>`**：
   * C 头文件中的 `const T*` 自动映射为 `*c_raw<T>`；`T*` 映射为 `*mut c_raw<T>`；`void*` 映射为 `*mut c_raw<void>`。
2. **禁止隐式指针退化，强制显式调用 `.as_raw_ptr()`**：
   * 将 Jenny 的只读借用 `x: T`、可变借用 `mut x: T`、`*T`、`[]T` 或 `str` 传递给 C 函数时，**必须显式调用 `.as_raw_ptr()` 或 `.as_mut_raw_ptr()`（字符串转为以 `\0` 结尾的 C 字符串则调用 `.as_c_str()`）**！
   * 这一设计确保每一处跨越 C FFI 边界的裸内存暴露点在代码审查与 AI 静态分析中 100% 显式可见。

```rust
module image_loader

import c "stb_image.h" as stbi

@repr(C)
pub struct RawImage {
    pub data: *mut c_raw<u8>,
    pub width: i32,
    pub height: i32,

    fn drop(own self) {
        if self.data != null {
            // 调用 C 释放函数：同样显式传递裸指针
            stbi.stbi_image_free(self.data.as_mut_void_ptr())
        }
    }
}

pub fn load_png(buf: []u8) -> *RawImage ! LoadError 
    effects [IO, Unsafe] 
{
    var w: i32 = 0
    var h: i32 = 0
    var channels: i32 = 0

    // 严格显式边界：必须调用 .as_raw_ptr() 与 .as_mut_raw_ptr() 跨越 C FFI！
    val pixels = stbi.stbi_load_from_memory(
        buf.as_raw_ptr(),
        buf.len.as<i32>(),
        w.as_mut_raw_ptr(),
        h.as_mut_raw_ptr(),
        channels.as_mut_raw_ptr(),
        4
    )

    if pixels == null {
        raise LoadError.DecodeFailed
    }

    return *RawImage { data: pixels, width: w, height: h }
}
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

## 3. 模块系统与三级正交可见性 (Modules & Visibility)

### 3.1 模块声明与严禁通配符导入
1. **单文件自包含模块**：源码文件统一以 **`.jn`** 为后缀，文件首行通过 `module <name>` 声明模块名。
2. **显式符号导入（禁止 `import *`）**：
   * 为确保人类与 AI 仅看当前文件顶部即可 100% 确定正文中每一个标识符的来源，Jenny **静态禁止通配符导入（如 `import utils::*`）**。
   * 仅允许导入模块命名空间（`import std::fs` $\rightarrow$ 调用 `fs::read`）或显式列出符号清单（`import std::sync::{Channel, Mutex}`）。

### 3.2 三级可见性修饰符（默认私有，省略 `priv`）
为消除满屏 `priv` 关键字带来的视觉噪音，Jenny 采用干净的三级可见性设计：

| 修饰符写法 | 可见性范围 | 适用对象 |
| :--- | :--- | :--- |
| **无修饰符（默认）** | **模块内私有 (Module-Private)** | 仅当前 `.jn` 模块文件内部可访问（无需书写 `priv` 关键字） |
| **`pkg`** | **包内跨模块可见 (Package-Internal)** | 当前 `Tapestry.toml` 工程包内的所有模块均可访问，但对外部依赖方隐藏 |
| **`pub`** | **完全公开导出 (Public API)** | 对包外依赖方可见（`pub fn` 强制要求显式声明全部 `effects [...]`） |

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
