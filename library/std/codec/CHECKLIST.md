# `std::codec` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/codec/CHECKLIST.md`)

> **Layer**: Layer 3 (Binary & text protocol encoding/decoding layer, depends on `std::mem::raw_buf`)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`varint.jni`](./varint.jni) / [`varint.jn`](./varint.jn)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain codec`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::codec` provides streaming protocol encoders and decoders with strict byte-watermark invariants (`0 <= read_off <= write_off <= buf.cap`), ensuring that when parsing untrusted external binary streams (such as Protobuf / Wasm LEB128 variable-length integers), stream truncation (`UnexpectedEof`) and 64-bit overflow (`VarintOverflow`) are 100% intercepted statically or at runtime.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Peek/Precheck) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::codec::varint`** | [`varint.jni`](./varint.jni) | `7 / 7` ✅ | `0 / 8` 🎯 | `0 / 1` ⏳ | `0 / 0` ⏳ | **7 / 16** (`43.8%`) |

---

## 3. `std::codec::varint` 4-Stage API Checklist (`7 / 16`)

### 🟢 Stage 1: Minimal Contract Skeleton (`7 / 7` Completed ✅)
* `[x]` `zigzag_encode(val: i64) -> i64`
* `[x]` `zigzag_decode(encoded: i64) -> i64 ! CodecError`
* `[x]` `VarintStream.with_capacity(cap: i64) -> VarintStream ! CodecError`
* `[x]` `VarintStream.unread_bytes(self) -> i64`
* `[x]` `VarintStream.encode_u64(mut self, val: i64) -> i64 ! CodecError`
* `[x]` `VarintStream.decode_u64(mut self) -> i64 ! CodecError`
* `[x]` `VarintStream.drop_stream(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 8` Planned)
> **Intent Note**: Completes encoded byte-length precomputation (`encoded_size_u64`/`encoded_size_sint64`), zero-capacity construction, emptiness checks, single-step signed integer ZigZag+LEB128 encoding/decoding (`encode_sint64`/`decode_sint64`), read-offset rewinding, and clear reset (fixed-width little-endian reads/writes are unified in `IoCursor` and not duplicated in `VarintStream`).
* `[ ]` `encoded_size_u64(val: i64) -> i64 ! CodecError` — *Contract: `requires val >= 0 else CodecError.NegativeUnsigned`, `ensures result >= 1 && result <= 10`*
* `[ ]` `encoded_size_sint64(val: i64) -> i64` — *Contract: `ensures result >= 1 && result <= 10`*
* `[ ]` `VarintStream.new() -> VarintStream` — *Contract: `ensures result.read_off == 0 && result.write_off == 0 && result.buf.cap == 0`*
* `[ ]` `VarintStream.is_empty(self) -> bool` — *Contract: `ensures result == (self.read_off == self.write_off)`*
* `[ ]` `VarintStream.encode_sint64(mut self, val: i64) -> i64 ! CodecError` — *Contract: `requires self.write_off + 10 <= 1048576 else CodecError.CapacityOverflow`, `ensures self.write_off > old(self.write_off)`*
* `[ ]` `VarintStream.decode_sint64(mut self) -> i64 ! CodecError` — *Contract: `requires self.read_off < self.write_off else CodecError.UnexpectedEof`, `ensures self.read_off > old(self.read_off)`*
* `[ ]` `VarintStream.rewind_read(mut self) -> i64` — *Contract: `ensures self.read_off == 0 && self.write_off == old(self.write_off)`*
* `[ ]` `VarintStream.clear(mut self) -> i64` — *Contract: `ensures self.read_off == 0 && self.write_off == 0`*

### ⏳ Stage 3: Non-Destructive First-Byte Peeking (`0 / 1` Planned)
* `[ ]` `VarintStream.peek_byte(self) -> i64 ! CodecError`
