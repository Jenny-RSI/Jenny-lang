# 🧵 Spinning Jenny (`Jenny`) 编程语言

> ***“1764, the Spinning Jenny wove the Industrial Revolution. Today, Jenny weaves Human Intent and AI Intelligence into verified computer code.”***  
> *（1764 年，珍妮纺纱机织就了工业革命的序幕；今天，Jenny 将人类意图与 AI 智慧交织为可验证的计算机代码。）*

🌐 **语言切换 (Language)**: **[English (`README.md`)](./README.md)** | **简体中文** · 📄 **[中文技术论文全文](./docs/paper/spinning_jenny_paper_zh.md)** | **[English Technical Paper](./docs/paper/spinning_jenny_paper_en.md)**

---

## 🌟 什么是 Jenny？

**Spinning Jenny（简称 `Jenny`，源码后缀 `.jn` / 蓝图后缀 `.jni`）** 是一门重构“人机分工第一性原理”的 **AI 原生系统级多范式编程语言**。

传统编程语言建立在“人类手敲每一行代码”的旧假设之上，AI对于人类自然语言的模糊和不确定依靠脑补去生成代码，同时AI极快的生成速度远超人类逐行阅读与审计的生理极限，导致**人类与AI双双在黑暗中抓瞎**，被戏称为VibeCoding。是时候改变这种现状了， Jenny 从诞生之初就专为 **“人类与架构大模型定义意图与契约（`.jni`） $\times$ 编码小模型自动生成幕后实现（`.jn`） $\times$ 编译器执行零信任契约验收（`jenny`）”** 的新时代范式而设计。创新性的将五大硬核量化指标做为语言设计演化的目标，以数据驱动语言自进化。将代码的生产效率提升10倍以上，彻底解放AI时代的生产力。

* **当前完成版本**：**`v0.1` (`Jenny-Proto v0.1.0`，已完成 ✅)** —— 详见 [`docs/roadmap/roadmap_v0.1.md`](./docs/roadmap/roadmap_v0.1.md) 与学术论文 [`docs/paper/spinning_jenny_paper_zh.md`](./docs/paper/spinning_jenny_paper_zh.md)（[English Paper](./docs/paper/spinning_jenny_paper_en.md)）。
* **下一目标版本**：**`v0.2` (`Jenny-Std`：以构建 `std` 标准库为真实战场并全面对标 Rust `std`)** —— 详见 [`docs/roadmap/roadmap_v0.2.md`](./docs/roadmap/roadmap_v0.2.md)。

---

## 🔥 六大核心技术突破 (Core Innovations)

1. **📄 文学化契约蓝图（`.jni`）与幕后实现（`.jn`）物理分离**
   * `<module>.jni` 顶层直接是原生标准 Markdown 文档，形式化类型、函数签名与契约内嵌于 ```` ```jenny ```` 代码块中；
   * 跨模块导入仅需加载 `.jni` 接口声明（**节省 65.31% 自身上下文与 69.41% 相比 Rust 生产代码的上下文 Token**），且修改 `.jn` 实现不改变 `jni_abi_hash`，下游模块 **100% 零重编**。
2. **🛡️ 一等公民形式化契约与四层内生自动化验证**
   * 内置 `requires ... else Error`、`ensures (result / old)`、`struct invariant` 与 `@example`，自动织入 C99 运行时断言（违约退出码 `42`）与编译期静态赋值检查（`E0108`）；
   * 配备 `@example` 即时原生沙箱（49/49 全过）、`--fuzz` 标量契约模糊测试与 20 轮零泄漏压力重放（2,480 次调用）及 `--mutate` 26 项故障注入回归套件（13 运行时 + 13 静态，100% 拦截）。
3. **🧬 无符号三态参数与双轨三态内存 / 闭包生命期**
   * **废除 `&T`、`&mut T` 与 `<'a>`**：默认只读借用（`x: T` / `self`，调用后永不意外 Move）、排他可变借用（`mut x: T`，映射为 C99 `JN_RESTRICT`）、显式所有权移交（`own x: T`）；
   * **三轨存储与闭包正交对齐**：栈值与自动推导视图（`T` / `fn`，`E0203`/`E0205` 拦截逃逸）、原生独占堆与区域池（`*T` / `*in(arena) T` / `*fn[own ...]` 级联析构）、以及由 `effects [AllocGC]`（`E0204`）门控的托管共享句柄（`^T` / `^fn`）。
4. **⚡ 三层错误截断、`@spin` 白盒元编程与零胶水 C FFI**
   * 16 字节双寄存器内联 `JnAnyError`（`T!`）+ 16 槽位线程局部错误轨迹环；
   * `delegate` 零样板委托与 `@spin` / `@apply` 白盒展开（落盘 `.spun/*.spun.jn`，在 `B19`~`B21` 实现 **`11.37x` 手写实现压缩**）；
   * `import c "header.h"` 零胶水 C FFI，强制 `.as_raw_ptr()`（`E0401`）、`effects [Unsafe]`（`E0402`）并禁止向 C 传递 `^T`（`E0403`）。

---

## 🚀 快速复现与验证命令

```powershell
# 1. 复现 B01~B25 全量 Token 经济学数据 (TCR / TCR_impl / ECC)
python benchmarks/eval/measure_tokens.py

# 2. 运行 Stage 0 运行时契约故障回归套件 (11/11 拦截，退出码 42)
python compiler/jenny-nano/jenny_nano.py --mutate

# 3. 编译全部 25 个模块为 C99 原生机器码，执行 49 个 @example 沙箱与 15 项 Stage 1~4 变异测试
python compiler/jenny-flow/jenny_flow.py --mutate --build-native

# 4. 运行契约模糊测试与 20 轮零泄漏压力重放 (2,480 次调用)
python compiler/jenny-flow/jenny_flow.py --fuzz
```

---

## 📖 中文文档导航 (`docs/zh/`)

* **论文与路线图**：
  * [《Spinning Jenny 学术论文全文 (中文)》](./docs/paper/spinning_jenny_paper_zh.md) · [English Paper](./docs/paper/spinning_jenny_paper_en.md)
  * [《全局版本演进路线图 (`v0.1 -> v1.0`)》](./ROADMAP_zh.md) · [`v0.1` 路线图归档](./docs/zh/roadmap/roadmap_v0.1.md) · [`v0.2 (Jenny-Std)` 标准库实战路线图](./docs/zh/roadmap/roadmap_v0.2.md)
  * [《`v0.1` 阶段性总结与 Rust / Go 横向对比报告》](./docs/zh/reports/jenny_v1_retrospective_and_cross_lang_comparison.md)
* **架构宪章与语言规范 v2.0 (`docs/zh/design/`)**：
  * [《Jenny 语言设计宪章与 AI 原生架构总纲》](./docs/zh/design/哲学与总纲.md)
  * [《渐进式实证演进方案与最小验证集》](./docs/zh/design/演进路线与最小验证集.md)
  * [《对象生命期管理：AI 跨语言痛点与实证基线》](./docs/zh/design/对象生命期管理_AI跨语言痛点与实证基线.md)
  * [《Jenny 语言核心规范 v2.0 分卷 (00 ~ 11)》](./docs/zh/design/specs/00_index_and_overview.md)
* **各阶段验收报告 (`docs/zh/reports/`)**：
  * [Stage 0 验收](./docs/zh/reports/stage0_acceptance_criteria.md) · [Stage 1 验收](./docs/zh/reports/stage1_acceptance_criteria.md) · [Phase 1 Ollama 3B 评测](./docs/zh/reports/phase1_local_llm_eval_report.md) · [Stage 2 验收](./docs/zh/reports/stage2_acceptance_criteria.md) · [Stage 3 验收](./docs/zh/reports/stage3_acceptance_criteria.md) · [Stage 4 验收](./docs/zh/reports/stage4_acceptance_criteria.md)
