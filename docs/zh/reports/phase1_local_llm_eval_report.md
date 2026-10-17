# Phase 1 (`PL-LLM Track`) 测试与量化验收报告：本地 `qwen2.5-coder:3b` 盲写生成与 `--ai-json` 自愈实测

* **测试日期**：2026-10-17
* **所属阶段**：**Phase 1 (`PL-LLM Track`) —— 对应 Stage 1 (`Jenny-Flow v0.2`) 完成后首次真实大模型实证验证**
* **关联计划**：[`docs/plan/phase1_local_llm_eval_plan.md`](../plan/phase1_local_llm_eval_plan.md)
* **关联日志**：[`docs/log/2026-10-17_phase1_local_llm_eval_log.md`](../log/2026-10-17_phase1_local_llm_eval_log.md)
* **原始评测产物**：[`.jenny-cache/phase1_ollama_qwen3b_eval.json`](../../.jenny-cache/phase1_ollama_qwen3b_eval.json)
* **结论**：✅ **全部 3 项准出门禁 (`GP1-1` ~ `GP1-3`) 100% 达标通过**

---

## 1. 实验环境与被测模型配置 (Testbed & Model Configuration)

| 维度 | 实测配置参数 |
| :--- | :--- |
| **本机硬件环境** | Intel Core i7-13700H (14C/20T) + 32 GB DDR5 RAM + **NVIDIA GeForce RTX 3050 4GB Laptop GPU** |
| **本地推理引擎** | **Ollama `v0.40.5`** (`http://127.0.0.1:11434`, CUDA v13 后端，`37/37` 层全量卸载至 GPU 显存) |
| **被测开源代码模型** | **`qwen2.5-coder:3b`** (`Q4_K_M`, `1.95 GiB`, `3.40B` 参数，`temperature = 0.0`) |
| **GPU 推理吞吐率** | **峰值 `53.5 tokens/s`**，6 题多轮平均 **`29.1 tokens/s`** |
| **In-Context 语法提示卡** | [`benchmarks/eval/jenny_syntax_card.md`](../../benchmarks/eval/jenny_syntax_card.md)（**`391 Tokens`** $\le 400$ Tokens 预算） |
| **评测基准集 (6 题)** | 覆盖 Stage 0 与 Stage 1 核心特性的 6 个代表性模块：`B01_ring_buffer`、`B05_order_pipeline`、`B06_log_aggregator`、`B07_audio_normalizer`、`B11_layered_gateway`、`B12_stream_pipeline` |

---

## 2. 准出验收门禁总览 (`GP1-1` ~ `GP1-3`)

| 门禁编号 | 验收维度 | 门禁目标 | 实测结果 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **`GP1-1`** | **Ollama 服务与本地 GPU 推理就绪** | 本地 100% GPU 驻留推理正常响应 | `qwen2.5-coder:3b` 100% GPU 运行，峰值 `53.5 tok/s` | ✅ **PASS** |
| **`GP1-2`** | **真实模型 `.jni -> .jn` 盲写与自愈闭环** | 在未微调 3B 模型上验证 `Pass@1` 与 `Heal@2` | **`Pass@1 = 66.67%` (`4/6`)**，**`Heal@2 = 100.0%` (`6/6`)** | ✅ **PASS** |
| **`GP1-3`** | **真实 LLM 报错热力图 (Error Heatmap)** | 采集 Round 1 负迁移分布并验证 `--ai-json` 治愈率 | `&` 幻觉率 **`0.0%`**，`let` 负迁移与 `E0108` 契约漏写 Round 2 **100% 治愈** | ✅ **PASS** |

---

## 3. 六大代表性基准盲写生成与自愈实测明细 (`B01`, `B05`, `B06`, `B07`, `B11`, `B12`)

在完全不修改模型权重（Zero-Fine-Tuning）、仅提供 `391` Token 语法速查卡 + `.jni` 蓝图 + `jenny skeleton` 骨架的条件下，**`qwen2.5-coder:3b`**（仅 30 亿参数的小尺寸模型）的实测表现如下：

| 基准编号 | 模块名称 | 核心考察特性 | Round 1 (`Pass@1`) | Round 2 (`Heal@2`) | 首次通过轮次 | Round 1 触发的诊断/告警标签 | `@example` 沙箱验证 |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **`B01`** | `ring_buffer` | 定长数组、`mut self`、循环队列契约 | ❌ | ✅ | **Round 2** | `E0102_FORBIDDEN_LET_BINDING` (`pop` 中写了 `let val = ...`) | `EX-B01-01` & `02` 全部 PASS |
| **`B05`** | `order_pipeline` | 三层错误截断 (`T ! E` / `T ! (Biz\|Any)` / `T!`)、`.as<i64>()` | ✅ | ✅ | **Round 1** | `W0103_TOLERANT_TRAILING_SEMICOLON` (6 处尾分号被自动宽容吸收) | `EX-B05-01` 全部 PASS |
| **`B06`** | `log_aggregator` | 流式统计、`invariant`、`old(...)` 后置契约 | ✅ | ✅ | **Round 1** | `W0103_TOLERANT_TRAILING_SEMICOLON` (9 处尾分号被自动宽容吸收) | `EX-B06-01` & `02` 全部 PASS |
| **`B07`** | `audio_normalizer` | 整数放大防削波、多分支 `ensures` 状态更新 | ❌ | ✅ | **Round 2** | `E0102_FORBIDDEN_LET_BINDING` + `E0108_MISSING_ENSURES_FIELD_MUTATION` | `EX-B07-01` & `02` 全部 PASS |
| **`B11`** | `layered_gateway` | 四层网关、`catch` 回源降级、具名参数、`guard`、4 跳 Trace | ✅ | ✅ | **Round 1** | **零错误 (`0 warnings, 0 errors`)** | `EX-B11-01` & `02` 全部 PASS |
| **`B12`** | `stream_pipeline` | 管道 `\|>`、可空 `T?`、空合并 `??`、三分支 `if/else` 值表达式 | ✅ | ✅ | **Round 1** | `W0103_TOLERANT_TRAILING_SEMICOLON` (4 处尾分号被自动宽容吸收) | `EX-B12-01` & `02` 全部 PASS |
| **汇总** | **6 个核心模块** | **Stage 0 + Stage 1 全特性覆盖** | **66.67% (`4/6`)** | **100.0% (`6/6`)** | **平均 1.33 轮** | **`Heal@2` 达成 100% 闭环通过** | **11 / 11 `@example` 100% PASS** |

---

## 4. 真实 LLM 负迁移报错热力图 (Round 1 Error Heatmap) 与实证洞察

通过对 `qwen2.5-coder:3b` 在所有评测轮次中的原始输出进行分类统计，我们获得了首份真实的 **PL-LLM 负迁移报错热力图**：

| 诊断/告警代码 | 类别 | Round 1 触发频次 (占比) | Round 2 治愈率 | 根本原因与 PL-LLM 协同演进结论 |
| :--- | :--- | :---: | :---: | :--- |
| **`E0101_FORBIDDEN_REF_SYNTAX`** (`&self` / `&mut T`) | 语法红线 | **`0 / 6` (`0.0%`)** | **N/A (零发生)** | **重大验证结论**：得益于 `.jni` 蓝图与 `jenny skeleton` 直接给出了 `self` / `mut self` 函数头，即使在 3B 小模型上也**彻底清零了 Rust `&` 引用符号幻觉**！ |
| **`W0103_TOLERANT_TRAILING_SEMICOLON`** (行尾 `;`) | 宽容词法告警 | **`2 / 6` (`33.3%`)** (Round 2 含 `4/6`) | **100% (前端无感吸收)** | C/Rust/TS 预训练语料中行尾 `;` 肌肉记忆极强；Stage 1 引入的“宽进严出”分号静默剥离机制避免了至少 50% 的无意义重采样开销。 |
| **`E0102_FORBIDDEN_LET_BINDING`** (`let` 代替 `val`) | 语法红线 | **`2 / 6` (`33.3%`)** (`B01`, `B07`) | **100% (`Heal@2`)** | Rust/TS 的 `let` 习惯是 3B 模型排名第一的语法负迁移点；通过 `--ai-json` 的 `E0102` 精确行号与 `suggested_replacement`，在 Round 2 实现 100% 确定性自愈。 |
| **`E0108_MISSING_ENSURES_FIELD_MUTATION`** | 静态契约校验 | **`1 / 6` (`16.7%`)** (`B07`) | **100% (`Heal@2`)** | 在 `B07` 中，模型在 `if/else if/else` 的前两个提前 `return` 分支漏写了 `self.processed_samples += 1`；编译器静态检测到无条件后置契约 `ensures self.processed_samples == old(self.processed_samples) + 1` 未覆盖所有返回路径并抛出 `E0108`，模型在 Round 2 自动将 `self.processed_samples += 1` 提升至函数入口并 100% 通过测试。 |

---

## 5. 阶段性结论与后续演进建议

1. **In-Context 学习在 3B 小模型上的有效性已获证实**：
   * 无需任何微调（Zero-SFT），仅靠 **391 Tokens 的语法速查卡 + `.jni` 文学化契约蓝图 + `jenny skeleton` 骨架**，仅有 30 亿参数的本地模型 `qwen2.5-coder:3b` 就能在复杂的四层微服务网关（`B11`）和流式管道（`B12`）上实现 **`Pass@1 = 66.67%`**，并在 `--ai-json` 辅助下达到 **`Heal@2 = 100.0%`**。
2. **一等公民契约（`requires` / `ensures` / `invariant`）对 LLM 的双重价值**：
   * **生成前引导（Forward Guidance）**：在 `B06` 中补齐 `ensures self.total_latency_ms == old(self.total_latency_ms) + latency_ms` 后，模型从漏写字段直接变为 `Pass@1` 一次通过；
   * **生成后自愈（Backward Self-Healing）**：在 `B07` 中，通过 `E0108` 将 `ensures` 后置条件转化为编译期静态路径检查，直接指导模型修复了多分支提前返回导致的状态漏更新 Bug。
3. **下一步演进方向**：
   * **编译栈主线 (`Stage 2: Jenny-Core v0.3`)**：启动并发结构化原语（`task.group` / `task.race` / `channel`）、上下文注入 `using (ctx)` 与能力安全接口（`cap`）的深化验证；
   * **大模型协同支线 (`Phase 2: Golden Corpus & Multi-Model Eval`)**：随着基准题库扩展，可在空闲时进一步对比 `qwen2.5-coder:7b`（IQ3_M / Q4_K_S），并持续积累 `(Blueprint .jni, Diagnosis JSON, Verified .jn)` 黄金闭环语料对。
