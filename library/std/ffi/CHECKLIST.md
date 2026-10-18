# `std::ffi` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/ffi/CHECKLIST.md`)

> **Layer**: Layer 0 (Foundational FFI bridging layer)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`c_abi.jni`](./c_abi.jni) / [`c_abi.jn`](./c_abi.jn)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain ffi`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::ffi` encapsulates external C99 data structures (`@repr(C) struct`, `@bits(N)` bitfields, `@repr(C) union`), network byte-order conversions (Endianness), and checksum computations into 100% white-box verifiable `.jni` blueprints, eliminating out-of-bounds memory access and bitfield overflow risks caused by black-box `#include` headers.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (CStr Views) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::ffi::c_abi`** | [`c_abi.jni`](./c_abi.jni) | `13 / 13` ✅ | `0 / 5` 🎯 | `0 / 2` ⏳ | `0 / 1` ⏳ | **13 / 21** (`61.9%`) |

---

## 3. `std::ffi::c_abi` 4-Stage API Checklist (`Stage 1 ~ Stage 4`)

### 🟢 Stage 1: Minimal Contract Skeleton (`Skeleton` — `13 / 13` Completed ✅)
* `[x]` `CFrameHeader.new(version: u32, ihl: u32, dscp: u32, ecn: u32, total_len: u32, seq_id: u32) -> CFrameHeader ! CAbiError`
* `[x]` `CFrameHeader.header_byte_len(self) -> i64`
* `[x]` `CFrameHeader.payload_byte_len(self) -> i64`
* `[x]` `union_from_raw(raw_val: u32) -> CWord32Union`
* `[x]` `union_from_halves(low16: u32, high16: u32) -> CWord32Union ! CAbiError`
* `[x]` `union_low16(u: CWord32Union) -> i64`
* `[x]` `union_high16(u: CWord32Union) -> i64`
* `[x]` `union_as_signed(u: CWord32Union) -> i64`
* `[x]` `c_sizeof_frame(hdr: CFrameHeader) -> i64`
* `[x]` `c_sizeof_union(u: CWord32Union) -> i64`
* `[x]` `c_frame_word0(hdr: CFrameHeader) -> i64`
* `[x]` `c_bswap32(x: u32) -> i64`
* `[x]` `c_adler32_words(raw_ptr: i64, count: i64) -> i64`

### 🎯 Stage 2: Core Production API Surface (`Core Production APIs` — `0 / 5` Planned)
> **Intent Note**: Excludes protocol-specific business methods (such as `is_ipv4`) and focuses on general-purpose 16/32-bit network byte-order (`bswap16`/`htons`/`ntohs`/`htonl`/`ntohl`) lossless conversion primitives.
* `[ ]` `c_bswap16(x: u32) -> i64 ! CAbiError` — *Contract: `requires x >= 0 && x <= 65535 else CAbiError.BitfieldOverflow`, `ensures result >= 0 && result <= 65535`*
* `[ ]` `c_htons(host16: u32) -> i64 ! CAbiError` — *Contract: `requires host16 >= 0 && host16 <= 65535 else CAbiError.BitfieldOverflow`, `ensures result >= 0 && result <= 65535`*
* `[ ]` `c_ntohs(net16: u32) -> i64 ! CAbiError` — *Contract: `requires net16 >= 0 && net16 <= 65535 else CAbiError.BitfieldOverflow`, `ensures result >= 0 && result <= 65535`*
* `[ ]` `c_htonl(host32: u32) -> i64` — *Contract: `ensures result >= 0`*
* `[ ]` `c_ntohl(net32: u32) -> i64` — *Contract: `ensures result >= 0`*

### ⏳ Stage 3: Bounded C-String Views & 64-Bit Endianness (`CStr & 64-bit Endian` — `0 / 2` Planned)
* `[ ]` `c_bswap64(x: i64) -> i64`
* `[ ]` `c_str_len_bounded(raw_ptr: i64, max_len: i64) -> i64 ! CAbiError`

### ⏳ Stage 4: Hardware CRC32 Checksum Primitive (`CRC32` — `0 / 1` Planned)
* `[ ]` `c_crc32_words(raw_ptr: i64, count: i64) -> i64`

---

## 4. Subagent Closed-Loop Execution SOP (`Intent -> .jni -> .jn -> Verify`)
1. First declare the target Stage's functions and Hoare contracts in [`c_abi.jni`](./c_abi.jni), and add `@example` tests;
2. Next implement them in [`c_abi.jn`](./c_abi.jn) and [`c_abi.rs`](./c_abi.rs);
3. Run `node compiler/src/jenny.ts library/std/ffi/c_abi.jni` and `node compiler/src/jenny.ts std-check --domain ffi` to verify and check off `[x]`.
