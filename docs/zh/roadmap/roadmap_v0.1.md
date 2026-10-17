# 🗺️ Spinning Jenny `v0.1` 路线图归档 (`Jenny-Proto v0.1.0` — 已完成 ✅)

> **版本代号**：`v0.1.0` (`Jenny-Proto`: AI-Native Language Core & C99 Transpiler Prototype)  
> **版本状态**：🟢 **全部完成并封版归档 (Completed & Archived, 2026-10-17)**  
> **核心定位**：完成 **Jenny 语言规范 v2.0** 的最小闭环原型验证——跑通“`.jni` 文学化契约蓝图 + `.jn` 幕后实现物理分离”、“无符号三态参数与双轨三态内存/闭包”、“三层错误截断 + `@spin` 白盒元编程”、“AST $\rightarrow$ C99 原生后端 + 四层契约测试原型”以及“本地 `3B` 模型（`qwen2.5-coder:3b`）骨架补全与 `--ai-json` 辅助自愈实证”，产出 [`Jenny-Bench-25`](../../benchmarks/) 基准集与技术论文 [`spinning_jenny_paper_zh.md`](../paper/spinning_jenny_paper_zh.md)。  
> **上级总索引**：[`ROADMAP.md`](../../ROADMAP.md) · **下一版本规划**：[`roadmap_v0.2.md`](./roadmap_v0.2.md)

---

## 1. `v0.1` 内部五步演进里程碑总览 (`v0.1.0-alpha1` $\rightarrow$ `v0.1.0`)

在 `v0.1` 原型周期内，项目按 **编译器工具链轨（Compiler Track）** 与 **大模型验证轨（PL-LLM Track）** 完成了以下五个子里程碑：

| 内部阶段与子版本号 | 代号与核心主题 | 编译器轨核心交付 (`compiler/` & `benchmarks/`) | 模型验证轨交付 (`PL-LLM Track`) | 量化准出实测结果 | 状态 | 关联归档 (`plan` / `log` / `tests`) |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| **Stage 0 (`v0.1.0-alpha1`)** | **`Jenny-Nano`**<br>文学化契约核与 C99 沙箱 | • `compiler/jenny-nano/jenny_nano.py`<br>• `benchmarks/seed_10` (`B01`~`B10`)<br>• `benchmarks/eval/measure_tokens.py` | **Phase 0：静态 Token 经济学基线**<br>三组正交指标（`TCR_impl` / `TCR` / `ECC`）与契约变异拦截 | • `Seed-10` `TCR = 0.7583`、`TCR_impl = 0.2104`<br>• `19/19 @example` 通过，`11/11` 运行时契约变异拦截（退出码 `42`） | 🟢 **已完成** | [Plan 1](../plan/stage0_jenny_nano_plan.md) · [Plan 2](../plan/stage0_seed10_expansion_plan.md)<br>[Log 1](../log/2026-10-17_stage0_kickoff.md) · [Log 2](../log/2026-10-17_stage0_execution_log.md)<br>[Tests](../tests/stage0_acceptance_criteria.md) |
| **Stage 1 (`v0.1.0-alpha2`)** | **`Jenny-Flow`**<br>三层错误截断与线性控制流 | • `compiler/jenny-flow` (`jenny_rt.h` + `jenny_flow.py`)<br>• 16B `JnAnyError` + 16 槽位 Trace RingBuffer<br>• `B11_layered_gateway` & `B12_stream_pipeline` | **Phase 1：本地 `3B` 模型首次实测**<br>Ollama `qwen2.5-coder:3b` 实测 6 题 `Pass@1 = 66.7%`、`Heal@2 = 100%`、`&` 幻觉率 `0.0%` | • 4 层调用链 `B11` `TCR = 0.5288`<br>• 新增 `2/2` 运行时变异拦截 + `E0108` 静态契约赋值检查 | 🟢 **已完成** | [Stage 1 Plan](../plan/stage1_jenny_flow_plan.md) · [Phase 1 Plan](../plan/phase1_local_llm_eval_plan.md)<br>[Stage 1 Log](../log/2026-10-17_stage1_execution_log.md) · [Phase 1 Log](../log/2026-10-17_phase1_local_llm_eval_log.md)<br>[Stage 1 Tests](../tests/stage1_acceptance_criteria.md) · [Phase 1 Tests](../tests/phase1_local_llm_eval_report.md) |
| **Stage 2 (`v0.1.0-beta1`)** | **`Jenny-Mem`**<br>双轨内存 (`*T`/`^T`) 与三态借用 | • `jenny_rt.h` 原生独占堆 (`*T`)、区域池 (`*in(arena) T`) 与池化托管句柄原型 (`^T`)<br>• 静态借用/视图检查 (`E0106`, `E0201`~`E0204`)<br>• `Mem-Bench-5` (`B13`~`B17`) | **Phase 2：双轨内存 `3B` 实测**<br>`Mem-Bench-5` 总体 `TCR = 0.6597`、`TCR_impl = 0.2551`，`3B` 模型 `Heal@2 = 100% (5/5)` | • `5/5` 静态内存安全变异拦截<br>• `B16` 双向链表零 `<'a>` 首轮 `Pass@1` 通过 | 🟢 **已完成** | [Stage 2 Plan](../plan/stage2_jenny_mem_plan.md) · [Cross-Lang Baseline](../design/对象生命期管理_AI跨语言痛点与实证基线.md)<br>[Stage 2 Log](../log/2026-10-17_stage2_execution_log.md)<br>[Stage 2 Tests](../tests/stage2_acceptance_criteria.md) |
| **Stage 3 (`v0.1.0-beta2`)** | **`Jenny-Spin`**<br>零样板委托与 `@spin` 白盒纺纱 | • 16B `dyn Trait` 胖指针 + `delegate`<br>• `@spin` / `@apply` 白盒展开器 (`fsm`, `codec`, `crud`) + `.spun/*.spun.jn`<br>• `Spin-Bench-4` (`B18`~`B21`) | **Phase 3：声明式元编程 `3B` 实测**<br>`Spin-Bench-4` 总 `TCR = 0.4767`，`@spin` 子集手写实现 `TCR_impl = 0.0879` (`11.37x`)，`3B` 模型 `Pass@1 = 75%`、`Heal@2 = 100%` | • `.spun/` 白盒展开与 `3/3` 静态变异拦截（`E0305`~`E0307`）100% 通过 | 🟢 **已完成** | [Stage 3 Plan](../plan/stage3_jenny_spin_plan.md)<br>[Stage 3 Log](../log/2026-10-17_stage3_execution_log.md)<br>[Stage 3 Tests](../tests/stage3_acceptance_criteria.md) |
| **Stage 4 (`v0.1.0`)** | **`Jenny-Native Prototype`**<br>C99 后端、ABI 防火墙、C FFI、三轨闭包与 `--fuzz` | • 25 模块 C99 原生编译 (`clang -O3`) + `.jni` ABI 防火墙 (`jni_abi_hash`)<br>• 零胶水 C FFI (`E0401`~`E0403`) + 三轨闭包 (`B25`, `E0205`~`E0206`)<br>• `--fuzz` 标量契约模糊测试与重放原型 (`2,480` 次调用) | **Phase 4：全栈实证与论文封版**<br>18 题归档评测汇总 `Pass@1 = 50.0% (9/18)`、`Heal@2 = 100.0% (18/18)`；完成中英双语论文与两轮独立审稿对齐 | • 25/25 模块 `49/49 @example` 原生沙箱全过<br>• 26 项故障回归（13 运行时 + 13 静态）100% 拦截<br>• 热缓存 `< 1ms`，25 个 `.exe` 共 `3.46 MB` | 🟢 **已完成** | [Stage 4 Plan](../plan/stage4_jenny_native_plan.md) · [Closure Plan](../plan/stage4_closure_lifetimes_plan.md)<br>[Stage 4 Log](../log/2026-10-17_stage4_execution_log.md)<br>[Stage 4 Tests](../tests/stage4_acceptance_criteria.md) · [Paper](../paper/spinning_jenny_paper_zh.md) |

---

## 2. `v0.1.0` 核心量化基线快照 (Verified Baseline Snapshot)

1. **Token 经济学 (`B01`~`B25`, `measure_tokens.py`)**：
   * Rust 完整源码（含 `#[cfg(test)]`）：`19,339` Tokens；Rust 纯生产源码（剥离 `#[cfg(test)]`）：`14,985` Tokens。
   * Jenny 代码总计（`.jni` 代码块 `8,967` + `.jn` 手写实现 `4,248`）：**`13,215` Tokens**（$\text{TCR} = 0.6833$，$\text{TCR}_{\text{vs\_prod}} = 0.8819$；若计入 `.jni` Markdown 正文 `5,040` Tokens，全文档合计 `18,255` Tokens，$\text{TCR}_{\text{doc\_all}} = 0.9439$）。
   * Jenny `.jn` 实现层（`4,248` Tokens）：**$\text{TCR}_{\text{impl}} = 0.2197$**，**$\text{TCR}_{\text{impl/prod}} = 0.2835$**（`@spin` 子集 `B19`~`B21` 为 `0.0879` / 展开后 `.spun/*.spun.jn` 为 `1,141` Tokens）。
   * 跨模块 `.jni` 纯接口契约（`4,584` Tokens）：**$\text{ECC}_{\text{self}} = 65.31\%$**，**$\text{ECC}_{\text{vs\_rs\_prod}} = 69.41\%$**。
   * 负向边界样本：`B25_closure_lifetimes`（`739` vs `420` Tokens，$\text{TCR} = 1.7595$）揭示了在 `< 500` Tokens 的极小微基准上，三轨闭包与契约声明开销会超过实现层压缩收益。
2. **契约验证与原生构建 (`jenny_nano.py` + `jenny_flow.py`)**：
   * `49/49` 个内嵌 `@example` 原生沙箱 100% 通过；
   * `26/26` 项手写故障回归套件（`11 + 2 = 13` 项运行时契约违约退出码 `42` + `13` 项编译期静态诊断 `E0106`, `E0201`~`E0206`, `E0305`~`E0307`, `E0401`~`E0403`）100% 拦截；
   * `--fuzz` 标量自由函数契约探针（15 个标量函数 $\times$ 100 次 = `1,500` 次）+ `@example` 20 轮重放与原生堆泄漏守卫（49 $\times$ 20 = `980` 次），共 **`2,480` 次调用** 零违约、零 `*T` 泄漏。
3. **本地 `3B` 模型 (`qwen2.5-coder:3b`) 18 题骨架补全与辅助自愈**：
   * `&`/`<'a>` 引用与生命周期幻觉率：`0/18 (0.0%)`；
   * 首轮盲写通过率：`Pass@1 = 50.0% (9/18)`（9 题首轮失败中 7 题为纯 `E0102` 习惯性书写 `let`）；
   * 经 `--ai-json` 诊断反馈与确定性快修辅助后次轮通过率：`Heal@2 = 100.0% (18/18)`。

---

## 3. `v0.1` 已知工程局限（驱动 `v0.2` 的演进输入）

1. **单文件微基准局限**：`B01`~`B25` 均为单模块文件（420~1,225 Rust Tokens），尚未支持多模块/多文件包导入（`import pkg::mod`）与真实中等规模工程（2,000~5,000 Tokens）联编。
2. **运行时 `^T` 仍为固定容量池化原型**：`jenny_rt.h` 中 `^T` 目前使用 1,024 槽位 `calloc` 指针表 + 显式 `jn_gc_collect_all()` 批量释放，尚未实现真正的 64KB 块结构 Immix 标记-区域回收器。
3. **缺乏同模型 Rust/Go 反事实对照组与快修消融**：尚未在同一台机器上让 `qwen2.5-coder:3b` / `7b` 同步跑 `rustc` 与 `go build` 对照实验，且未剥离测试“纯 LLM 重试 vs `apply_ai_json_fixes` 确定性快修”的独立贡献。
4. **`--fuzz` 仅覆盖标量自由函数**：尚未支持对有状态 `struct`（如 `RingBuffer`、`KvStore`）自动合成随机方法调用序列（Stateful Property-Based Fuzzing），`--diff` 差分回归尚未实现。
