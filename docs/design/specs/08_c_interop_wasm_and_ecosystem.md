# Jenny Language Specification — Module 08: Zero-Glue C Interop, WebAssembly Dual-Backend, and Toolchain Ecosystem

> **Language**: English | [中文版 (Chinese)](../../zh/design/specs/08_c_interop_wasm_and_ecosystem.md)  
> **Status**: Finalized (v2.0-spec)  
> **Core Philosophy**: Embed `libclang` directly into the compiler for `bindgen`-free, zero-glue C header imports while **strictly enforcing explicit `.as_raw_ptr()` pointer conversions across FFI boundaries**; pioneer a **Linear Memory (`*T`) + WasmGC (`^T`) + `table<anyref>` Cross-Heap Root Table** dual-track architecture on the WebAssembly backend; and deliver a modern engineering toolchain built around `Tapestry.toml`, `spindle`, `.spun/`, and the AI self-healing diagnostic protocol.

---

## 1. Zero-Glue, Explicit-Boundary C Interoperability (`import c`)

### 1.1 Built-in Clang AST Mapping Engine
When source code declares `import c "sqlite3.h" as sql`, the Jenny compiler directly invokes its embedded `libclang` frontend to parse the C header and automatically constructs the Jenny symbol table in memory **without any external glue-code generation step**:
* **C Structs and Unions**: Automatically mapped to `@repr(C) pub struct` and `@repr(C) pub union`.
* **C `#define` Constants and Enums**: Numeric and string literal macros are automatically extracted as module-level immutable bindings `pub val`; C `enum` declarations are mapped to equal-width integer constant sets.
* **Automatic Effect Coloring for C Functions**: All external C functions imported via `import c` automatically receive the **`effects [IO, Unsafe]`** contract on their signatures.

### 1.2 Strict Explicit Pointer Conversion Rule (`.as_raw_ptr()`)
To completely prevent Jenny's safe borrows and pointers (`x: T`, `mut x: T`, `*T`, `[]T`) from implicitly decaying into unmanaged C raw pointers without the developer's knowledge:
1. **Dedicated C Raw Pointer Types `*c_raw<T>` and `*mut c_raw<T>`**:
   * In C headers, `const T*` maps automatically to `*c_raw<T>`, `T*` maps to `*mut c_raw<T>`, and `void*` maps to `*mut c_raw<void>`.
2. **No Implicit Pointer Decay—Explicit `.as_raw_ptr()` Required**:
   * When passing a Jenny value or borrow (`x: T`, `mut x: T`, `*T`, `[]T`, or `str`) to a C function, callers **must explicitly invoke `.as_raw_ptr()` or `.as_mut_raw_ptr()` (or `.as_c_str()` to convert a string into a null-terminated `\0` C string)**!
   * This ensures that every raw memory exposure crossing the C FFI boundary is 100% explicitly visible during human code review and AI static analysis.

```jenny
module image_loader

import c "stb_image.h" as stbi

@repr(C)
pub struct RawImage {
    pub data: *mut c_raw<u8>,
    pub width: i32,
    pub height: i32,

    fn drop(own self) {
        if self.data != null {
            // Invoke C deallocator: explicitly pass raw pointer as well
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

    // Strict explicit boundary: must call .as_raw_ptr() and .as_mut_raw_ptr() across C FFI!
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

## 2. WebAssembly Dual-Memory Backend Architecture

Jenny's `*T` and `^T` dual-track memory model achieves an industry-first **dual-storage separation and cross-heap bridge** on the WebAssembly (`wasm32` / `wasm64`) backend:

### 2.1 Physical Storage Split Mapping
* **`*T` $\longrightarrow$ Wasm Linear Memory**:
  * Shares the exact same flat byte address space with C/C++ `.o` object files compiled by Clang/LLVM. Audio/video codecs, cryptography libraries, or physics engines imported via `import c` can read and write linear memory offsets pointed to by `*T` with zero copying.
* **`^T` $\longrightarrow$ Native WasmGC References (`structref` / `arrayref`)**:
  * Compiles to standard WasmGC structured reference instructions managed directly by the host GC engine in the browser (V8 / SpiderMonkey / JavaScriptCore) or Wasmtime, **achieving 0 KB of bundled GC runtime binary overhead in `.wasm` artifacts**!

### 2.2 Hardware-Level Cross-Heap Root Table Bridging on Wasm
Because the WebAssembly virtual machine specification forbids writing opaque WasmGC references (`structref`) directly as raw bytes into Linear Memory:
* **When `^A` (WasmGC) holds `*B` (Linear Memory)**: Under `wasm32`, `*B` is physically an `i32` linear address offset stored directly as an `i32` field inside the WasmGC `struct`, with a linear-memory deallocation callback registered in the host `FinalizationRegistry` / GC finalizer hook.
* **When `*A` (Linear Memory) holds `^B` (WasmGC)**: The compiler automatically lowers the **Cross-Heap Root Table** defined in Module 01 into a **native Wasm reference table `table<anyref>`** on the Wasm backend! Inside linear memory, struct `*A` stores a `u32` slot index into that `table`; reading or writing the field emits `table.get` / `table.set` instructions automatically, and `drop(*A)` reclaims the slot. **Through this mechanism, Native and Wasm achieve 100% transparent semantic unification at the language level!**

### 2.3 `@export(wasm)` and Zero-Glue WASI 0.2 / TypeScript Bindings
* When a public function or struct is annotated with `@export(wasm)`, the compiler backend automatically generates **WASI Preview 2 WIT (Wasm Interface Types)** descriptors along with matching **TypeScript `.d.ts` declarations and a lightweight loader**, allowing frontend JS/TS code to invoke Jenny modules with full static typing.

---

## 3. Module System and Three-Tier Orthogonal Visibility

### 3.1 Module Declarations and Prohibition of Wildcard Imports
1. **Self-Contained Single-File Modules**: Implementation source files use the **`.jn`** extension (paired with `.jni` blueprints) and declare their module name on the first line via `module <name>`.
2. **Explicit Symbol Imports (`import *` Forbidden)**:
   * To ensure that both humans and AI can determine the origin of every identifier in a file with 100% certainty just by reading the file header, Jenny **statically forbids wildcard imports (such as `import utils::*`)**.
   * Only module namespace imports (`import std::fs` $\rightarrow$ call `fs::read`) or explicit symbol lists (`import std::sync::{Channel, Mutex}`) are permitted.

### 3.2 Three-Tier Visibility Modifiers (Private by Default, No `priv` Keyword)
To eliminate the visual noise of `priv` keywords scattered across every file, Jenny adopts a clean three-tier visibility model:

| Modifier Syntax | Visibility Scope | Target Audience |
| :--- | :--- | :--- |
| **No modifier (Default)** | **Module-Private** | Accessible only within the current `.jn` module file (no `priv` keyword needed) |
| **`pkg`** | **Package-Internal** | Accessible across all modules within the current `Tapestry.toml` package, but hidden from external dependents |
| **`pub`** | **Public API** | Exported to external dependents (`pub fn` declarations must explicitly specify all `effects [...]`) |

---

## 4. Complete Engineering Toolchain and AI Collaboration Protocol (`Tapestry` & `spindle`)

Built around the industrial aesthetics of the **Spinning Jenny**, the toolchain components and AI introspection interfaces are organized as follows:

### 4.1 Core Toolchain Matrix
| Tool / File Name | Responsibility & Core Command Examples |
| :--- | :--- |
| **`Tapestry.toml`** | **Project Tapestry Manifest**: Declares package version, `spindle` dependencies, C header and static library linkage settings, target platforms, and GC/RC strategy (`gc_strategy = "immix" \| "rc"`). |
| **`jenny`** | **Compiler & Workflow Driver**:<br>• `jenny build --target wasm32 -O3` (build artifacts)<br>• `jenny run` (compile and run immediately)<br>• `jenny spin --inspect` (pre-execute `@spin` metaprogramming and materialize to `.spun/`)<br>• `jenny debug-spin` (launch compile-time Meta-VM DAP debugger) |
| **`spindle`** | **Package Manager & C Library Spindle Integrator**:<br>• `spindle add std/http` (add a Jenny community package)<br>• `spindle add c:ffmpeg --header "libavcodec/avcodec.h"` (automatically fetch and configure C library headers and linker flags) |
| **`.spun/`** | **White-Box Metaprogramming Mirror Directory**: Stores all formatted `.spun.jn` source files expanded by `@spin`, ready for read-only inspection or `.gitignore` integration. |

### 4.2 Native Introspection Protocol for AI Coding Agents
1. **`jenny skeleton` (Whole-Project High-Density Context Skeleton Export)**:
   * Strips all function body implementations and private variables in one command, outputting only the project-wide module dependency graph, `struct`/`enum` memory layouts (including `*`/`^` annotations), `trait` relationships, and complete `pub fn` signatures (with errors and `effects`), compressing a 100,000-line codebase into a few thousand Tokens of exact architectural context.
2. **`jenny check --ai-json` (Machine Diagnostic Stream with Deterministic Quick-Fix Patches)**:
   * Every compiler error emits structured JSON containing the error code, exact line/column span, expected vs. actual type comparison, and a directly applicable **Deterministic Quick-Fix Patch**:
   ```json
   {
     "error_code": "E0401_IMPLICIT_RAW_PTR",
     "file": "src/image_loader.jn",
     "line": 28,
     "column": 35,
     "message": "C function `stbi_load_from_memory` expects `*c_raw<u8>`, but received slice `[]u8` (implicit decay to raw pointer is forbidden)",
     "deterministic_quick_fix": {
       "description": "Explicitly call `.as_raw_ptr()` to extract the underlying read-only C raw pointer",
       "replacement_span": { "line": 28, "start_col": 35, "end_col": 38 },
       "replacement_code": "buf.as_raw_ptr()"
     }
   }
   ```
