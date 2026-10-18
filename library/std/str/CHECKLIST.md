# `std::str` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/str/CHECKLIST.md`)

> **Layer**: Layer 2 (Zero-copy text slices, mutable string building & bounded variadic formatting layer)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`str_view.jni`](./str_view.jni), [`string_buf.jni`](./string_buf.jni), [`fmt.jni`](./fmt.jni)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain str`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::str` forms the standard library capabilities for Jenny's three-tier string architecture:
1. **`std::str::str_view::StrSliceView`**: Maintains a zero-copy window with boundary invariants over a 16-byte native `str` (without Rust `<'a>` lifetime contagion);
2. **`std::str::string_buf::StringBuf`**: A dynamic mutable string builder backed by `RawBuf`, supporting one-step freezing into a 24-byte stack-inlined SSO `String` ($\le 22$ bytes with zero heap allocation);
3. **`std::str::fmt`**: A brace-free DSL formatting engine powered by the three-tier orthogonal trait `Formattable = FmtInto | ToStr | (FmtSpecInto, FmtSpec, ...i64)` and procedural `@spin` expansion.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (UTF-8/Iter) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::str::str_view`** | [`str_view.jni`](./str_view.jni) | `8 / 8` ✅ | `0 / 8` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | **8 / 22** (`36.4%`) |
| **`std::str::string_buf`** | [`string_buf.jni`](./string_buf.jni) | `13 / 13` ✅ | `0 / 9` 🎯 | `0 / 2` ⏳ | `0 / 0` ⏳ | **13 / 24** (`54.2%`) |
| **`std::str::fmt`** | [`fmt.jni`](./fmt.jni) | `25 / 25` ✅ | `0 / 6` 🎯 | `0 / 1` ⏳ | `0 / 1` ⏳ | **25 / 33** (`75.8%`) |
| **Sub-Domain Total** | **3 Modules** | **`46 / 46` (100%)** | **`0 / 23` (0%)** | **`0 / 7` (0%)** | **`0 / 3` (0%)** | **`46 / 79` (`58.2%`)** |

---

## 3. `std::str::str_view` 4-Stage API Checklist (`8 / 22`)

### 🟢 Stage 1: Minimal Contract Skeleton (`8 / 8` Completed ✅)
* `[x]` `StrSliceView.from_bounds(start: i64, len: i64, source_cap: i64) -> StrSliceView ! StrError`
* `[x]` `StrSliceView.len(self) -> i64`
* `[x]` `StrSliceView.is_empty(self) -> bool`
* `[x]` `StrSliceView.end_offset(self) -> i64`
* `[x]` `StrSliceView.advance(mut self, count: i64) -> i64 ! StrError`
* `[x]` `StrSliceView.truncate_len(mut self, new_len: i64) -> i64 ! StrError`
* `[x]` `StrSliceView.sub_slice(self, rel_off: i64, sub_len: i64) -> StrSliceView ! StrError`
* `[x]` `StrSliceView.slice_str(self, raw: str) -> str ! StrError`

### 🎯 Stage 2: Core Production API Surface (`0 / 8` Planned)
> **Intent Note**: Omitting redundant getters for `pub` fields (`start`/`source_cap`), focusing on direct view construction from `str`, prefix/suffix matching (`starts_with`/`ends_with`), substring equality checks, prefix/suffix splitting (`take_prefix`/`take_suffix`), and one-step conversion to SSO `String`.
* `[ ]` `StrSliceView.from_str(s: str) -> StrSliceView` — *Contract: `ensures result.start == 0 && result.len == s.len() && result.source_cap == s.len()`*
* `[ ]` `StrSliceView.reset_full(mut self) -> i64` — *Contract: `ensures self.start == 0 && self.len == self.source_cap`*
* `[ ]` `StrSliceView.equals_slice(self, raw: str, target: str) -> bool ! StrError` — *Contract: `requires raw.len() == self.source_cap else StrError.SliceOutOfRange`*
* `[ ]` `StrSliceView.starts_with(self, raw: str, prefix: str) -> bool ! StrError` — *Contract: `requires raw.len() == self.source_cap else StrError.SliceOutOfRange`*
* `[ ]` `StrSliceView.ends_with(self, raw: str, suffix: str) -> bool ! StrError` — *Contract: `requires raw.len() == self.source_cap else StrError.SliceOutOfRange`*
* `[ ]` `StrSliceView.take_prefix(mut self, count: i64) -> StrSliceView ! StrError` — *Contract: `requires count >= 0 && count <= self.len else StrError.SliceOutOfRange`, `ensures result.len == count && self.len == old(self.len) - count`*
* `[ ]` `StrSliceView.take_suffix(mut self, count: i64) -> StrSliceView ! StrError` — *Contract: `requires count >= 0 && count <= self.len else StrError.SliceOutOfRange`, `ensures result.len == count && self.len == old(self.len) - count`*
* `[ ]` `StrSliceView.to_sso_string(self, raw: str) -> String ! StrError` — *Contract: `requires raw.len() == self.source_cap else StrError.SliceOutOfRange`, `ensures result.len() == self.len`*

### ⏳ Stage 3: Whitespace Trimming, Splitting & Numeric Parsing (`0 / 4` Planned)
* `[ ]` `StrSliceView.find_byte(self, raw: str, target_byte: i64) -> i64 ! StrError`
* `[ ]` `StrSliceView.trim_ascii(mut self, raw: str) -> i64 ! StrError`
* `[ ]` `StrSliceView.parse_i64(self, raw: str) -> i64 ! StrError`
* `[ ]` `StrSliceView.parse_u64(self, raw: str) -> i64 ! StrError`

### ⏳ Stage 4: UTF-8 Boundary Validation & Case-Insensitive Comparison (`0 / 2` Planned)
* `[ ]` `StrSliceView.eq_ignore_ascii_case(self, raw: str, other: str) -> bool ! StrError`
* `[ ]` `StrSliceView.is_valid_utf8(self, raw: str) -> bool ! StrError`

---

## 4. `std::str::string_buf` 4-Stage API Checklist (`13 / 24`)

### 🟢 Stage 1: Minimal Contract Skeleton (`13 / 13` Completed ✅)
* `[x]` `StringBuf.new() -> StringBuf`
* `[x]` `StringBuf.with_capacity(cap: i64) -> StringBuf ! StringError`
* `[x]` `StringBuf.len(self) -> i64`
* `[x]` `StringBuf.capacity(self) -> i64`
* `[x]` `StringBuf.push_byte(mut self, ch: i64) -> i64 ! StringError`
* `[x]` `StringBuf.push_str(mut self, s: str) -> i64 ! StringError`
* `[x]` `StringBuf.push_repeat(mut self, ch: i64, count: i64) -> i64 ! StringError`
* `[x]` `StringBuf.byte_at(self, idx: i64) -> i64 ! StringError`
* `[x]` `StringBuf.truncate(mut self, new_len: i64) -> i64 ! StringError`
* `[x]` `StringBuf.equals_str(self, target: str) -> bool`
* `[x]` `StringBuf.to_sso_string(self) -> String`
* `[x]` `StringBuf.fnv1a_hash(self) -> i64`
* `[x]` `StringBuf.drop_string(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 9` Planned)
> **Intent Note**: Completes emptiness checks, clearing, capacity reservation, tail byte popping, direct integer/hexadecimal appending, single-byte replacement, and in-place ASCII case conversion (omitting `starts_with_byte`/`ends_with_byte` which duplicate `StrSliceView`).
* `[ ]` `StringBuf.is_empty(self) -> bool` — *Contract: `ensures result == (self.len == 0)`*
* `[ ]` `StringBuf.clear(mut self) -> i64` — *Contract: `ensures self.len == 0 && self.buf.cap == old(self.buf.cap)`*
* `[ ]` `StringBuf.reserve(mut self, additional: i64) -> i64 ! StringError` — *Contract: `requires additional >= 0 && self.len + additional <= 1048576 else StringError.CapacityOverflow`*
* `[ ]` `StringBuf.pop_byte(mut self) -> i64 ! StringError` — *Contract: `requires self.len > 0 else StringError.IndexOutOfBounds`, `ensures self.len == old(self.len) - 1`*
* `[ ]` `StringBuf.push_i64(mut self, val: i64) -> i64 ! StringError` — *Contract: `requires self.len + 21 <= 1048576 else StringError.CapacityOverflow`, `ensures self.len > old(self.len)`*
* `[ ]` `StringBuf.push_hex_u32(mut self, val: i64, digits: i64) -> i64 ! StringError` — *Contract: `requires digits >= 1 && digits <= 8 else StringError.IndexOutOfBounds`*
* `[ ]` `StringBuf.replace_byte(mut self, from_byte: i64, to_byte: i64) -> i64 ! StringError` — *Contract: `requires from_byte >= 0 && from_byte <= 127 && to_byte >= 0 && to_byte <= 127 else StringError.InvalidAsciiByte`*
* `[ ]` `StringBuf.to_ascii_lowercase(mut self) -> i64` — *Contract: `ensures self.len == old(self.len)`*
* `[ ]` `StringBuf.to_ascii_uppercase(mut self) -> i64` — *Contract: `ensures self.len == old(self.len)`*

### ⏳ Stage 3: UTF-8 Codepoint Appending & Capacity Shrinking (`0 / 2` Planned)
* `[ ]` `StringBuf.push_utf8_codepoint(mut self, cp: i64) -> i64 ! StringError`
* `[ ]` `StringBuf.shrink_to_fit(mut self) -> i64 ! StringError`

---

## 5. `std::str::fmt` 4-Stage API Checklist (`25 / 33`)

### 🟢 Stage 1: Minimal Contract Skeleton (`25 / 25` Completed ✅)
* `[x]` `format(...args: Formattable) -> String`
* `[x]` `format_with(culture: Culture, ...args: Formattable) -> String`
* `[x]` `RoleBadge.new(name: str) -> RoleBadge`
* `[x]` `RoleBadge.to_str(self) -> str`
* `[x]` `KvTag.new(label: str, code: i64) -> KvTag`
* `[x]` `KvTag.fmt_into(self, mut fb: FmtBuffer, culture: Culture) -> i64 ! FmtError`
* `[x]` `FmtBuffer.in_arena(cap: i64) -> FmtBuffer ! FmtError`
* `[x]` `FmtBuffer.with_capacity(cap: i64) -> FmtBuffer ! FmtError`
* `[x]` `FmtBuffer.len(self) -> i64`
* `[x]` `FmtBuffer.capacity(self) -> i64`
* `[x]` `FmtBuffer.clear(mut self) -> i64`
* `[x]` `FmtBuffer.put_str(mut self, s: str) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_string(mut self, s: String) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_i64(mut self, val: i64) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_hex_u32(mut self, val: i64, digits: i64) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_hex_upper_u32(mut self, val: i64, digits: i64) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_pad_zero(mut self, val: i64, width: i64) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_bin_u32(mut self, val: i64, bits: i64) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_grouped_i64(mut self, val: i64, culture: Culture) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_spec(mut self, culture: Culture, val: i64, spec: FmtSpec, param: i64) -> i64 ! FmtError`
* `[x]` `FmtBuffer.put_bool(mut self, flag: bool) -> i64 ! FmtError`
* `[x]` `FmtBuffer.equals_str(self, target: str) -> bool`
* `[x]` `FmtBuffer.to_sso_string(self) -> String`
* `[x]` `FmtBuffer.slice_to_sso(self, start: i64, sub_len: i64) -> String ! FmtError`
* `[x]` `FmtBuffer.drop_fmt(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 6` Planned)
> **Intent Note**: Completes `FmtBuffer` emptiness checks, remaining capacity queries, left/right padded string writing (`put_pad_left_str`/`put_pad_right_str`), and repeated byte writing (omitting low-frequency octal `put_oct_u32`).
* `[ ]` `FmtBuffer.is_empty(self) -> bool` — *Contract: `ensures result == (self.len == 0)`*
* `[ ]` `FmtBuffer.remaining_capacity(self) -> i64` — *Contract: `ensures result == self.cap - self.len && result >= 0`*
* `[ ]` `FmtBuffer.put_ascii_byte(mut self, ch: i64) -> i64 ! FmtError` — *Contract: `requires self.len + 1 <= self.cap else FmtError.BufferOverflow`*
* `[ ]` `FmtBuffer.put_repeat_byte(mut self, ch: i64, count: i64) -> i64 ! FmtError` — *Contract: `requires count >= 0 && self.len + count <= self.cap else FmtError.BufferOverflow`*
* `[ ]` `FmtBuffer.put_pad_left_str(mut self, s: str, width: i64, pad_ch: i64) -> i64 ! FmtError` — *Contract: `requires width >= 0 && self.len + width <= self.cap && self.len + s.len() <= self.cap else FmtError.BufferOverflow`*
* `[ ]` `FmtBuffer.put_pad_right_str(mut self, s: str, width: i64, pad_ch: i64) -> i64 ! FmtError` — *Contract: `requires width >= 0 && self.len + width <= self.cap && self.len + s.len() <= self.cap else FmtError.BufferOverflow`*

### ⏳ Stage 3: Fixed-Point Decimal Formatting (`0 / 1` Planned)
* `[ ]` `FmtBuffer.put_fixed_dec(mut self, scaled_val: i64, frac_digits: i64) -> i64 ! FmtError`

### ⏳ Stage 4: Buffer-Reusing Variadic Streaming Formatting (`0 / 1` Planned)
* `[ ]` `format_into_buf(mut fb: FmtBuffer, culture: Culture, ...args: Formattable) -> i64 ! FmtError`
