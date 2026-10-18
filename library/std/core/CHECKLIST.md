# `std::core` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/core/CHECKLIST.md`)

> **Layer**: Layer 0 (White-box contract foundation for language syntactic sugar & controlled dynamic bridging layer, zero upper-layer dependencies)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: `option.jni`, `result.jni`, `error.jni`, `tuple.jni`, `range.jni`, `cmp.jni`, `any.jni`  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain core`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::core` is the foundational cornerstone of Jenny's philosophy of **"rejecting compiler black-box magic and unifying syntactic sugar, white-box contracts, and register-level niche optimization"**:
1. **White-Box Desugaring**: `T?` (nullable option), `T ! E` (error propagation), `pub error` (64-bit collision-free named errors), `(A, B)` (tuples), `a..b` (ranges), and comparison operators all have explicit `.jni` Hoare contract blueprints in `std::core`, freeing LLMs from guessing any implicit built-in methods;
2. **Globally Collision-Free Errors & Zero-Allocation Callstack Tracing (`Error` & `ErrorTrace`)**: Every `pub error` automatically synthesizes the `std::core::error::Error` trait using a 64-bit composite encoding `[TypeHash32 (high 32 bits) | VariantHash32 (low 32 bits)]`, uniformly bound to a 16-slot fiber/thread-local ring buffer (`ErrorTrace`) so both named errors and `AnyError` provide $O(1)$ zero-heap-allocation callstack backtraces;
3. **Controlled Unboxed Dynamic Typing (`std::core::any::Any`)**: Provides a 16-byte stack-inlined dynamic value container (zero-heap-boxing scalars + `AnyKind.Extern` external host handles) that supports Python `PyObject*`, JS / Wasm `externref`, and dynamic JSON interop while enforcing type narrowing via `is` or contract methods `.as_xxx()?` to prevent dynamic types from polluting the static core.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/Reflection) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::core::option`** | [`option.jni`](./option.jni) | `0 / 7` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 14** (`0.0%`) |
| **`std::core::result`** | [`result.jni`](./result.jni) | `0 / 7` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 14** (`0.0%`) |
| **`std::core::error`** | [`error.jni`](./error.jni) | `0 / 13` 🎯 | `0 / 8` ⏳ | `0 / 5` ⏳ | `0 / 2` ⏳ | **0 / 28** (`0.0%`) |
| **`std::core::tuple`** | [`tuple.jni`](./tuple.jni) | `0 / 7` 🎯 | `0 / 5` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 15** (`0.0%`) |
| **`std::core::range`** | [`range.jni`](./range.jni) | `0 / 6` 🎯 | `0 / 4` ⏳ | `0 / 1` ⏳ | `0 / 1` ⏳ | **0 / 12** (`0.0%`) |
| **`std::core::cmp`** | [`cmp.jni`](./cmp.jni) | `0 / 7` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 14** (`0.0%`) |
| **`std::core::any`** | [`any.jni`](./any.jni) | `0 / 9` 🎯 | `0 / 6` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 18** (`0.0%`) |
| **Sub-Domain Total** | **7 Modules** | **`0 / 56` (0%)** | **`0 / 35` (0%)** | **`0 / 16` (0%)** | **`0 / 8` (0%)** | **`0 / 115` (`0.0%`)** |

---

## 3. `std::core::option` 4-Stage API Checklist (`T?` Nullable Type White-Box Foundation — `0 / 14`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `Option.some(val: i64) -> Option` — *Contract: `ensures result.has_val == true && result.raw_val == val`*
* `[ ]` `Option.none() -> Option` — *Contract: `ensures result.has_val == false`*
* `[ ]` `Option.is_some(self) -> bool` — *Contract: `ensures result == self.has_val`*
* `[ ]` `Option.is_none(self) -> bool` — *Contract: `ensures result == !self.has_val`*
* `[ ]` `Option.unwrap(self) -> i64 ! OptionError` — *Contract: `requires self.has_val else OptionError.UnwrapNone`, `ensures result == self.raw_val`*
* `[ ]` `Option.unwrap_or(self, default_val: i64) -> i64` — *Contract: `ensures (self.has_val && result == self.raw_val) || (!self.has_val && result == default_val)`*
* `[ ]` `Option.ok_or(self, err_code: i64) -> i64 ! OptionError` — *Contract: `requires self.has_val else OptionError.UnwrapNone`*

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `Option.filter_ge(self, min_val: i64) -> Option`
* `[ ]` `Option.or_else_opt(self, fallback: Option) -> Option`
* `[ ]` `Option.zip_pair(self, other: Option) -> (i64, i64) ! OptionError`
* `[ ]` `Option.equals(self, other: Option) -> bool`

### ⏳ Stage 3: True Generics `<T>` & Higher-Order Combinators (`0 / 2` Planned)
* `[ ]` `Option.map(self, f: fn(T) -> U) -> Option<U>`
* `[ ]` `Option.and_then(self, f: fn(T) -> Option<U>) -> Option<U>`

### ⏳ Stage 4: Niche Optimization Static Layout Verification (`0 / 1` Planned)
* `[ ]` `Option.niche_sizeof_ptr_opt() -> i64` — *Contract: `ensures result == 8`*

---

## 4. `std::core::result` 4-Stage API Checklist (`T ! E` Error Result White-Box Foundation — `0 / 14`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `Result.ok(val: i64) -> Result` — *Contract: `ensures result.is_ok_flag == true && result.val_slot == val`*
* `[ ]` `Result.err(err_code: i64) -> Result` — *Contract: `ensures result.is_ok_flag == false && result.err_slot == err_code`*
* `[ ]` `Result.is_ok(self) -> bool` — *Contract: `ensures result == self.is_ok_flag`*
* `[ ]` `Result.is_err(self) -> bool` — *Contract: `ensures result == !self.is_ok_flag`*
* `[ ]` `Result.unwrap(self) -> i64 ! ResultError` — *Contract: `requires self.is_ok_flag else ResultError.UnwrapErr`, `ensures result == self.val_slot`*
* `[ ]` `Result.unwrap_err(self) -> i64 ! ResultError` — *Contract: `requires !self.is_ok_flag else ResultError.UnwrapOk`, `ensures result == self.err_slot`*
* `[ ]` `Result.unwrap_or(self, default_val: i64) -> i64`

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `Result.ok_val_or_zero(self) -> i64`
* `[ ]` `Result.or_else_res(self, fallback: Result) -> Result`
* `[ ]` `Result.with_err_code(self, new_err_code: i64) -> Result`
* `[ ]` `Result.equals(self, other: Result) -> bool`

### ⏳ Stage 3: True Generics `<T, E>` & Combinators (`0 / 2` Planned)
* `[ ]` `Result.map(self, f: fn(T) -> U) -> Result<U, E>`
* `[ ]` `Result.map_err(self, f: fn(E) -> F) -> Result<T, F>`

### ⏳ Stage 4: Two-Register ABI Alignment Verification (`0 / 1` Planned)
* `[ ]` `Result.abi_register_words() -> i64` — *Contract: `ensures result == 2`*

---

## 5. `std::core::error` 4-Stage API Checklist (`pub error`, 64-Bit Composite Codes, 3-Tier SPO Payloads, `FmtInto` Polymorphic Formatting & Fiber-Local `ErrorTrace` — `0 / 28`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 13` Planned)
* `[ ]` `compose_error_code(type_hash32: i64, variant_hash32: i64) -> i64` — *Contract: `requires type_hash32 > 0 && type_hash32 <= 4294967295 && variant_hash32 > 0 && variant_hash32 <= 4294967295`, `ensures result > 0`*
* `[ ]` `extract_type_hash(err_code64: i64) -> i64` — *Contract: `requires err_code64 > 0`, `ensures result > 0 && result <= 4294967295`*
* `[ ]` `extract_variant_hash(err_code64: i64) -> i64` — *Contract: `requires err_code64 > 0`, `ensures result > 0 && result <= 4294967295`*
* `[ ]` `pack_payload_u32x2(high32: i64, low32: i64) -> i64` — *Tier-1 SPO dual 32-bit parameter register bitfield packing, Contract: `requires high32 >= 0 && high32 <= 4294967295 && low32 >= 0 && low32 <= 4294967295`*
* `[ ]` `unpack_payload_high32(payload64: i64) -> i64` — *Contract: `requires payload64 >= 0`, `ensures result >= 0 && result <= 4294967295`*
* `[ ]` `unpack_payload_low32(payload64: i64) -> i64` — *Contract: `requires payload64 >= 0`, `ensures result >= 0 && result <= 4294967295`*
* `[ ]` `AnyError.from_parts(type_hash32: i64, variant_hash32: i64, payload: i64) -> AnyError ! CoreError`
* `[ ]` `AnyError.error_code(self) -> i64`
* `[ ]` `AnyError.type_hash(self) -> i64`
* `[ ]` `AnyError.variant_hash(self) -> i64`
* `[ ]` `AnyError.payload(self) -> i64`
* `[ ]` `AnyError.matches_type(self, expected_type_hash32: i64) -> bool`
* `[ ]` `AnyError.matches_exact(self, expected_type_hash32: i64, expected_variant_hash32: i64) -> bool`

### ⏳ Stage 2: 16-Slot Fiber-Local Zero-Allocation Causal Callstack Ring (`ErrorTrace` Causal Continuation Callstack — `0 / 8` Planned)
* `[ ]` `ErrorTrace.new() -> ErrorTrace` — *Contract: `ensures result.depth == 0`*
* `[ ]` `ErrorTrace.record_raise(mut self, err_code64: i64, fn_sym_id: i64, line: i64) -> i64` — *`fn_sym_id` is a 32-bit global function/template instance symbol ID (`0..4294967295`), Contract: `requires fn_sym_id >= 0 && fn_sym_id <= 4294967295 && line > 0 && line <= 1048575`, `ensures self.depth == 1 && self.active_code == err_code64`*
* `[ ]` `ErrorTrace.push_propagation_frame(mut self, fn_sym_id: i64, line: i64) -> i64` — *Contract: `requires fn_sym_id >= 0 && fn_sym_id <= 4294967295 && line > 0 && line <= 1048575`, `ensures self.depth >= 1 && self.depth <= 16`*
* `[ ]` `ErrorTrace.push_await_frame(mut self, fn_sym_id: i64, await_state: i64, line: i64) -> i64` — *`await_state` supports 10-bit (`1..1023`), Contract: `requires await_state > 0 && await_state <= 1023 && line > 0 && line <= 1048575`, `ensures self.depth >= 1 && self.depth <= 16`*
* `[ ]` `ErrorTrace.stitch_from_child(mut self, child_trace: ErrorTrace, join_fn_sym_id: i64, join_state: i64, join_line: i64) -> i64` — *Cross-fiber `spawn` causal callstack stitching (`SPAWN_JOIN`)*
* `[ ]` `ErrorTrace.stack_depth(self) -> i64` — *Contract: `ensures result == self.depth && result >= 0 && result <= 16`*
* `[ ]` `ErrorTrace.root_cause_line(self) -> i64 ! CoreError` — *Contract: `requires self.depth > 0 else CoreError.EmptyErrorTrace`*
* `[ ]` `ErrorTrace.frame_line_at(self, idx: i64) -> i64 ! CoreError` — *Contract: `requires idx >= 0 && idx < self.depth else CoreError.TraceIndexOutOfBounds`*

### ⏳ Stage 3: Automatic Synthesis of `Error` / `FmtInto`, Value-Level Polymorphic `.format()` & Frame Reflection Queries (`0 / 5` Planned)
* `[ ]` `AnyError.format(self) -> String` — *Looks up `self.code` in `.rodata` `__jn_error_registry` to unpack and format the variant and parameters*
* `[ ]` `ErrorTrace.frame_fn_sym_at(self, idx: i64) -> i64 ! CoreError` — *Returns the 32-bit global symbol ID `fn_sym_id` (`0..4294967295`)*
* `[ ]` `ErrorTrace.frame_kind_at(self, idx: i64) -> i64 ! CoreError` — *Returns `0=SYNC_RAISE, 1=SYNC_PROP, 2=AWAIT_PROP, 3=SPAWN_JOIN`*
* `[ ]` `ErrorTrace.frame_await_state_at(self, idx: i64) -> i64 ! CoreError` — *Returns the 10-bit suspension point state machine index `__state` (`0..1023`)*
* `[ ]` `ErrorTrace.clear(mut self) -> i64`

### ⏳ Stage 4: Structured Error + Full Causal Callstack Report (`format_with_trace` — `0 / 2` Planned)
* `[ ]` `AnyError.format_with_trace(self, trace: ErrorTrace) -> String` — *Concatenates parameterized error message and 16-slot causal continuation callstack within a single Arena `FmtBuffer`*
* `[ ]` `AnyError.with_context_tag(self, ctx_tag: i64) -> AnyError`

---

## 6. `std::core::tuple` 4-Stage API Checklist (`Pair`, `Triple` & Variadic Tuple Foundation — `0 / 15`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `Pair.new(first: i64, second: i64) -> Pair` — *Contract: `ensures result.first == first && result.second == second`*
* `[ ]` `Pair.swap(self) -> Pair` — *Contract: `ensures result.first == self.second && result.second == self.first`*
* `[ ]` `Pair.equals(self, other: Pair) -> bool` — *Contract: `ensures result == (self.first == other.first && self.second == other.second)`*
* `[ ]` `Pair.lex_cmp(self, other: Pair) -> i64` — *Contract: `ensures result >= -1 && result <= 1`*
* `[ ]` `Pair.hash_combine(self) -> i64`
* `[ ]` `Triple.new(first: i64, second: i64, third: i64) -> Triple`
* `[ ]` `Triple.equals(self, other: Triple) -> bool`

### ⏳ Stage 2: Core Production API Surface (`0 / 5` Planned)
* `[ ]` `Pair.with_first(self, new_first: i64) -> Pair`
* `[ ]` `Pair.with_second(self, new_second: i64) -> Pair`
* `[ ]` `Triple.lex_cmp(self, other: Triple) -> i64`
* `[ ]` `Triple.hash_combine(self) -> i64`
* `[ ]` `Triple.into_pair_prefix(self) -> Pair`

### ⏳ Stage 3: True Generics `Pair<A, B>` & `Triple<A, B, C>` (`0 / 2` Planned)
* `[ ]` `Pair.map_first(self, f: fn(A) -> C) -> Pair<C, B>`
* `[ ]` `Pair.map_second(self, f: fn(B) -> D) -> Pair<A, D>`

### ⏳ Stage 4: `@spin` Compile-Time Generation of Arbitrary-Arity `Tuple<...Ts>` (`0 / 1` Planned)
* `[ ]` `Tuple.arity(self) -> i64`

---

## 7. `std::core::range` 4-Stage API Checklist (`a..b` & `a..=b` Range Primitives — `0 / 12`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 6` Planned)
* `[ ]` `Range.half_open(start: i64, end_excl: i64) -> Range ! RangeError` — *Contract: `requires start <= end_excl else RangeError.InvertedRange`, `ensures result.start == start && result.end_excl == end_excl`*
* `[ ]` `Range.inclusive(start: i64, end_incl: i64) -> Range ! RangeError` — *Contract: `requires start <= end_incl && end_incl < 9223372036854775807 else RangeError.InvertedRange`, `ensures result.start == start && result.end_excl == end_incl + 1`*
* `[ ]` `Range.len(self) -> i64` — *Contract: `ensures result == self.end_excl - self.start && result >= 0`*
* `[ ]` `Range.is_empty(self) -> bool` — *Contract: `ensures result == (self.start == self.end_excl)`*
* `[ ]` `Range.contains(self, val: i64) -> bool` — *Contract: `ensures result == (val >= self.start && val < self.end_excl)`*
* `[ ]` `Range.clamp_val(self, val: i64) -> i64 ! RangeError` — *Contract: `requires self.start < self.end_excl else RangeError.EmptyRange`, `ensures result >= self.start && result < self.end_excl`*

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `Range.contains_subrange(self, sub: Range) -> bool`
* `[ ]` `Range.overlaps(self, other: Range) -> bool`
* `[ ]` `Range.intersect(self, other: Range) -> Range`
* `[ ]` `Range.offset_by(self, delta: i64) -> Range ! RangeError`

### ⏳ Stage 3: Stepped Range Iterator (`step_by` — `0 / 1` Planned)
* `[ ]` `Range.step_count(self, step: i64) -> i64 ! RangeError`

### ⏳ Stage 4: Unbounded Slice Ranges (`RangeFrom` / `RangeTo` — `0 / 1` Planned)
* `[ ]` `Range.split_at_offset(self, rel_off: i64) -> (Range, Range) ! RangeError`

---

## 8. `std::core::cmp` 4-Stage API Checklist (`Ordering` & Fundamental Comparison/Hashing Primitives — `0 / 14`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `cmp_i64(a: i64, b: i64) -> Ordering`
* `[ ]` `min_i64(a: i64, b: i64) -> i64` — *Contract: `ensures result <= a && result <= b && (result == a || result == b)`*
* `[ ]` `max_i64(a: i64, b: i64) -> i64` — *Contract: `ensures result >= a && result >= b && (result == a || result == b)`*
* `[ ]` `clamp_i64(val: i64, low: i64, high: i64) -> i64 ! CmpError` — *Contract: `requires low <= high else CmpError.InvalidBounds`, `ensures result >= low && result <= high`*
* `[ ]` `abs_diff_i64(a: i64, b: i64) -> i64` — *Contract: `ensures result >= 0`*
* `[ ]` `Ordering.is_eq(self) -> bool`
* `[ ]` `Ordering.reverse(self) -> Ordering`

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `Ordering.is_lt(self) -> bool`
* `[ ]` `Ordering.is_gt(self) -> bool`
* `[ ]` `Ordering.then_with(self, secondary: Ordering) -> Ordering` — *Core primitive for lexicographical cascading comparison*
* `[ ]` `hash_mix_i64(seed: i64, val: i64) -> i64` — *SplitMix64 deterministic hash mixing primitive*

### ⏳ Stage 3: Core Trait Bindings (`Eq` / `Ord` / `Hash` / `Clone` / `Drop` — `0 / 2` Planned)
* `[ ]` `min_by_key(a: T, b: T, key_fn: fn(T) -> i64) -> T`
* `[ ]` `max_by_key(a: T, b: T, key_fn: fn(T) -> i64) -> T`

### ⏳ Stage 4: Three-Way Comparison Operator `<=>` Integration (`0 / 1` Planned)
* `[ ]` `Ordering.to_sign_i64(self) -> i64`

---

## 9. `std::core::any` 4-Stage API Checklist (16-Byte Unboxed Controlled Dynamic Type & External Host Bridge — `0 / 18`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 9` Planned)
* `[ ]` `Any.null_val() -> Any` — *Contract: `ensures result.kind == AnyKind.Null && result.payload == 0`*
* `[ ]` `Any.from_bool(b: bool) -> Any` — *Contract: `ensures result.kind == AnyKind.Bool`*
* `[ ]` `Any.from_i64(n: i64) -> Any` — *Contract: `ensures result.kind == AnyKind.Int && result.payload == n`*
* `[ ]` `Any.from_extern(runtime_id: i64, handle: i64) -> Any ! TypeError` — *Contract: `requires runtime_id > 0 && handle != 0 else TypeError.InvalidExternHandle`, `ensures result.kind == AnyKind.Extern && result.aux == runtime_id && result.payload == handle`*
* `[ ]` `Any.kind(self) -> AnyKind`
* `[ ]` `Any.is_null(self) -> bool`
* `[ ]` `Any.as_bool(self) -> bool ! TypeError` — *Contract: `requires self.kind == AnyKind.Bool else TypeError.KindMismatch`*
* `[ ]` `Any.as_i64(self) -> i64 ! TypeError` — *Contract: `requires self.kind == AnyKind.Int else TypeError.KindMismatch`, `ensures result == self.payload`*
* `[ ]` `Any.as_extern_handle(self, expected_runtime_id: i64) -> i64 ! TypeError` — *Contract: `requires self.kind == AnyKind.Extern else TypeError.KindMismatch`, `requires self.aux == expected_runtime_id else TypeError.RuntimeDomainMismatch`, `ensures result == self.payload`*

### ⏳ Stage 2: Core Production API Surface (`0 / 6` Planned)
* `[ ]` `Any.from_fixed_milli(scaled_milli: i64) -> Any` — *Inlined fixed-point real number encapsulation*
* `[ ]` `Any.as_fixed_milli(self) -> i64 ! TypeError`
* `[ ]` `Any.is_int(self) -> bool`
* `[ ]` `Any.is_bool(self) -> bool`
* `[ ]` `Any.is_extern(self) -> bool`
* `[ ]` `Any.equals_scalar(self, other: Any) -> bool`

### ⏳ Stage 3: Dynamic Container Payloads (`AnyKind.Str` / `AnyKind.List` / `AnyKind.Map` — `0 / 2` Planned)
* `[ ]` `Any.from_str_handle(str_slot: i64) -> Any`
* `[ ]` `Any.as_str_handle(self) -> i64 ! TypeError`

### ⏳ Stage 4: Cross-Language Host Reference Counting Release Hook (`Py_DECREF` / `externref` — `0 / 1` Planned)
* `[ ]` `Any.runtime_id(self) -> i64`
