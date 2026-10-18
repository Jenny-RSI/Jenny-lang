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
在任何 Jenny 包（`std` 或业务包）中，每个模块由同目录下同名的两个文件配对组成：
* **`<mod_name>.jni`（白盒意图与契约蓝图，必需）**：人类与外部模块唯一可见的门面。包含 Markdown 架构意图说明以及 ```` ```jenny ```` 块中的 `pub struct`/`enum`/`trait`、`pub fn` 签名、`effects [...]`、`requires`、`ensures(old)`、`invariant` 与 `@example`。
* **`<mod_name>.jn`（幕后实现单元，对外部模块物理不可见）**：仅包含函数体实现、模块私有辅助函数与 `@spin` 展开指令。

### 2.2 标准库与工程目录拓扑 (`std/` 实战布局)

```text
jenny_workspace/
├── Tapestry.toml                  # 工程挂毯配置清单
├── Tapestry.lock                  # 白盒契约哈希与模块级依赖锁定文件
├── std/                           # 官方标准库包 (package = "std")
│   ├── pkg.jni                    # 包级门面蓝图 (聚合重导出核心子模块)
│   ├── mem/
│   │   ├── raw_buf.jni            # 模块路径: std::mem::raw_buf (仅依赖 jenny_rt.h)
│   │   ├── raw_buf.jn
│   │   ├── arena.jni              # 模块路径: std::mem::arena
│   │   └── arena.jn
│   ├── collections/
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

### 2.3 显式导入语法与“模块级按需可达子图裁剪” (Lazy Subgraph Pruning)
1. **静态禁止通配符导入（`E0501_WILDCARD_IMPORT_FORBIDDEN`）**：
   * 仅允许显式符号导入或模块命名空间导入：
     ```jenny
     module std::collections::vec

     import std::mem::raw_buf::{RawBuf, AllocError}
     import std::mem::arena as mem_arena
     ```
2. **告别“整包连坐”的按需子图解析算法**：
   * 当编译目标模块 `M` 时，`spindle` 从 `M.jni` 和 `M.jn` 的 `import` 声明出发，仅按需加载被显式引用的上游 `<dep_mod>.jni` 文件（绝不扫描同一包内未被引用到的其他兄弟模块！）。
   * **实战验证指标（在 `std` 上实测）**：若某程序仅 `import std::mem::arena::{Arena}`，编译器只解析 `arena.jni` 并链接 `arena.o`，`std::collections` 与 `std::io` 的编译耗时与二进制体积贡献严格为 **`0`**。
3. **跨模块编译的物理白盒隔离（`.jni` Header Generation）**：
   * 编译器将每个可达的 `<mod>.jni` 降级为独立的 C99 接口头文件 `.jenny-cache/c99/<pkg>__<mod>.h`（内含结构体布局、函数原型与 `jni_abi_hash` 常量断言）；
   * 编译下游 `<consumer>.jn` 时，C99 后端仅 `#include "<pkg>__<mod>.h"`，从而在物理层面保证：**只要上游 `<mod>.jni` 的契约哈希未变，上游 `<mod>.jn` 内部实现怎么重构、哪怕替换整个底层算法，下游 `.o` 目标文件 100% 零重编！**

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

---

## 6. 包管理与模块解析静态诊断错误码 (`E0501` ~ `E0505`)

| 错误码 ID | 所属阶段 | 触发条件 | `--ai-json` 确定性修复建议 |
| :--- | :---: | :--- | :--- |
| **`E0501_WILDCARD_IMPORT_FORBIDDEN`** | Phase 1 | 使用了通配符导入 `import std::collections::*` | 替换为显式符号列表 `import std::collections::{Vec, HashMap}` 或模块别名 |
| **`E0502_CIRCULAR_MODULE_DEPENDENCY`** | Phase 1 | 模块 `import` 依赖图存在环路（`mod_a -> mod_b -> mod_a`） | 将共享的数据结构或 `trait` 抽离至独立的底层 `.jni` 模块以打破环路 |
| **`E0503_PACKAGE_EFFECT_ESCALATION`** | Phase 2 | 导入并调用了超出 `Tapestry.toml` 中 `allow_effects` 授权范围的模块/函数（如未授权的 `AllocGC`、`IO` 或 `Unsafe`） | 移除越权调用，或在 `Tapestry.toml` 经人工审计后显式放开对应效应权限 |
| **`E0504_CONTRACT_SEMVER_BREAK`** | Phase 3 | 在非破坏性升级中修改了公开签名、新增了 `effects`、收紧了 `requires` 或削弱了 `ensures` | 恢复兼容契约，或显式升级主版本号 |
| **`E0505_VISIBILITY_VIOLATION`** | Phase 1 | 跨模块访问未标记 `pkg`/`pub` 的私有符号，或跨包访问仅标记 `pkg` 的包内符号 | 仅调用目标模块 `.jni` 中公开导出的 `pub` 符号 |
