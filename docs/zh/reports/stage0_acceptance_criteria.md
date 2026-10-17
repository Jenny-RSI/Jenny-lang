# Stage 0 测试与准出验收记录 (`Jenny-Nano v0.1` & `Jenny-Seed-10` 全量基准)

> **测试文档编号**：`TEST-STAGE0-001`  
> **关联计划**：[`../plan/stage0_jenny_nano_plan.md`](../plan/stage0_jenny_nano_plan.md)、[`../plan/stage0_seed10_expansion_plan.md`](../plan/stage0_seed10_expansion_plan.md)  
> **关联日志**：[`../log/2026-10-17_stage0_execution_log.md`](../log/2026-10-17_stage0_execution_log.md)  
> **当前状态**：🟢 **全部通过 (PASSED - Full `Jenny-Seed-10` Suite Verified)**

---

## 1. Stage 0 准出总门禁 (Gate Criteria Overview)

Stage 0 在完整 10 道黄金种子基准集（`B01` ~ `B10`）上的 4 项核心量化指标已全部完成实测并达标：

| 门禁编号 | 评测维度 | 目标阈值 (Target Gate) | 全量 10 题实测值 (`B01` ~ `B10`) | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **G0-1** | **Token 压缩比 (TCR vs Rust)** | `TCR <= 0.85`（节省 $\ge 15\%$ Token） | **`0.7564`**（全集平均节省 **24.36%**，最高省 **48.11%**） | ✅ PASS |
| **G0-2** | **`.jni` 蓝图上下文节省率 (ECC)** | 仅加载 `.jni` 接口相比完整模块节省 $\ge 60\%\sim 70\%$ | **对比 Rust 全量节省 `72.41%`**（对比 Jenny 全量节省 **`63.52%`**） | ✅ PASS |
| **G0-3** | **`@example` 契约编译与沙箱执行** | 全部基准题 `.jni` 中的 `@example` 经 `clang` 编译并 $100\%$ 通过 | **`19 / 19` (`100%`)**（10 个模块全部一次编译通过） | ✅ PASS |
| **G0-4** | **变异体 Bug 注入拦截率 (Mutation Kill Rate)** | 故意注入违反 `requires`/`ensures`/`invariant` 的实现 Bug，$100\%$ 被织入契约捕获 | **`11 / 11` (`100%`)**（覆盖 `B01` ~ `B10` 全部模块） | ✅ PASS |

---

## 2. 评测一：`Jenny-Seed-10` 全量 Token 经济学与上下文容量对比 (`G0-1` & `G0-2`)

运行 `python benchmarks/eval/measure_tokens.py` 对 `B01` ~ `B10` 共 10 个基准任务的实测统计表：

| 基准题编号与名称 | Rust Tokens (`*.rs`) | Jenny `.jni` 接口 Tokens (含 `@example` 全量) | Jenny `.jn` 实现 Tokens | Jenny 总代码 Tokens | **TCR (`Jenny / Rust`)** | **`.jni` 蓝图节省率 (vs Jenny 全量 / vs Rust)** | 结果判定 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`B01_ring_buffer`** | `877` | `247` (`489`) | `203` | `692` | **`0.7891`** (-21.09%) | `64.31%` / `71.84%` | ✅ PASS |
| **`B02_http_parser`** | `679` | `157` (`391`) | `130` | `521` | **`0.7673`** (-23.27%) | `69.87%` / `76.88%` | ✅ PASS |
| **`B03_expr_evaluator`** | `583` | `154` (`323`) | `166` | `489` | **`0.8388`** (-16.12%) | `68.51%` / `73.58%` | ✅ PASS |
| **`B04_lru_ttl_cache`** | `709` | `223` (`430`) | `134` | `564` | **`0.7955`** (-20.45%) | `60.46%` / `68.55%` | ✅ PASS |
| **`B05_order_pipeline`** | `950` | `193` (`320`) | `173` | `493` | **`0.5189`** (-48.11%) | `60.85%` / `79.68%` | ✅ PASS |
| **`B06_log_aggregator`** | `623` | `181` (`355`) | `155` | `510` | **`0.8186`** (-18.14%) | `64.51%` / `70.95%` | ✅ PASS |
| **`B07_audio_normalizer`** | `552` | `145` (`320`) | `138` | `458` | **`0.8297`** (-17.03%) | `68.34%` / `73.73%` | ✅ PASS |
| **`B08_storage_decorator`** | `599` | `186` (`365`) | `91` | `456` | **`0.7613`** (-23.87%) | `59.21%` / `68.95%` | ✅ PASS |
| **`B09_order_fsm`** | `820` | `272` (`471`) | `139` | `610` | **`0.7439`** (-25.61%) | `55.41%` / `66.83%` | ✅ PASS |
| **`B10_concurrent_aggregator`** | `541` | `155` (`321`) | `130` | `451` | **`0.8336`** (-16.64%) | `65.63%` / `71.35%` | ✅ PASS |
| **`Jenny-Seed-10` 汇总 / 平均** | **`6933`** | **`1913` (`3785`)** | **`1459`** | **`5244`** | **`0.7564` (-24.36%)** | **`63.52%` / `72.41%`** | ✅ **PASS** |

---

## 3. 评测二：v2.0 语法合规性与静态红线检查 (`B01` ~ `B10`)

全部 10 个模块的 `.jni` 与 `.jn` 源码均通过 [`benchmarks/eval/measure_tokens.py`](../../benchmarks/eval/measure_tokens.py) 静态扫描：

| 检查项 ID | 规则描述 | 违禁模式 (Forbidden Patterns) | 期望检出数 | 10 模块实测检出数 | 状态 |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **SYN-01** | 严禁 Rust 式引用符号 | `&T`, `&mut T`, `&self`, `&mut self`, `&*T`, `&^T` | `0` | **`0`** | ✅ PASS |
| **SYN-02** | 严禁显式生命周期与旧视图关键字 | `<'a>`, `view struct` | `0` | **`0`** | ✅ PASS |
| **SYN-03** | 严禁旧版条件绑定与宏符号 | `if let`, `#if`, `@meta`, `? :` | `0` | **`0`** | ✅ PASS |
| **SYN-04** | `.jni` 顶层严禁文档注释符 | `///`, `//!` | `0` | **`0`** | ✅ PASS |
| **SYN-05** | 具名非 `void` 函数必须显式 `return` | 函数末尾隐式表达式返回 | `0` | **`0`** | ✅ PASS |

---

## 4. 评测三：`@example` 契约织入与 C99 沙箱执行 (`G0-3`)

运行 `python compiler/jenny-nano/jenny_nano.py`，对 `B01` ~ `B10` 共 10 个模块、19 个 `@example` 沙箱测试的编译与运行实测表：

| 测试用例 ID | 所属基准题 | 验证的契约特性 | C99 编译耗时 | `@example` 运行结果 | 运行耗时 | 状态 |
| :--- | :--- | :--- | :---: | :--- | :---: | :---: |
| **EX-B01-01** | `B01_ring_buffer` | `RingBuffer` 不变量 + `push`/`pop` 正常路径与 `old(self.len)` 校验 | `532.9 ms` | `[PASS] EX-B01-01` | `11.4 ms` | ✅ PASS |
| **EX-B01-02** | `B01_ring_buffer` | `requires ... else RingError.Full` 及 `Empty` 边界触发 | (同模块) | `[PASS] EX-B01-02` | `10.2 ms` | ✅ PASS |
| **EX-B02-01** | `B02_http_parser` | 零拷贝 `str` 切片解析 HTTP/1.1 请求行与 `ensures` 校验 | `235.9 ms` | `[PASS] EX-B02-01` | `11.2 ms` | ✅ PASS |
| **EX-B02-02** | `B02_http_parser` | 非法请求触发 `requires ... else ParseError` 与 `guard ... else` | (同模块) | `[PASS] EX-B02-02` | `9.1 ms` | ✅ PASS |
| **EX-B03-01** | `B03_expr_evaluator` | 四则运算求值与 `[min_bound, max_bound]` 闭区间限幅不变量 | `239.1 ms` | `[PASS] EX-B03-01` | `12.1 ms` | ✅ PASS |
| **EX-B03-02** | `B03_expr_evaluator` | 除零保护 `DivisionByZero`、无效操作符与非法上下界拦截 | (同模块) | `[PASS] EX-B03-02` | `10.7 ms` | ✅ PASS |
| **EX-B04-01** | `B04_lru_ttl_cache` | 缓存命中计数递增 `old(self.hits) + 1`、LRU 时间戳更新与 TTL 续期 | `245.3 ms` | `[PASS] EX-B04-01` | `11.8 ms` | ✅ PASS |
| **EX-B04-02** | `B04_lru_ttl_cache` | 键不匹配 `KeyMismatch` 与 TTL 过期 `EntryExpired` 拦截 | (同模块) | `[PASS] EX-B04-02` | `10.3 ms` | ✅ PASS |
| **EX-B05-01** | `B05_order_pipeline` | 三层错误截断 (`DbError -> OrderBizError \| AnyError -> i64!`) 与结算不变量 | `254.1 ms` | `[PASS] EX-B05-01` | `15.7 ms` | ✅ PASS |
| **EX-B06-01** | `B06_log_aggregator` | 流式日志级别分类累加、峰值延迟更新与健康度水位判定 | `239.6 ms` | `[PASS] EX-B06-01` | `10.9 ms` | ✅ PASS |
| **EX-B06-02** | `B06_log_aggregator` | 非法日志级别 `InvalidLevel` 与负延迟 `NegativeLatency` 拦截 | (同模块) | `[PASS] EX-B06-02` | `10.6 ms` | ✅ PASS |
| **EX-B07-01** | `B07_audio_normalizer` | PCM 采样增益放大、`[-32768, 32767]` 硬限幅后置契约与削波计数 | `244.8 ms` | `[PASS] EX-B07-01` | `12.0 ms` | ✅ PASS |
| **EX-B07-02** | `B07_audio_normalizer` | 非法采样率 `InvalidSampleRate` 与零分母增益 `InvalidGain` 拦截 | (同模块) | `[PASS] EX-B07-02` | `10.3 ms` | ✅ PASS |
| **EX-B08-01** | `B08_storage_decorator` | 存储配额累加 `old(self.used_bytes) + payload` 与读写埋点计数 | `262.4 ms` | `[PASS] EX-B08-01` | `13.0 ms` | ✅ PASS |
| **EX-B08-02** | `B08_storage_decorator` | 配额超限 `QuotaExceeded` 与空写入 `InvalidPayloadSize` 拦截 | (同模块) | `[PASS] EX-B08-02` | `9.5 ms` | ✅ PASS |
| **EX-B09-01** | `B09_order_fsm` | 订单状态机 `Created -> Paid -> Shipped -> Delivered` 与版本号递增 | `245.2 ms` | `[PASS] EX-B09-01` | `11.6 ms` | ✅ PASS |
| **EX-B09-02** | `B09_order_fsm` | 拦截未支付直接发货 `InvalidTransition` 与已发货后取消 `AlreadyTerminal` | (同模块) | `[PASS] EX-B09-02` | `9.2 ms` | ✅ PASS |
| **EX-B10-01** | `B10_concurrent_aggregator` | 双副本竞速择优 (`race`) 与多源聚合 (`all`) 延迟上界契约校验 | `224.4 ms` | `[PASS] EX-B10-01` | `11.7 ms` | ✅ PASS |
| **EX-B10-02** | `B10_concurrent_aggregator` | SLA 超时触发 `AllReplicasTimedOut` 与 `SourceTimedOut` 熔断 | (同模块) | `[PASS] EX-B10-02` | `8.8 ms` | ✅ PASS |

---

## 5. 评测四：全量 11 个变异体 Bug 注入拦截测试 (`G0-4`)

运行 `python compiler/jenny-nano/jenny_nano.py --mutate`，对覆盖 `B01` ~ `B10` 全部模块的 11 个伪造实现变异体（Mutants）执行契约拦截验证：

| 变异体 ID | 靶向基准题 | 注入的伪造实现 / Bug 描述 | 触发的契约防线 | 实测拦截结果 | 结构化诊断输出 (`function` / `condition`) | 状态 |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: |
| **MUT-B01-A** | `B01_ring_buffer` | `push` 写入元素但漏写 `self.len += 1` | `ensures` | **已拦截** (`42`) | `RingBuffer.push`: `self.len == old(self.len) + 1` | ✅ PASS |
| **MUT-B01-B** | `B01_ring_buffer` | `push` 篡改 `self.len = 99 > self.capacity` | `invariant (RingBuffer)` | **已拦截** (`42`) | `RingBuffer.push:exit`: `self.len <= self.capacity` | ✅ PASS |
| **MUT-B02-A** | `B02_http_parser` | `parse_request` 伪造空 `method: ""` 返回 | `invariant (HttpRequest)` | **已拦截** (`42`) | `parse_request:return`: `self.method.len > 0` | ✅ PASS |
| **MUT-B03-A** | `B03_expr_evaluator` | `eval_and_clamp` 跳过上限截断直接返回 `raw` | `invariant (EvalResult)` | **已拦截** (`42`) | `eval_and_clamp:return`: `self.clamped_value <= self.max_bound` | ✅ PASS |
| **MUT-B04-A** | `B04_lru_ttl_cache` | `CacheSlot.get` 返回缓存值但漏递增 `self.hits` | `ensures` | **已拦截** (`42`) | `CacheSlot.get`: `self.hits == old(self.hits) + 1` | ✅ PASS |
| **MUT-B05-A** | `B05_order_pipeline` | `settle_order` 计算错误返回负数 `final_cents = -100` | `invariant (OrderReceipt)` | **已拦截** (`42`) | `settle_order:return`: `self.final_cents >= 0` | ✅ PASS |
| **MUT-B06-A** | `B06_log_aggregator` | `ingest` 漏更新最大延迟 `max_latency_ms = 0` | `ensures` | **已拦截** (`42`) | `LogAggregator.ingest`: `self.max_latency_ms >= latency_ms` | ✅ PASS |
| **MUT-B07-A** | `B07_audio_normalizer` | `normalize_sample` 返回未限幅的溢出采样值 | `ensures` | **已拦截** (`42`) | `NormalizerState.normalize_sample`: `result >= -32768 && result <= 32767` | ✅ PASS |
| **MUT-B08-A** | `B08_storage_decorator` | `write_block` 漏累加 `used_bytes` | `ensures` | **已拦截** (`42`) | `TrackedStorage.write_block`: `self.used_bytes == old(self.used_bytes) + payload_bytes` | ✅ PASS |
| **MUT-B09-A** | `B09_order_fsm` | `OrderStateMachine.pay` 状态跃迁时漏递增版本号 `version` | `ensures` | **已拦截** (`42`) | `OrderStateMachine.pay`: `self.version == old(self.version) + 1` | ✅ PASS |
| **MUT-B10-A** | `B10_concurrent_aggregator` | `select_fastest_replica` 返回非法副本编号 `99` | `invariant (RaceOutcome)` | **已拦截** (`42`) | `select_fastest_replica:return`: `self.winner_id == 1 \|\| self.winner_id == 2` | ✅ PASS |

---

## 6. 验收结论与签字 (Sign-off)

- **最终结论**：**Stage 0 (`Jenny-Nano v0.1`) 及其全量 10 大种子基准集（`Jenny-Seed-10`：`B01` ~ `B10`）全部通过验收！**
- **准出放行**：正式批准进入 **Stage 1 (`v0.2`：深层错误截断、管道与线性控制流 / 双轨内存静态检查器)**。
