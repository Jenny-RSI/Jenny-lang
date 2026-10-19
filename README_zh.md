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
## 详细介绍

* [长文详细介绍：从AI原生第一性原理出发的Spinning Jenny系统级编程语言](./docs/zh/articles/introducing_spinning_jenny_zh.md)
* [PPT介绍: AI时代的编程范式革命](./docs/zh/articles/spinning_jenny_pitch_deck_zh.pptx)
---

## 🚀 快速复现与验证命令（Node.js v24 原生 TypeScript 编译器）

```powershell
# 1. 编译全仓 40 个模块（B01~B25 + 15 个 library/std 模块），执行 79 个 @example 沙箱与 18 项 Stage 1~4 变异门禁
node compiler/src/jenny.ts --mutate

# 2. 运行全仓 40 模块契约模糊测试与 30,000 步有状态容器 Fuzzing (共 33,380 次调用，0 内存泄漏)
node compiler/src/jenny.ts --fuzz

# 3. 运行 Spindle 白盒包安全审计、供应链故障注入 (6/6) 与霍尔逻辑契约 SemVer 校验 (4/4)
node compiler/src/jenny.ts audit
node compiler/src/jenny.ts mutate
node compiler/src/jenny.ts semver-check

# 4. 复现 B01~B25 全量 Token 经济学数据 (TCR / TCR_impl / ECC)
python benchmarks/eval/measure_tokens.py
```

---

## 📖 中文文档导航 (`docs/zh/`)

* **论文与路线图**：
  * [《Spinning Jenny 学术论文全文 (中文)》](./docs/paper/spinning_jenny_paper_zh.md) · [English Paper](./docs/paper/spinning_jenny_paper_en.md)
  * [《全局版本演进路线图 (`v0.1 -> v1.0`)》](./ROADMAP_zh.md) · [`v0.1` 路线图归档](./docs/zh/roadmap/roadmap_v0.1.md) · [`v0.2 (Jenny-Std)` 标准库实战路线图](./docs/zh/roadmap/roadmap_v0.2.md)
  * [《`v0.1` 阶段性总结与 Rust / Go 横向对比报告》](./docs/zh/reports/jenny_v1_retrospective_and_cross_lang_comparison.md)
  * [《`v0.2-alpha1` 与 `v0.2-alpha2` 标准库及 Spindle 验收报告》](./docs/zh/reports/v0.2_alpha2_std_and_semver_report.md)
* **架构宪章与语言规范 v2.0 (`docs/zh/design/`)**：
  * [《Jenny 语言设计宪章与 AI 原生架构总纲》](./docs/zh/design/哲学与总纲.md)
  * [《渐进式实证演进方案与最小验证集》](./docs/zh/design/演进路线与最小验证集.md)
  * [《对象生命期管理：AI 跨语言痛点与实证基线》](./docs/zh/design/对象生命期管理_AI跨语言痛点与实证基线.md)
  * [《Jenny 语言核心规范 v2.0 分卷 (00 ~ 13)》](./docs/zh/design/specs/00_index_and_overview.md)
* **各阶段验收报告 (`docs/zh/reports/`)**：
  * [Stage 0 验收](./docs/zh/reports/stage0_acceptance_criteria.md) · [Stage 1 验收](./docs/zh/reports/stage1_acceptance_criteria.md) · [Phase 1 Ollama 3B 评测](./docs/zh/reports/phase1_local_llm_eval_report.md) · [Stage 2 验收](./docs/zh/reports/stage2_acceptance_criteria.md) · [Stage 3 验收](./docs/zh/reports/stage3_acceptance_criteria.md) · [Stage 4 验收](./docs/zh/reports/stage4_acceptance_criteria.md)
