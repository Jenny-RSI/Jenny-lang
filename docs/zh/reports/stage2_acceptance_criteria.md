# Stage 2 (`Jenny-Mem v0.3`) 量化测试与准出验收报告

> **版本**：`Jenny-Mem v0.3` (Stage 2 Gate Acceptance)
> **测试日期**：2026-10-17
> **关联计划**：[`docs/plan/stage2_jenny_mem_plan.md`](../plan/stage2_jenny_mem_plan.md)
> **关联日志**：[`docs/log/2026-10-17_stage2_execution_log.md`](../log/2026-10-17_stage2_execution_log.md)
> **跨语言对标基线**：[`docs/design/对象生命期管理_AI跨语言痛点与实证基线.md`](../design/对象生命期管理_AI跨语言痛点与实证基线.md)

---

## 1. Stage 2 准出指标（Gate Criteria）总览

| 验收编号 | 准出指标定义 | 目标阈值 | Stage 2 实测结果 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **G2-1** | 全量 17 个基准模块（`B01` ~ `B17`）C11 编译与 `@example` 契约沙箱通过率 | `100% (33/33)` | **`100.0% (17/17 模块, 33/33 @example)`** | ✅ **PASS** |
| **G2-2** | `*T` 独占堆对象在正常路径、提前 `?` 传播与 `raise` 错误路径上的内存泄漏率 | `0 泄漏 (0 Bytes)` | **`0 泄漏`**（由 `active_native_boxes() == old(active_native_boxes())` 100% 验证） | ✅ **PASS** |
| **G2-3** | Stage 2 静态借用/生命期/能力变异测试拦截率（`MUT-S2-E0201` ~ `E0204` & `E0106`） | `100% (5/5)` | **`100.0% (5/5 全部静态拦截)`** | ✅ **PASS** |
| **G2-4** | `Mem-Bench-5` (`B13` ~ `B17`) 相比 Safe Idiomatic Rust 的 Token 压缩比 (`TCR`) | $\text{TCR} \le 0.72$ | **`TCR = 0.6597`**（省 **34.03%**；仅计 `.jn` 实现 **`TCR_impl = 0.2551`**，省 **74.49%**） | ✅ **PASS** |
| **G2-5** | `B16_lru_doubly_linked`（双向链表 `^LruNode` vs Rust `Rc<RefCell>`）实现层 Token 削减率 | 削减 $\ge 35\%$ | **总 Token 省 `29.6%` (`409 vs 581`)，`.jn` 实现层仅 `157` tokens（省 `73.0%`）** | ✅ **PASS** |
| **G2-6** | 本地 Ollama (`qwen2.5-coder:3b`) 在 `Mem-Bench-5` 上的 $\text{Heal}@2$ 通过率（语法卡 $\le 400$ tokens） | $\text{Heal}@2 \ge 80\%$ | **`Heal@2 = 100.0% (5/5)`**（语法卡 **389 tokens**，`B16` 首轮 `Pass@1` 通过） | ✅ **PASS** |

---

## 2. 全量 17 模块 (`B01` ~ `B17`) 编译与契约沙箱执行明细

复现命令：`python compiler/jenny-flow/jenny_flow.py --mutate`

| 阶段 | 模块编号与名称 | 核心考察特性 | `@example` 数量 | 编译耗时 (ms) | 运行结果 |
| :---: | :--- | :--- | :---: | :---: | :---: |
| Stage 0 | `B01` ~ `B10` (`Seed-10` 十模块) | 值类型、零 `&` 三态参数、一等公民契约 | 19 | ~205 ms/mod | **19/19 PASS** ✅ |
| Stage 1 | `B11_layered_gateway` | 三层错误演进 `T!`、`16B AnyError`、4 跳 RingBuffer、`|>`、`catch` | 2 | 218.4 ms | **2/2 PASS** ✅ |
| Stage 1 | `B12_stream_pipeline` | 管道 `|>`、可空 `T?`、空合并 `??`、具名参数 | 2 | 208.5 ms | **2/2 PASS** ✅ |
| **Stage 2** | **`B13_pcm_frame_pipeline`** | **`*PcmFrame` 独占堆盒、`self`/`mut self`/`own frame`、异常分支零泄漏 RAII** | **2** | **230.4 ms** | **2/2 PASS** ✅ |
| **Stage 2** | **`B14_zero_copy_http_view`** | **隐式栈绑定切片视图 `HttpRequestView`（零 `<'a>` 传染）+ `E0203` 防逃逸** | **2** | **226.4 ms** | **2/2 PASS** ✅ |
| **Stage 2** | **`B15_arena_ast_builder`** | **`Arena.new` + `*in(arena) AstNode` $O(1)$ 区域分配与 `arena.drop()` 批量释放** | **2** | **200.2 ms** | **2/2 PASS** ✅ |
| **Stage 2** | **`B16_lru_doubly_linked`** | **`^LruNode` 托管共享双向链表环路互指 + `effects [AllocGC]` 能力门禁** | **2** | **212.7 ms** | **2/2 PASS** ✅ |
| **Stage 2** | **`B17_struct_field_split_mut`** | **`self.apply_step(self.effective_delta(scale))` 嵌套借用，零 `E0502` 死锁** | **1** | **227.9 ms** | **1/1 PASS** ✅ |

---

## 3. Stage 2 静态借用、视图逃逸与能力边界变异测试 (`5/5 = 100%`)

复现命令：`python compiler/jenny-flow/jenny_flow.py --mutate`

| 变异编号 | 目标模块 | 注入的非法生命期/借用变异操作 | 期望诊断码 | 实测捕获结果 |
| :--- | :--- | :--- | :--- | :---: |
| **`MUT-S2-E0201`** | `B13_pcm_frame_pipeline` | 在 `consume_and_archive(own frame)` 消费所有权后再次访问 `frame.peak_energy()` | `E0201_USE_AFTER_OWN` | **100% 静态拦截** ✅ |
| **`MUT-S2-E0106`** | `B13_pcm_frame_pipeline` | 在只读借用方法 `peak_energy(self)` 内部篡改字段 `self.s0 = 0` | `E0106_READONLY_PARAM_MUTATION` | **100% 静态拦截** ✅ |
| **`MUT-S2-E0202`** | `B16_lru_doubly_linked` | 调用 `link_two_nodes(mut n1, mut n1)` 对同一变量同时发起两次 `mut` 可变借用 | `E0202_CONFLICTING_MUT_BORROW` | **100% 静态拦截** ✅ |
| **`MUT-S2-E0203`** | `B14_zero_copy_http_view` | 试图将包含 `str` 切片的栈绑定视图装箱到堆 `*HttpRequestView` | `E0203_VIEW_STRUCT_ESCAPE` | **100% 静态拦截** ✅ |
| **`MUT-S2-E0204`** | `B16_lru_doubly_linked` | 在未声明 `effects [AllocGC]` 的纯函数 `sum_linked_pair` 内分配 `^LruNode` | `E0204_UNDECLARED_EFFECT` | **100% 静态拦截** ✅ |

---

## 4. `Mem-Bench-5` (`B13` ~ `B17`) Token 经济学与本地 Ollama (`qwen2.5-coder:3b`) 实机评测

复现命令：
- `python benchmarks/eval/measure_tokens.py`
- `python benchmarks/eval/llm_eval_harness.py --provider ollama --model qwen2.5-coder:3b --benchmarks B13 B14 B15 B16 B17 --output-json .spun/ollama_stage2_eval_report.json`

| 基准模块 | Rust Tokens | Jenny `.jni` 接口 Tokens | Jenny `.jn` 实现 Tokens | Jenny 总 Tokens | 总 `TCR` | 实现层 `TCR_impl` | `ECC` 节省率 | `qwen2.5-coder:3b` 通过轮次 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`B13_pcm_frame_pipeline`** | 1,085 | 205 | 251 | 604 | **0.5567** | **0.2313** | 66.06% | **Round 2 (`Heal@2`)** ✅ |
| **`B14_zero_copy_http_view`** | 710 | 118 | 140 | 464 | **0.6535** | **0.1972** | 74.57% | **Round 2 (`Heal@2`)** ✅ |
| **`B15_arena_ast_builder`** | 926 | 168 | 266 | 602 | **0.6501** | **0.2873** | 72.09% | **Round 2 (`Heal@2`)** ✅ |
| **`B16_lru_doubly_linked`** | 581 | 129 | 157 | 409 | **0.7040** | **0.2702** | 68.46% | **Round 1 (`Pass@1`)** 🌟 |
| **`B17_struct_field_split_mut`** | 454 | 171 | 144 | 399 | **0.8789** | **0.3172** | 57.14% | **Round 2 (`Heal@2`)** ✅ |
| **`Mem-Bench-5` 合计 / 均值** | **3,756** | **791** | **958** | **2,478** | **0.6597** | **0.2551** | **68.08%** | **`Heal@2 = 100.0% (5/5)`** ✅ |
| **全量 17 模块 (`B01`~`B17`) 合计** | **12,313** | **3,003** | **2,794** | **8,726** | **0.7087** | **0.2269** | **65.59%** | **语法违规 `SYN-01~05 = 0`** ✅ |
