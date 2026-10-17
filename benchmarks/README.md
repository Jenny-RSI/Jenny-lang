# `Jenny-Bench-25` Empirical Benchmark Suite (`benchmarks/`)

This directory contains the **25 benchmark modules (`B01`–`B25`, 75 source files)** and automated evaluation scripts used to evaluate **Spinning Jenny (`v0.1.0`)** against idiomatic Safe Rust (`v2021` edition):

* **`seed_10/` (`B01`–`B10`)**: Core systems & data-processing modules (`RingBuffer`, `HttpParser`, `ExprEvaluator`, `LruTtlCache`, `OrderPipeline`, `LogAggregator`, `AudioNormalizer`, `StorageDecorator`, `OrderFsm`, `ConcurrentAggregator`).
* **`stage1_flow/` (`B11`–`B12`)**: Deep 4-layer error truncation (`B11_layered_gateway`) and linear pipe/guard stream processing (`B12_stream_pipeline`).
* **`stage2_mem/` (`B13`–`B17`, `Mem-Bench-5`)**: Five classic borrow-checker challenges (`PcmFramePipeline`, `ZeroCopyHttpView`, `ArenaAstBuilder`, `LruDoublyLinked`, `StructFieldSplitMut`).
* **`stage3_spin/` (`B18`–`B21`, `Spin-Bench-4`)**: First-class trait delegation (`B18`) and `@spin` / `@apply` white-box code generation (`B19` FSM, `B20` Binary Codec, `B21` CRUD Service).
* **`stage4_native/` (`B22`–`B25`)**: Zero-glue C FFI CRC32 (`B22`), Arena JSON Tokenizer (`B23`), Full-Stack KV Storage Engine (`B24`), and Three-Track Closure Lifetimes (`B25`).
* **`eval/`**:
  * [`measure_tokens.py`](./eval/measure_tokens.py): Deterministic token economy & v2.0 syntax auditor (`TCR`, `TCR_impl`, `ECC_self`, `ECC_vs_rs_prod`).
  * [`llm_eval_harness.py`](./eval/llm_eval_harness.py): Automated local LLM (`Ollama`) skeleton-completion and `--ai-json` self-healing evaluation harness.
  * [`jenny_syntax_card.md`](./eval/jenny_syntax_card.md): Compact system-prompt syntax card for zero-shot / in-context LLM code generation ([Chinese version](./eval/jenny_syntax_card_zh.md)).
