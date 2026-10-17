# `jenny` Compiler & Verification Suite (`compiler/`)

This directory contains the prototype compiler, static borrow/effect verifier, white-box `@spin` expander, C99 runtime header, and contract fuzzing/mutation engines for **Spinning Jenny (`v0.1.0`)**.

* **`jenny-nano/` (`v0.1.0-alpha1` Stage 0 Contract Kernel)**:
  * Parses `.jni` Markdown contract blueprints and `.jn` implementations, weaves `requires`, `ensures(old)`, and `struct invariant` into C99 assertions, compiles `@example` sandboxes via `clang`, and executes the 11-case Stage 0 runtime contract fault-injection suite (`python compiler/jenny-nano/jenny_nano.py --mutate`).
* **`jenny-flow/` (`v0.1.0` Full AST $\rightarrow$ C99 Compiler & Runtime)**:
  * **`jenny_rt.h`**: C99 runtime header providing the 16-byte dual-register `JnAnyError` (`_Static_assert(sizeof(JnAnyError) == 16)`), 16-slot thread-local Error Trace RingBuffer, unique native heap box (`*T` via `jn_box_alloc`/`jn_box_free`), $O(1)$ region arena (`JnArena`), pooled managed handles (`^T`), and three-track closure descriptors (`JnClosure`, `JnBoxClosure`, `JnGcClosure`).
  * **`jenny_flow.py`**: Full AST parser, sigil-free three-mode borrow/view/effect checker (`E0101`–`E0403`), `@spin` white-box code generator (`.spun/*.spun.jn`), C99 native code generator (`.jenny-cache/`), `.jni` ABI firewall (`jni_abi_hash`), `--fuzz` contract fuzzer, and `--mutate` fault-injection regression runner.
