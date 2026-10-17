# Stage 4 (`Jenny-Native v1.0`) 量化测试与准出验收报告

**日期**：2026-10-17  
**版本**：`Jenny-Native v1.0`  
**对应计划**：[`../plan/stage4_jenny_native_plan.md`](../plan/stage4_jenny_native_plan.md)  
**对应日志**：[`../log/2026-10-17_stage4_execution_log.md`](../log/2026-10-17_stage4_execution_log.md)

---

## 1. Stage 4 准出门槛（Gate Criteria）总览与达成结论

| 指标维度 | 准出目标 (Gate Criteria) | Stage 4 实测结果 | 验收状态 |
| :--- | :--- | :--- | :--- |
| **全量基准集 C99 原生编译与执行 (`B01`~`B24`)** | 24/24 模块 100% 编译通过，48/48 `@example` 100% 通过 | **24/24 模块 (100%)** C99 原生编译通过 (`clang 18.1.8 -O3`)，**48/48 `@example` (100%)** 断言全通过 | ✅ **PASS** |
| **`.jni` ABI 编译防火墙与增量 CAS 缓存** | 修改 `.jn` 实现且 `.jni` 不变时下游 0 重检；热缓存 100% 命中 | 热缓存 **24/24 (100%)** 命中（增量编译耗时 **`0.0 ms`**）；修改 `kv_storage_engine.jn` 后 `jni_abi_hash` 保持 `1d45502ef219c1f2` 不变，下游重检数为 **0** | ✅ **PASS** |
| **防膨胀构建产物大小 (`.jenny-cache/`)** | 单模块二进制紧凑，缓存总大小远低于 Rust `target/` (5GB+) | 单模块原生 `.exe` 平均 **`140.94 KB`**，24 个模块全部原生二进制总计仅 **`3.38 MB`** | ✅ **PASS** |
| **全阶段变异注入拦截率 (`Stage 1`~`Stage 4`)** | 13/13 变异 100% 拦截（含 C FFI 边界 `E0401`~`E0403`） | **13/13 (100%)** 全部精准拦截（Stage 1: `2/2`, Stage 2: `5/5`, Stage 3: `3/3`, Stage 4: `3/3`） | ✅ **PASS** |
| **Token 经济学 (`TCR` / $\text{TCR}_{\text{impl}}$ / `ECC`)** | `TCR <= 0.80`, $\text{TCR}_{\text{impl}} \le 0.35$, `ECC >= +50%` | 24 模块全局 **`TCR = 0.6594`**，**$\text{TCR}_{\text{impl}} = 0.2114$**（节省 **78.9%** 实现 Token），**`ECC = +65.39%` (2.89x)**；Stage 4 (`B22`~`B24`) **`TCR = 0.7540`**，**$\text{TCR}_{\text{impl}} = 0.2464$**，**`ECC = +62.73%`** | ✅ **PASS** |
| **本地小模型 (`qwen2.5-coder:3b`) 自愈闭环** | Stage 4 (`B22`~`B24`) $\text{Heal}@3 \ge 90\%$，零 C FFI 裸指针幻觉 | **`Pass@1 = 33.3% (1/3)`**，**`Heal@2 = 100.0% (3/3)`**，**`Heal@3 = 100.0% (3/3)`**，C FFI 裸指针/内存安全幻觉率 **`0.0%`** | ✅ **PASS** |

---

## 2. Stage 4 新增全栈基准集 (`B22` ~ `B24`) 实测明细

| 编号 | 模块名 | 验证核心特性 | Rust Tokens | `.jni` 接口 Tokens | `.jn` 实现 Tokens | Jenny 总 Tokens | `TCR` (总) | $\text{TCR}_{\text{impl}}$ | `ECC` 节省率 | C99 编译耗时 | `@example` 结果 |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`B22`** | [`c_ffi_crc32`](../../benchmarks/stage4_native/B22_c_ffi_crc32_hasher/c_ffi_crc32.jni) | `import c`、`@repr(C)`、`.as_raw_ptr()`、`effects [Unsafe]` | 510 | 173 | 148 | 476 | `0.9333` | **`0.2902`** | `63.66%` | `255.4 ms` | `2/2 PASS` |
| **`B23`** | [`arena_json_tokenizer`](../../benchmarks/stage4_native/B23_arena_json_tokenizer/arena_json_tokenizer.jni) | 零拷贝 `str` 扫描 + `*in(arena) JsonStats` 区域分配 | 641 | 127 | 201 | 488 | `0.7613` | **`0.3136`** | `73.98%` | `261.9 ms` | `2/2 PASS` |
| **`B24`** | [`kv_storage_engine`](../../benchmarks/stage4_native/B24_kv_storage_engine/kv_storage_engine.jni) | `@apply(codec::binary)` + `delegate KvBackend to self.inner` | 1,016 | 309 | 185 | 670 | `0.6594` | **`0.1821`** | `53.88%` | `261.5 ms` | `2/2 PASS` |
| **Stage 4 合计** | **`FullStack-App-3` (`B22`~`B24`)** | **C99 原生后端 + 零胶水 FFI + 全栈微内核** | **2,167** | **609** | **534** | **1,634** | **`0.7540`** | **`0.2464`** | **`62.73%`** | **`778.8 ms` (冷)** / **`0.0 ms` (热)** | **`6/6 PASS`** |
| **全量 24 模块合计** | **`B01` ~ `B24` 全景验证集** | **Stage 0 ~ Stage 4 全特性** | **18,919** | **4,318** | **4,000** | **12,476** | **`0.6594`** | **`0.2114`** | **`65.39%` (2.89x)** | **`0.0 ms` (CAS 热命中)** | **`48/48 PASS`** |

---

## 3. `.jni` ABI 编译防火墙与 `.jenny-cache/` 有界 CAS 缓存实测

通过 `python compiler/jenny-flow/jenny_flow.py --mutate` 实测 `.jenny-cache/` 构建引擎：

- **CAS 增量热命中率**：**`24/24 (100.0%)`**，二次全量构建编译耗时 **`0.0 ms`**。
- **防膨胀体积对比**：24 个模块全部原生可执行文件（`.jenny-cache/bin/*.exe`）平均大小 **`140.94 KB`**，总计 **`3,382.5 KB` (`3.38 MB`)**，无符号表冗余与依赖副本膨胀。
- **`.jni` ABI 防火墙隔离验证**（以 `kv_storage_engine` 为被测靶标）：
  - 修改前：`jni_abi_hash = 1d45502ef219c1f2`，`jn_impl_hash = df79714d5edf7d3a`
  - 修改 `kv_storage_engine.jn` 内部实现后：`jni_abi_hash = 1d45502ef219c1f2`（**完全一致**），`jn_impl_hash = cfc82a20d76796ab`
  - **结论**：`abi_firewall_intact = true`，`downstream_modules_rechecked = 0`（下游依赖模块零重新类型检查）。

---

## 4. Stage 4 C FFI 边界静态变异注入测试 (`MUT-S4-E0401` ~ `E0403`)

| 变异 ID | 目标模块 | 注入缺陷描述 | 期望诊断码 | 实测捕获诊断码 | 结果 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **`MUT-S4-E0401`** | `B22_c_ffi_crc32_hasher` | 将 Jenny `str` 切片 `payload` 直接传给 `c_crc::jenny_c_crc32(payload, ...)`，漏写 `.as_raw_ptr()` | `E0401_FFI_IMPLICIT_RAW_PTR` | `E0401_FFI_IMPLICIT_RAW_PTR`（自动给出 `payload.as_raw_ptr()` 修复建议） | ✅ **100% 拦截** |
| **`MUT-S4-E0402`** | `B22_c_ffi_crc32_hasher` | 从 `compute_packet_crc` 的 `.jni` 蓝图移除 `effects [Unsafe]` 后调用 `c_crc::jenny_c_crc32` | `E0402_FFI_MISSING_UNSAFE_EFFECT` | `E0402_FFI_MISSING_UNSAFE_EFFECT` | ✅ **100% 拦截** |
| **`MUT-S4-E0403`** | `B22_c_ffi_crc32_hasher` | 在 `@repr(C) pub struct CrcPacket` 中内嵌托管 GC 句柄字段 `pub bad_gc: ^CrcPacket` | `E0403_FFI_GC_PTR_TO_C` | `E0403_FFI_GC_PTR_TO_C` | ✅ **100% 拦截** |
| **`MUT-S4-E0205`** | `B25_closure_lifetimes` | 尝试在 `make_shared_scorer` 中直接返回栈借用闭包 `return fn(v) => ...` 造成栈帧逃逸悬垂 | `E0205_STACK_CLOSURE_ESCAPE` | `E0205_STACK_CLOSURE_ESCAPE` | ✅ **100% 拦截** |
| **`MUT-S4-E0206`** | `B25_closure_lifetimes` | 在逃逸闭包 `*fn(v) => ...` 中捕获独占原生堆指针 `sig: *SignalBox` 却漏写 `[own sig]` | `E0206_CLOSURE_MISSING_OWN_CAPTURE` | `E0206_CLOSURE_MISSING_OWN_CAPTURE` | ✅ **100% 拦截** |

---

## 5. 本地 `Ollama (qwen2.5-coder:3b)` Stage 4 实测结果

使用 `python benchmarks/eval/llm_eval_harness.py --provider ollama --model qwen2.5-coder:3b --benchmarks B22 B23 B24 --output-json .spun/stage4_ollama_eval.json` 实测（语法卡 `360 tokens <= 400` 预算）：

| 基准模块 | Round 1 (`Pass@1`) | Round 2 (`Heal@2`) | Round 3 (`Heal@3`) | Round 1 失败标签 | 关键实测观察 |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **`B22_c_ffi_crc32_hasher`** | ❌ (`E0102`) | ✅ **PASS (Round 2)** | ✅ **PASS** | `E0102_FORBIDDEN_LET_BINDING` | 3B 模型在首轮即正确写出 `c_crc::jenny_c_crc32(payload.as_raw_ptr(), payload.len(), seed)`，**零 FFI 裸指针幻觉**；Round 2 修复 `let` $\rightarrow$ `val` 后一次通过全部 `@example` |
| **`B23_arena_json_tokenizer`** | ❌ (`E0102`) | ✅ **PASS (Round 2)** | ✅ **PASS** | `E0102_FORBIDDEN_LET_BINDING` | 3B 模型首轮即正确写出 `return *in(arena) JsonStats { ... }` 与 `Arena.new(256)`，**零生命周期/区域内存幻觉**；Round 2 修复 `let` $\rightarrow$ `val/var` 后全通过 |
| **`B24_kv_storage_engine`** | ✅ **PASS (Round 1)** | ✅ **PASS** | ✅ **PASS** | `W0103_TOLERANT_TRAILING_SEMICOLON` | 首轮一次通过 C99 编译与全部 WAL 编解码 + Trait 委托 `@example` 契约沙箱！ |
| **Stage 4 汇总 (`B22`~`B24`)** | **`33.3% (1/3)`** | **`100.0% (3/3)`** | **`100.0% (3/3)`** | 仅 `let` 习惯迁移 (`E0102`) | **24 个基准模块 (`B01`~`B24`) 全量累计 `Heal@3 = 24/24 (100.0%)`！** |

---

## 6. 三轨闭包生命期扩展验证 (`B25_closure_lifetimes`)

- **基准文件**：[`benchmarks/stage4_native/B25_closure_lifetimes/closure_lifetimes.jni`](../../benchmarks/stage4_native/B25_closure_lifetimes/closure_lifetimes.jni) & [`closure_lifetimes.jn`](../../benchmarks/stage4_native/B25_closure_lifetimes/closure_lifetimes.jn)
- **生成 C99 产物**：[`.jenny-cache/c99/closure_lifetimes.c`](../../.jenny-cache/c99/closure_lifetimes.c)（`145.4 KB` 原生 `.exe`）
- **实测结果**：
  - `EX-B25-01`（轨道一：16B 栈借用闭包 `fn(i64) -> i64`，`0` 堆分配、`0` GC 分配）：✅ **PASS**
  - `EX-B25-02`（轨道二：24B 独占堆逃逸闭包 `*fn[own sig](v) => ...`，`consume_unique_amplifier` 触发 `_jn_closure_drop_1` 级联释放 `*SignalBox` 与闭包环境，`active_native_boxes() == 0`）：✅ **PASS**
  - `EX-B25-03`（轨道三：16B 托管共享堆闭包 `^fn(v) => ...`，`effects [AllocGC]` 静态能力校验与 `gc_collect_all()` 池化回收）：✅ **PASS**
  - 全集 **25/25 个基准模块（`B01`~`B25`）** 全部编译通过，**51/51 个 `@example`** 100% 通过，**15/15 个变异注入** 100% 拦截。

