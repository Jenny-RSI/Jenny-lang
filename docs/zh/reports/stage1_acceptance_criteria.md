# Stage 1 测试与准出验收记录 (`Jenny-Flow v0.2`)

> **测试文档编号**：`TEST-STAGE1-001`  
> **关联计划**：[`../plan/stage1_jenny_flow_plan.md`](../plan/stage1_jenny_flow_plan.md)  
> **关联日志**：[`../log/2026-10-17_stage1_execution_log.md`](../log/2026-10-17_stage1_execution_log.md)  
> **关联路线图**：[`../../ROADMAP.md`](../../ROADMAP.md)  
> **当前状态**：🟢 **全部通过 (PASSED - Gate 1 Cleared)**

---

## 1. Stage 1 准出总门禁 (Gate Criteria Overview)

Stage 1 (`Jenny-Flow v0.2`) 的 5 项核心量化与架构门禁已全部完成实测并达标：

| 门禁编号 | 评测维度 | 目标阈值 (Target Gate) | 当前实测值 | 状态 |
| :--- | :--- | :--- | :--- | :---: |
| **G1-1** | **16 字节 `AnyError` 与零成本 RingBuffer 物理约束** | `sizeof(JnAnyError) == 16` 编译期断言通过，16 槽轨迹环零堆分配并精确记录传播链 | **`sizeof(JnAnyError) == 16`**，0 堆分配，`trace_depth() == 4` 精确命中 | ✅ PASS |
| **G1-2** | **四层调用链 Token 压缩比 (`B11_layered_gateway`)** | `TCR <= 0.55`（相比等价 Rust 节省 $\ge 45\%$ Token） | **`0.5288`**（`625 / 1,182` Tokens，节省 **47.12%**） | ✅ PASS |
| **G1-3** | **底层错误扩展对上层签名的解耦率** | 底层新增基础设施错误变体时，中间层与顶层 `.jni`/`.jn` 签名修改行数为 `0` | **`0` 行修改**（由 `AnyError` 与 `T!` 自动吸收） | ✅ PASS |
| **G1-4** | **全量基准编译与 `@example` 沙箱执行 (`B01` ~ `B12`)** | `Seed-10` + `Stage1-Flow` 共 12 个模块、23 个 `@example` 与 13 个变异体拦截 $100\%$ 通过 | **12 模块 / `23/23` `@example` / `13/13` 变异拦截 (`100%`)** | ✅ PASS |
| **G1-5** | **400-Token 语法速查卡与 `--ai-json` 自愈闭环验证** | 语法卡 $\le 400$ Tokens；`llm_eval_harness.py` 自愈管线（报错诊断 $\rightarrow$ 自动修复）100% 跑通 | 语法卡 **`391` Tokens**；模拟先验报错 Round-2 自愈率 **`3/3` (`100%`)** | ✅ PASS |

---

## 2. 评测一：16 字节 `AnyError` 与 Error Trace RingBuffer 物理验证 (`G1-1`)

通过 [`compiler/jenny-flow/jenny_rt.h`](../../compiler/jenny-flow/jenny_rt.h) 与 `clang.exe -std=c11 -O1 -Wall` 实测验证：

| 物理指标 / 测试项 | 规范要求 | 实测结果 | 状态 |
| :--- | :--- | :--- | :---: |
| **`sizeof(JnAnyError)` 编译期静态断言** | `_Static_assert(sizeof(JnAnyError) == 16)` | **12 个模块编译期断言 100% 通过，运行时输出 `sizeof(JnAnyError)=16`** | ✅ PASS |
| **$\le 8$ 字节错误负载堆分配次数** | `0` 次 `malloc`（100% 内联于 `payload.inline_i64`） | **`0` 次堆分配** | ✅ PASS |
| **跨 4 层函数 `?` 传播的 RingBuffer 轨迹深度** | 自动记录 `db_get_price (raise) -> repo_resolve_price (?) -> service_settle_checkout (?) -> controller_handle_checkout (?)` | **`EX-B11-02`: `assert(trace_depth() == 4)` 100% 通过** | ✅ PASS |
| **`catch` 就地恢复与 `is` 动态向下还原** | 支持拦截底层 `RedisError` 降级回源 DB，并在顶层动态还原 `DbError.Deadlock` | **`EX-B11-01` & `EX-B11-02` 100% 通过** | ✅ PASS |

---

## 3. 评测二：Stage 1 新增基准与全量 12 题 Token 经济学对比 (`G1-2` & `G1-3`)

运行 `python benchmarks/eval/measure_tokens.py` 的实测统计表：

| 基准题编号与名称 | Rust Tokens (`*.rs`) | Jenny `.jni` 接口 Tokens (全部代码 Tokens) | Jenny `.jn` 实现 Tokens | Jenny 总代码 Tokens | **TCR (`Jenny / Rust`)** | **`.jni` 蓝图节省率 (vs Jenny 全量 / vs Rust)** | 结果判定 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`B11_layered_gateway` (四层网关调用链)** | `1182` | `225` (`393`) | `232` | `625` | **`0.5288`** (-47.12%) | `64.00%` / **`80.96%`** | ✅ PASS |
| **`B12_stream_pipeline` (`\|>` 管道与 `??` 空合并)** | `442` | `61` (`221`) | `145` | `366` | **`0.8281`** (-17.19%) | **`83.33%`** / **`86.20%`** | ✅ PASS |
| **Stage 1 新增基准小计 (`B11` + `B12`)** | **`1624`** | **`286` (`614`)** | **`377`** | **`991`** | **`0.6102` (-38.98%)** | **`71.14%` / `82.39%`** | ✅ PASS |
| **`B01` ~ `B12` 全集 12 题总计** | **`8557`** | **`2199` (`4399`)** | **`1836`** | **`6235`** | **`0.7286` (-27.14%)** | **`64.73%` / `74.30%`** | ✅ **PASS** |

---

## 4. 评测三：`B11` & `B12` `@example` 沙箱执行与变异体拦截 (`G1-4`)

### 4.1 Stage 1 `@example` 执行矩阵（连同 `B01`~`B10` 共 23 个用例全部通过）
| 测试用例 ID | 所属基准题 | 验证的 Stage 1 特性 | C99 编译耗时 | `@example` 运行结果 | 运行耗时 | 状态 |
| :--- | :--- | :--- | :---: | :--- | :---: | :---: |
| **EX-B11-01** | `B11_layered_gateway` | 四层调用链正常路径、具名参数调用与 `catch` 缓存故障自动降级回源 | `217.6 ms` | `[PASS] EX-B11-01 (sizeof(JnAnyError)=16)` | `10.3 ms` | ✅ PASS |
| **EX-B11-02** | `B11_layered_gateway` | 底层 `DbError.Deadlock` 经 4 层 `?` 截断传播后的 `is` 动态识别与 `trace_depth() == 4` 验证 | (同模块) | `[PASS] EX-B11-02 (sizeof(JnAnyError)=16)` | `8.0 ms` | ✅ PASS |
| **EX-B12-01** | `B12_stream_pipeline` | `i64?` 可空参数、`??` 空合并默认值与 `\|>` 三级函数式管道流式计算 | `207.3 ms` | `[PASS] EX-B12-01 (sizeof(JnAnyError)=16)` | `9.7 ms` | ✅ PASS |
| **EX-B12-02** | `B12_stream_pipeline` | 管道入口负缩放因子 `NegativeScale` 与越界输入 `RawOutOfRange` 前置契约拦截 | (同模块) | `[PASS] EX-B12-02 (sizeof(JnAnyError)=16)` | `8.1 ms` | ✅ PASS |

### 4.2 Stage 1 新增变异体拦截测试
| 变异体 ID | 靶向基准题 | 注入的伪造实现 / Bug 描述 | 触发的契约防线 | 实测拦截结果 | 结构化诊断输出 (`function` / `condition`) | 状态 |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: |
| **MUT-B11-A** | `B11_layered_gateway` | 网关结算篡改税费计算导致 `total_charged < subtotal` | `invariant (GatewayReceipt)` | **已拦截** (`42`) | `service_settle_checkout:return`: `self.total_charged >= self.subtotal` | ✅ PASS |
| **MUT-B12-A** | `B12_stream_pipeline` | 管道漏掉 `clamp_score(0, 1000)` 阶段导致结果越界 | `ensures` | **已拦截** (`42`) | `execute_pipeline`: `result >= 0 && result <= 1000` | ✅ PASS |

---

## 5. 评测四：400-Token 语法速查卡与 `--ai-json` 自愈管线验证 (`G1-5`)

运行 `python benchmarks/eval/llm_eval_harness.py --provider mock` 实测结果：

| 验证项 / 用例 ID | 模拟的大模型先验错误场景 | Round 1 检出诊断码 | Round 2 自动修复与 `@example` 沙箱结果 | 容错吸收分号数 | 状态 |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **语法速查卡预算** | [`benchmarks/eval/jenny_syntax_card.md`](../../benchmarks/eval/jenny_syntax_card.md) | N/A | **`391` Tokens**（满足 $\le 400$ Tokens 门禁） | N/A | ✅ PASS |
| **HEAL-01 (`B01`)** | 模拟 Rust 肌肉记忆：在 `RingBuffer` 中写出 5 处 `&mut self` 与 `&self` | `5x E0101_FORBIDDEN_REF_SYNTAX` | **Round 2 100% 修复并通过全部 `@example`** | `0` | ✅ PASS |
| **HEAL-02 (`B05`)** | 模拟 Rust/TS 肌肉记忆：在 `OrderPipeline` 中写出 `let` 绑定与句尾 `;` | `1x E0102_FORBIDDEN_LET_BINDING` | **Round 2 100% 修复并通过全部 `@example`** | `1` (自动容错吸收) | ✅ PASS |
| **HEAL-03 (`B11`)** | 模拟在四层网关 `LayeredGateway` 中写出 `let unit_price` 与句尾 `;` | `1x E0102_FORBIDDEN_LET_BINDING` | **Round 2 100% 修复并通过全部 `@example`** | `1` (自动容错吸收) | ✅ PASS |

---

## 6. 验收结论与签字 (Sign-off)

- **最终结论**：**Stage 1 (`Jenny-Flow v0.2`) 编译器、16 字节 `AnyError` 运行时、四层网关基准与 LLM 自愈评测管线全部通过验收！**
- **下一步行动**：
  1. 待本机部署开源代码大模型（如 Ollama `Qwen2.5-Coder`）后，直接运行 `python benchmarks/eval/llm_eval_harness.py --provider ollama` 采集真实模型盲写数据；
  2. 编译器演进轨正式获准进入 **Stage 2 (`Jenny-Mem v0.3`：双轨内存 `*T`/`^T` 与三态参数借用/所有权静态检查器)**。
