# Jenny 语言规范 —— 模块十二：白盒包管理、模块按需解析与契约演进体系 (`Spindle` & `Tapestry.toml`)

> **状态**：v2.0 规范（按四阶段实战渐进落地）  
> **第一性原理（从“黑盒整包管理”到“白盒意图与契约管理”）**：  
> 传统编程语言的包管理器（Cargo、Go Modules、npm、pip）之所以陷入 **“版本语义混乱、依赖只能整包拉取与整包更新、菱形依赖类型分裂、包体积严重膨胀、供应链暗箱提权”** 的死局，根本原因在于：**传统语言将代码视为不可透视的“黑盒（Black Box）”**——如果不逐行通读第三方库成千上万行实现源码，人类和编译器根本不知道这个包内部究竟做了什么。  
> 而在 Jenny 中，**每一个包在架构与语义上都是天然的“白盒（White Box）”**：仅通过审查 `<mod>.jni` 文学化契约蓝图，人类、AI 与编译器就能 100% 掌握该模块的意图、内存轨道（`T` / `*T` / `^T`）、副作用边界（`effects [...]`）以及精确的前后置条件（`requires` / `ensures` / `invariant`）。  
> **工程演进纪律**：颠覆性的白盒包管理绝不能靠纸面脑补一步到位，必须与 `v0.2 (Jenny-Std)` 标准库建设深度绑定，按 **`Phase 1 (按需子图解析)` $\rightarrow$ `Phase 2 (白盒效应审计)` $\rightarrow$ `Phase 3 (契约差分与模块热替换)` $\rightarrow$ `Phase 4 (契约-实现解耦与蓝图织造)`** 四步在实战中逐一检验与演化。

---

## 1. 深度解剖：为什么传统“黑盒包管理”在 AI 时代全面失灵？

| 传统包管理的五大核心痛点 | 传统语言（Rust Cargo / Go / npm / pip）的物理症结 | **Jenny 基于 `.jni` 白盒契约的根治路径** | 对应实战演进阶段 |
| :--- | :--- | :--- | :---: |
| **1. 粗粒度“整包连坐”与体积膨胀**<br>*(Monolithic Package Bloat)* | 最小依赖单元是整个包（Crate/Repo）。哪怕只调用某库中 1 个函数，也必须下载、解析并编译该库全部 50 个模块及其传递依赖。 | **模块/符号级按需可达子图裁剪（Lazy Subgraph Resolution）**：因禁止 `import *` 且每个 `<mod>.jni` 独立自包含，编译器仅解析并编译从入口可达的 `.jni/.jn` 最小子图，未引用模块零编译、零体积开销。 | **Phase 1**<br>*(`v0.2-alpha1`)* |
| **2. 黑盒依赖暗箱提权与脚本后门**<br>*(Black-Box Supply-Chain Escalation)* | 无法静态获知黑盒库内部是否偷偷发起网络请求、读写文件、分配 GC 或执行 `build.rs` / `postinstall` 宿主机恶意脚本。 | **永久废除 `build.rs` 脚本 + `.jni` 白盒效应指纹与 `allow_effects` 沙箱**：包的全部副作用 100% 暴露在 `.jni` 签名上并由编译器对 `.jn` 强制验真；消费方在 `Tapestry.toml` 按模块粒度锁死权限上限（`E0503`）。 | **Phase 2**<br>*(`v0.2-alpha2`)* |
| **3. 版本号语义混乱与盲盒式整包升级**<br>*(Arbitrary SemVer & Blind Upgrades)* | SemVer 全凭作者主观填写：作者修改了边界行为却发了 Patch 版本，下游整包升级后编译通过但线上静默算错；或改一行私有代码引发全链路重编。 | **基于 `.jni` AST 与有状态 Fuzz 的机械化版本验真 + 单模块实现热替换**：只要 `jni_abi_hash` 不变即可单独热替换某个 `<mod>.jn` 实现且下游 **0 重编**；升级时自动执行新旧 `.jn` 差分模糊测试（`--diff`）。 | **Phase 3**<br>*(`v0.2-beta`)* |
| **4. 菱形依赖“类型分裂”与微包泛滥**<br>*(Diamond Type Split & Micro-Packages)* | 接口类型与实现代码死绑在同一包版本中，导致 `http 0.2` 与 `http 1.0` 的结构体无法互通；或为了几十行工具代码引入外部微包依赖。 | **`.jni` 契约包与 `.jn` 实现提供方解耦 + 纯 `.jni` 蓝图本地织造**：共享恒定的 `.jni` 契约哈希即可跨实现版本无缝传递类型；小型组件可仅引入 `.jni` 契约蓝图，由本地 AI 按需生成零外部依赖的 `.jn` 实现。 | **Phase 4**<br>*(`v0.2` 收官 / `v0.3`)* |

---

## 2. 第一阶段 (`Phase 1` — `v0.2-alpha1` 立即实战)：双文件白盒模块映射与按需子图裁剪

在启动 `v0.2` 构建 `std::{mem, slice, collections, str, io}` 时，我们首先落地最核心的 **多模块白盒寻址与最小子图编译机制**，并在标准库实战中验证其上下文节省率（$\text{ECC}$）与编译隔离效果。

### 2.1 物理双文件配对法则（The `.jni` + `.jn` White-Box Pair）
在任何 Jenny 包（`std` 或业务包）中，每个模块由同目录下同名的两个文件（全小写 `snake_case`，保证跨 Windows/macOS/Linux 文件系统 100% 大小写无歧义）配对组成：
* **`<mod_name>.jni`（白盒意图与双区契约蓝图，必需）**：人类与外部模块唯一可见的门面，内部拆分为两个正交围栏章节：
  1. **第一章 ```` ```jenny_decl ````（纯声明与契约区）**：仅包含 `module`、`import`、`pub import`、`pub error`/`enum`/`struct`/`trait`、`pub fn` 签名、`effects [...]`、`requires`、`ensures(old)` 与 `invariant`。**`jni_abi_hash` 与 `spindle context` 仅作用于 `jenny_decl`**！
  2. **第二章 ```` ```jenny_test ````（验收与测试区）**：包含单行极简断言（`<expr> => <expected>` / `<expr> => err(...)`）与多行有状态测试块（`test "<描述>" { ... }`），仅在测试/验收模式下编译执行，生产构建与 `.jnast` 归档 100% 剥离。
* **`<mod_name>.jn`（幕后实现单元，对外部模块物理不可见）**：仅包含公开函数的函数体实现、**模块内私有辅助函数（无修饰符 `fn`，禁止出现在 `.jni` 中）** 与 `@spin` 展开指令。

### 2.2 标准库与工程目录拓扑 (`std/` 实战布局)

```text
jenny_workspace/
├── Tapestry.toml                  # 工程挂毯配置清单
├── Tapestry.lock                  # 白盒契约哈希与模块级依赖锁定文件
├── std/                           # 官方标准库包 (package = "std")
│   ├── pkg.jni                    # 包级门面蓝图 (通过 pub import 聚合重导出核心符号)
│   ├── mem/
│   │   ├── mod.jni                # 子域门面蓝图 (pub import 重导出 RawBuf, Arena)
│   │   ├── raw_buf.jni            # 模块路径: std::mem::raw_buf (仅依赖 std::rt::intrinsics)
│   │   ├── raw_buf.jn
│   │   ├── arena.jni              # 模块路径: std::mem::arena
│   │   └── arena.jn
│   ├── collections/
│   │   ├── mod.jni                # 子域门面蓝图 (pub import 重导出 Vec, VecDeque, HashMap, LruCache)
│   │   ├── vec.jni                # 模块路径: std::collections::vec (import std::mem::raw_buf)
│   │   ├── vec.jn
│   │   ├── vec_deque.jni          # 模块路径: std::collections::vec_deque
│   │   ├── vec_deque.jn
│   │   ├── hash_map.jni           # 模块路径: std::collections::hash_map
│   │   ├── hash_map.jn
│   │   ├── lru_cache.jni          # 模块路径: std::collections::lru_cache (effects [AllocGC])
│   │   └── lru_cache.jn
│   ├── str/
│   │   ├── str_view.jni           # 模块路径: std::str::str_view
│   │   └── str_view.jn
│   └── io/
│       ├── cursor.jni             # 模块路径: std::io::cursor (import std::str::str_view)
│       ├── cursor.jn
│       ├── buf_reader.jni         # 模块路径: std::io::buf_reader
│       └── buf_reader.jn
└── .jenny-cache/                  # 模块级细粒度 CAS 缓存 (c99/*.h, c99/*.c, obj/*.o, abi/*.json)
```

### 2.3 显式导入、`pub import` 门面重导出与“零成本按需符号穿透” (Zero-Cost Barrel Forwarding)
1. **静态禁止通配符导入（`E0501_WILDCARD_IMPORT_FORBIDDEN`）**：
   * 仅允许显式符号导入或模块命名空间导入：
     ```jenny_decl
     module std::collections::vec

     import std::mem::{RawBuf, AllocError}
     import std::mem::arena as mem_arena
     ```
2. **借鉴 JavaScript ES Modules 的 `pub import` 门面重导出（消除路径结巴）**：
   * 物理文件保持一模块一文件的全小写命名（如 `std/collections/vec.jni` 定义 `pub struct Vec`），避免多类型拥挤或跨平台大小写冲突；
   * 在子域门面 `std/collections/mod.jni` 或包根门面 `std/pkg.jni` 的 ```` ```jenny_decl ```` 块中，使用 **`pub import`** 显式重导出公开类型与函数：
     ```jenny_decl
     module std::collections

     pub import std::collections::vec::{Vec, VecError}
     pub import std::collections::vec_deque::{VecDeque}
     pub import std::collections::hash_map::{HashMap}
     pub import std::collections::lru_cache::{LruCache}
     ```
   * 下游调用方无需书写冗长结巴的 `import std::collections::vec::{Vec}`，直接书写干净的领域级导入：
     ```jenny_decl
     import std::collections::{Vec, HashMap}
     ```
3. **告别 JS Barrel File 体积膨胀的“零成本按需符号穿透”（Zero-Cost Barrel Forwarding）**：
   * 在传统 JavaScript/TypeScript 中，通过 `index.ts` 重导出常导致打包器被迫解析整个目录下的所有文件；
   * 而在 Jenny 中，由于严禁模块顶层存在副作用代码且 `pub import` 强制显式列出符号清单，当编译器看到 `import std::collections::{Vec}` 时，它在 `std/collections/mod.jni` 的符号映射表中查出 `Vec` 源自 `std::collections::vec`，**直接按需穿透并仅加载 `vec.jni` 的 `jenny_decl` 与 `vec.jn`**！同目录下的 `hash_map.jni` 与 `lru_cache.jni` **连打开都不会打开**（0 词法分析、0 编译耗时、0 效应传染、0 二进制体积）。
4. **跨模块编译的物理白盒隔离（`.jni` `jenny_decl` Header Generation）**：
   * 编译器仅提取每个可达 `<mod>.jni` 中的 ```` ```jenny_decl ```` 块，降级为独立的 C99 接口头文件 `.jenny-cache/c99/<pkg>__<mod>.h`（内含结构体布局、函数原型与 `jni_abi_hash` 常量断言）；
   * 编译下游 `<consumer>.jn` 时，C99 后端仅 `#include "<pkg>__<mod>.h"`，从而在物理层面保证：**只要上游 `<mod>.jni` 的 `jenny_decl` 契约哈希未变，无论上游修改 `<mod>.jn` 内部实现、新增私有 `fn`，还是在 `<mod>.jni` 的 `jenny_test` 中增删测试用例，下游 `.o` 目标文件 100% 零重编！**

---

## 3. 第二阶段 (`Phase 2` — `v0.2-alpha2` 实战)：白盒意图审计与包/模块级效应防火墙

传统包管理必须把整个外部包当成不可信黑盒，而 Jenny 的 `.jni` 蓝图天然是一份 **经编译器强制验真的白盒能力清单（Verified Capability Manifest）**。

### 3.1 自动提取模块级白盒能力指纹 (`spindle audit`)
无需阅读任何一行 `.jn` 实现代码，`spindle audit` 仅扫描包内各模块的 `.jni` 即可生成 100% 保真的白盒安全画像（因为若 `.jn` 违反了 `.jni` 的声明，编译器自身就会报 `E0204` / `E0402` 拒绝编译）：
* **内存轨道画像**：该模块是纯栈视图（`Stack-Only`）、使用了独占原生堆（`Native-Box *T`）、还是使用了托管 GC 句柄（`Managed-GC ^T`）？
* **副作用画像**：该模块包含哪些 `effects`（`Pure []` / `AllocGC` / `IO` / `Unsafe`）？是否包含 `import c` 外部 C 调用？
* **契约完备度画像**：公开函数的 `requires` / `ensures` / `invariant` 覆盖率与 `@example` 沙箱数量。

### 3.2 `Tapestry.toml` 细粒度效应沙箱与永久废除构建脚本
1. **永久禁绝 `build.rs` / `postinstall` 图灵完备构建脚本**：
   * Jenny 语言规范严格规定：**包管理器在拉取、检查或编译任何包时，永远不允许执行任何图灵完备的宿主机脚本**。所有代码生成 100% 必须在零 I/O、零网络的 `@spin` 内存沙箱中完成并白盒落盘至 `.spun/`；所有原生 C 库依赖必须在 `Tapestry.toml` 的 `[c_dependencies]` 中声明式列出。
2. **消费方 `allow_effects` 权限阀门（拦截供应链静默提权 `E0503`）**：
   ```toml
   [package]
   name = "realtime_audio_dsp"
   version = "0.1.0"
   spec = "2.0"

   [dependencies]
   # 细粒度白盒管控：当前硬实时音频模块引入 std 标准库，
   # 但显式设定 allow_effects = []（禁止 AllocGC、禁止 IO、禁止 Unsafe）！
   # 结果：代码可以安全 import std::mem::RawBuf 和 std::collections::Vec，
   # 但一旦 AI 试图 import std::collections::LruCache (含 AllocGC)，编译期立即拦截报错 E0503！
   std = { path = "../std", allow_effects = [] }
   ```

---

## 4. 第三阶段 (`Phase 3` — `v0.2-beta` 实战)：契约驱动的版本演进与模块级热替换

在传统语言中，版本升级只能以“整包”为单位盲目更新。在 Jenny 中，我们利用 `.jni` 的形式化契约将版本管理升级为 **机械化契约验证与模块级热更新**。

### 4.1 基于 `.jni` 契约 AST 的机械化版本判定 (`spindle semver-check`)
当标准库或第三方包的某个模块发生修改时，`spindle semver-check` 直接对比新旧两个版本的 `.jni` 形式化语法树与 `.jn` 哈希：
1. **纯实现热补丁（`IMPL_PATCH` — `jni_abi_hash` 完全不变）**：
   * 仅修改了 `<mod>.jn` 内部算法或优化了性能，`<mod>.jni` 的类型布局、函数签名与 `requires`/`ensures`/`invariant` 契约未发生任何改变。
   * **颠覆性能力（单模块热替换）**：下游项目**无需整包升级或重新编译任何代码**，只需拉取该单个模块的 `.jn`（或 `.o`），通过内生 Layer 2 (`--fuzz`) 与 Layer 4 (`--diff`) 差分验真后即可直接替换链接！
2. **契约兼容扩展（`CONTRACT_MINOR` — 协变/逆变兼容）**：
   * 新增了 `pub fn` / `pub struct`；或者对已有函数**放宽了前置条件 `requires`**（接受更广的输入）、**加强了后置条件 `ensures`**（提供更强的输出保证）。
3. **契约破坏性变更（`CONTRACT_BREAKING` — 触发 `E0504_CONTRACT_SEMVER_BREAK`）**：
   * 修改了已有 `pub` 结构体字段布局或函数签名、新增了 `effects` 副作用、**收紧了 `requires` 前置条件**或**削弱了 `ensures` / `invariant` 保证**。

### 4.2 依赖更新时的自动化差分模糊测试门禁 (`spindle upgrade --verify-diff`)
当升级某个模块的 `.jn` 实现时，`spindle` 自动调用编译器的 **有状态方法序列 Fuzzing + `--diff` 差分引擎**：
* 自动向旧版 `.jn` 与新版 `.jn` 喂入 1,000 组相同的随机操作序列（如对 `HashMap` 交替执行 `insert/get/remove`），逐项比对返回值与容器状态；
* 若新版 `.jn` 在某组满足 `.jni` `requires` 的输入下产生与旧版不一致的结果或违反 `ensures`，`spindle` 立即阻断升级并输出最小复现反例。

---

## 5. 第四阶段 (`Phase 4` — `v0.2` 收官 / `v0.3` 演化)：契约-实现解耦与纯 `.jni` 蓝图依赖

在前三阶段通过 `std` 标准库实战充分跑通后，我们将进一步探索并实证 AI 原生时代最具颠覆性的两项包管理范式：

1. **接口契约包（`.jni` Contract Spec）与多实现提供方（`.jn` Providers）解耦（终结菱形依赖类型分裂）**：
   * 允许一个包仅发布共享的核心数据结构与 Trait 契约（如 `std::io::stream.jni`，拥有全局唯一的 `jni_abi_hash`），不同的底层实现包为该 `.jni` 提供各自的 `.jn` 实现。不同库之间只通过恒定的 `.jni` 契约类型通信，彻底消灭 Rust 中“因为底层依赖版本不同导致同名结构体类型不兼容”的顽疾。
2. **纯 `.jni` 蓝图借阅模式 (`[blueprints]` —— 零外部运行时依赖)**：
   * 针对几十到几百行规模的通用算法或数据结构（如令牌桶限流器、重试状态机、布隆过滤器），开发者无需引入外部黑盒代码包，只需在 `Tapestry.toml` 的 `[blueprints]` 中引入社区经过千锤百炼的 **纯 `.jni` 契约与 `@example` 验收蓝图**，由本地编码模型直接按需合成并经编译器 100% 验真出本地 `.jn` 实现，彻底消灭 `left-pad` 式的微包供应链风险。
3. **纯 `.jni` 蓝图门面发布与统一规范化 AST 归档库 (`spindle pack` & `spindle decompile`)**：
   * **发布包不携带散落的 `.jn` 源码或 `.spun` 展开文件**：通过 `spindle pack` 打包发布的依赖包，其目录树仅暴露 `Tapestry.toml`、`Tapestry.lock`、**纯 `.jni` 文学化蓝图文件树**以及单个统一的**预编译规范化 AST 归档库 `lib/<pkg>.jnast`**。
   * **三大核心收益**：
     1. **视觉与 AI 上下文绝对纯净**：人类浏览依赖目录或 AI Agent 检索外部包时，100% 只接触高信息密度的 `.jni` 契约蓝图，绝不会被内部 `.jn` 实现文件污染上下文；
     2. **跳过词法/语法分析的 $O(1)$ 按需 AST 加载与全局 `@spin` 去重**：`lib/<pkg>.jnast` 存储已校验、已归一化的函数与 `@spin` 模板 AST 节点（免疫空白符与注释变更），下游构建时无需重新 Lex/Parse 依赖包源码；所有 `@spin` 展开在工作区全局单态化池（`.jenny-cache/spin/`）中按实参类型签名统一生成并跨包去重；
     3. **1:1 无损反编译 (`spindle decompile <module>`)**：由于规范化 AST 与 Jenny v2.0 `.jn` 语法构成严格双射，开发者或审计工具随时可执行 `spindle decompile std::str::fmt` 从 `lib/std.jnast` 毫秒级无损还原出标准 `.jn` 源代码。

---

## 6. Layer-0 运行时内建白盒边界 (`std::rt::intrinsics`)、C 库白盒桥接 (`std::ffi::c_abi` + `spindle bindgen-c`) 与静态诊断错误码 (`E0501` ~ `E0510`)

为彻底消除“`.jn` 实现层直接调用底层 C 运行时 `jenny_rt.h` 宏/内建函数或直接引入黑盒 C 头文件 `import c "header.h"` 而缺乏 `.jni` 蓝图契约描述”的白盒盲区，Jenny 标准库确立了两大 Layer-0 白盒桥接铁律：
1. **运行时内建原语白盒蓝图 (`std::rt::intrinsics`)**：
   * 所有底层堆分配（`rt_raw_alloc` / `rt_raw_realloc` / `rt_raw_free` / `rt_raw_get` / `rt_raw_set` / `rt_raw_copy`）、栈帧暂存区（`rt_scratch_mark` / `rt_scratch_alloc` / `rt_scratch_release`）、格式化与 SSO 转换原语（`rt_raw_put_*` / `rt_raw_to_sso_string`）以及 Immix GC 纪元原语（`rt_gc_begin_mark` / `rt_gc_sweep_epoch`）均在 [`std/rt/intrinsics.jni`](../../../std/rt/intrinsics.jni) 中拥有完整的类型签名、`effects` 副作用标签、`requires` / `ensures` 契约与 `@example` 测试；
   * 除 `std::rt::intrinsics` 自身外，任何模块若在 `.jn` 中绕过 `std::rt::intrinsics` 直接调用底层 `jn_raw_*` / `jn_scratch_*` C 宏，或未在 `.jni` 中显式声明 `import std::rt::intrinsics` 即调用 `rt_*` 原语，均会被 `Spindle` 静态拦截并抛出 **`E0510_UNDECLARED_RT_INTRINSIC`**。
2. **外部 C 库白盒蓝图桥接 (`std::ffi::c_abi` & `spindle bindgen-c`)**：
   * 禁止普通模块直接 `import c "header.h"` 引入黑盒 C 头文件（触发 `E0505_UNDECLARED_FFI_IMPORT`）；
   * 外部 C 库必须先通过 AI + `spindle bindgen-c <header.h>` 提取为白盒 `.jni` 蓝图（如 [`std/ffi/c_abi.jni`](../../../std/ffi/c_abi.jni)），原生支持与 C 1:1 物理内存布局一致的 `@repr(C) struct`、`@repr(C) union` 与 `@bits(N)` 位域，并通过 `@extern_c("c_symbol")` 为每个 C 函数赋予形式化 `requires` / `ensures` / `effects` 契约与 1:1 `sizeof` 校验。

| 错误码 ID | 所属阶段 | 触发条件 | `--ai-json` 确定性修复建议 |
| :--- | :---: | :--- | :--- |
| **`E0501_UNPAIRED_MODULE`** | Phase 1 | 包内导出的模块缺失配对的 `.jni` 蓝图或 `.jn` 实现文件 | 补齐配对的 `<mod>.jni` 文学化蓝图与 `<mod>.jn` 实现 |
| **`E0502_CIRCULAR_DEPENDENCY`** | Phase 1 | 模块 `import` 依赖图存在环路（`mod_a -> mod_b -> mod_a`） | 将共享的数据结构或 `trait` 抽离至独立的底层 `.jni` 模块以打破环路 |
| **`E0503_CAPABILITY_VIOLATION`** | Phase 2 | 模块请求了超出 `Tapestry.toml` 中 `allow_effects` 沙箱授权范围的受限效应（如 `Net`、`IO`、`Unsafe`） | 移除越权调用，或在 `Tapestry.toml` 经人工审计后显式放开对应效应权限 |
| **`E0504_UNEXPORTED_MODULE`** | Phase 1 | 导入了未在包根门面 `pkg.jni` 中 `pub mod` 公开导出的内部模块 | 仅导入 `pkg.jni` 公开导出的模块，或在 `pkg.jni` 中显式导出 |
| **`E0505_UNDECLARED_FFI_IMPORT`** | Phase 2 | 在普通模块中使用黑盒 `import c "<header>.h"` 导入外部 C 头文件 | 使用 `spindle bindgen-c` 生成白盒 `.jni` 蓝图（`@repr(C)` `struct`/`union`/`@bits(N)` + `@extern_c`）后导入该白盒模块 |
| **`E0506_SEMVER_EFFECT_EXPANSION`** | Phase 3 | 候选版本升级对已有公开函数新增了副作用标签（$E_{\text{new}} \not\subseteq E_{\text{old}}$） | 移除新增副作用，或显式作为主版本破坏性变更发布 |
| **`E0507_SEMVER_STRENGTHENED_REQUIRES`** | Phase 3 | 候选版本升级收紧了已有公开函数的 `requires` 前置条件，破坏既有调用方 | 恢复原前置条件，或新增独立的受限函数 |
| **`E0508_SEMVER_WEAKENED_ENSURES`** | Phase 3 | 候选版本升级削弱或删除了已有公开函数的 `ensures` 后置条件保证 | 恢复原后置条件契约保证 |
| **`E0509_SEMVER_BEHAVIORAL_REGRESSION`** | Phase 3 | 候选 `.jn` 补丁在保持 `.jni` 不变的情况下违反了原 `.jni` 契约或 `@example` 差分验证 | 修复 `.jn` 实现回归，确保 100% 通过原 `.jni` 契约与差分测试 |
| **`E0510_UNDECLARED_RT_INTRINSIC`** | Phase 2 | 模块在 `.jn` 中绕过 `std::rt::intrinsics` 直接调用底层 `jenny_rt.h` 的 `jn_raw_*`/`jn_scratch_*` 函数，或未声明 `import std::rt::intrinsics` 即调用 `rt_*` 原语 | 在 `.jni` 与 `.jn` 中显式声明 `import std::rt::intrinsics` 并调用带契约的 `rt_*` 函数（或使用上层 `RawBuf`/`Arena` 封装） |


