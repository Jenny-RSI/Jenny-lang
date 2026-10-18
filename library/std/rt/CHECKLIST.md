# `std::rt` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/rt/CHECKLIST.md`)

> **Layer**: Layer 0 (Foundational runtime intrinsics layer, zero upper-layer dependencies)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`intrinsics.jni`](./intrinsics.jni) / [`intrinsics.jn`](./intrinsics.jn)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain rt`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::rt::intrinsics` is the sole white-box contract gateway across the entire Jenny standard library permitted to directly bridge low-level `jenny_rt.h` C99 runtime primitives (statically enforced by `Spindle` rule `E0510_UNDECLARED_RT_INTRINSIC`):
* **Core Intent**: Encapsulate implicit C macro operations (memory allocation, block copying, Scratch Arena watermarks, formatted byte writing, and Immix GC mark-sweep) into first-class functions annotated with `effects`, `requires`, and `ensures`, allowing upper-layer `std::mem` and `std::str` modules to invoke them safely under zero black-box assumptions.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/Concurrency) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::rt::intrinsics`** | [`intrinsics.jni`](./intrinsics.jni) | `22 / 22` ✅ | `0 / 5` 🎯 | `0 / 3` ⏳ | `0 / 2` ⏳ | **22 / 32** (`68.8%`) |

---

## 3. `std::rt::intrinsics` 4-Stage API Checklist (`Stage 1 ~ Stage 4`)

### 🟢 Stage 1: Minimal Contract Skeleton (`Skeleton` — `22 / 22` Completed ✅)
* `[x]` `rt_raw_alloc(cap: i64) -> i64`
* `[x]` `rt_raw_realloc(old_ptr: i64, old_cap: i64, new_cap: i64) -> i64`
* `[x]` `rt_raw_free(raw_ptr: i64) -> i64`
* `[x]` `rt_raw_get(raw_ptr: i64, idx: i64) -> i64`
* `[x]` `rt_raw_set(raw_ptr: i64, idx: i64, val: i64) -> i64`
* `[x]` `rt_raw_copy(dst_ptr: i64, dst_off: i64, src_ptr: i64, src_off: i64, count: i64) -> i64`
* `[x]` `rt_scratch_mark() -> i64`
* `[x]` `rt_scratch_alloc(cap: i64) -> i64`
* `[x]` `rt_scratch_release(mark: i64) -> i64`
* `[x]` `rt_raw_put_str(raw_ptr: i64, write_off: i64, s: str) -> i64`
* `[x]` `rt_raw_put_string(raw_ptr: i64, write_off: i64, s: String) -> i64`
* `[x]` `rt_raw_put_i64(raw_ptr: i64, write_off: i64, val: i64) -> i64`
* `[x]` `rt_raw_put_hex_u32(raw_ptr: i64, write_off: i64, val: i64, digits: i64) -> i64`
* `[x]` `rt_raw_put_hex_upper_u32(raw_ptr: i64, write_off: i64, val: i64, digits: i64) -> i64`
* `[x]` `rt_raw_put_pad_zero(raw_ptr: i64, write_off: i64, val: i64, width: i64) -> i64`
* `[x]` `rt_raw_put_bin_u32(raw_ptr: i64, write_off: i64, val: i64, bits: i64) -> i64`
* `[x]` `rt_raw_put_grouped_i64(raw_ptr: i64, write_off: i64, val: i64, sep_byte: i64) -> i64`
* `[x]` `rt_raw_put_bool(raw_ptr: i64, write_off: i64, flag: bool) -> i64`
* `[x]` `rt_raw_eq_str(raw_ptr: i64, len: i64, target: str) -> bool`
* `[x]` `rt_raw_to_sso_string(raw_ptr: i64, start: i64, len: i64) -> String`
* `[x]` `rt_gc_begin_mark() -> i64`
* `[x]` `rt_gc_sweep_epoch() -> i64`

### 🎯 Stage 2: Core Production API Surface (`Core Production APIs` — `0 / 5` Planned)
> **Intent Note**: Supports bulk filling and lexicographical block comparison in upper-layer `RawBuf`, as well as byte-level indexing and fixed-point decimal formatting in `StrSliceView` / `FmtBuffer`.
* `[ ]` `rt_raw_fill(raw_ptr: i64, dst_off: i64, count: i64, val: i64) -> i64` — *Contract: `requires raw_ptr != 0 && dst_off >= 0 && count >= 0`, `ensures result == count`*
* `[ ]` `rt_raw_cmp(p1: i64, off1: i64, p2: i64, off2: i64, count: i64) -> i64` — *Contract: `requires count >= 0 && off1 >= 0 && off2 >= 0`, `ensures result >= -1 && result <= 1`*
* `[ ]` `rt_str_byte_at(s: str, idx: i64) -> i64` — *Contract: `requires idx >= 0 && idx < s.len()`, `ensures result >= 0 && result <= 255`*
* `[ ]` `rt_raw_put_ascii_byte(raw_ptr: i64, write_off: i64, ch: i64) -> i64` — *Contract: `requires raw_ptr != 0 && write_off >= 0 && ch >= 0 && ch <= 127`, `ensures result == write_off + 1`*
* `[ ]` `rt_raw_put_fixed_dec(raw_ptr: i64, write_off: i64, scaled_val: i64, frac_digits: i64) -> i64` — *Contract: `requires raw_ptr != 0 && write_off >= 0 && frac_digits >= 1 && frac_digits <= 6`, `ensures result > write_off`*

### ⏳ Stage 3: UTF-8 Codepoints & Atomic Synchronization Primitives (`UTF-8 & Atomics` — `0 / 3` Planned)
* `[ ]` `rt_utf8_validate(s: str) -> bool`
* `[ ]` `rt_atomic_cas_i64(raw_ptr: i64, idx: i64, expected: i64, desired: i64) -> bool`
* `[ ]` `rt_atomic_fetch_add_i64(raw_ptr: i64, idx: i64, delta: i64) -> i64`

### ⏳ Stage 4: Hardware Acceleration & Monotonic Clock Primitives (`SIMD & Clock` — `0 / 2` Planned)
* `[ ]` `rt_monotonic_nanos() -> i64`
* `[ ]` `rt_simd_memchr_byte(raw_ptr: i64, start: i64, len: i64, target_byte: i64) -> i64`

---

## 4. Subagent Closed-Loop Execution SOP (`Intent -> .jni -> .jn -> Verify`)
1. **Write `.jni` First**: Append the target Stage's `pub fn` signatures, `effects`, `requires`, `ensures`, and `@example` assertions in [`intrinsics.jni`](./intrinsics.jni);
2. **Write `.jn` & `.rs` Next**: Implement the corresponding primitives in [`intrinsics.jn`](./intrinsics.jn) (and `compiler/runtime/jenny_rt.h` if needed) and [`intrinsics.rs`](./intrinsics.rs);
3. **Verify & Check Off**: Run `node compiler/src/jenny.ts library/std/rt/intrinsics.jni` and `node compiler/src/jenny.ts std-check --domain rt`, then check off `[x]` in this checklist once all pass.
