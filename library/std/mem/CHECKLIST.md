# `std::mem` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/mem/CHECKLIST.md`)

> **Layer**: Layer 1 (Deterministic memory & region allocation layer, depends on `std::rt::intrinsics`)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`raw_buf.jni`](./raw_buf.jni), [`arena.jni`](./arena.jni)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain mem`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::mem` is the sole memory foundation underlying all standard library containers (`Vec`, `VecDeque`, `HashMap`, `LruCache`), string builders (`StringBuf`, `FmtBuffer`), and I/O streams (`IoCursor`, `BufChannel`):
1. **`std::mem::raw_buf::RawBuf`**: Encapsulates contiguous native heap memory (`*T`), guaranteeing zero allocation on zero capacity (`cap == 0 <=> ptr == 0`), geometric $2\times$ capacity growth, and deterministic deallocation;
2. **`std::mem::arena::BumpArena` & `Immix`**: Encapsulates an $O(1)$ 8-byte aligned linear bump arena allocator (supporting nested `checkpoint`/`rollback`) and an Immix mark-region pool structured into 64KB blocks and 128B lines.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/RAII) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::mem::raw_buf`** | [`raw_buf.jni`](./raw_buf.jni) | `7 / 7` ✅ | `0 / 6` 🎯 | `0 / 1` ⏳ | `0 / 1` ⏳ | **7 / 15** (`46.7%`) |
| **`std::mem::arena`** | [`arena.jni`](./arena.jni) | `7 / 7` ✅ | `0 / 3` 🎯 | `0 / 2` ⏳ | `0 / 2` ⏳ | **7 / 14** (`50.0%`) |
| **Sub-Domain Total** | **2 Modules** | **`14 / 14` (100%)** | **`0 / 9` (0%)** | **`0 / 3` (0%)** | **`0 / 3` (0%)** | **`14 / 29` (`48.3%`)** |

---

## 3. `std::mem::raw_buf` 4-Stage API Checklist (`Stage 1 ~ Stage 4`)

### 🟢 Stage 1: Minimal Contract Skeleton (`Skeleton` — `7 / 7` Completed ✅)
* `[x]` `RawBuf.new(cap: i64) -> RawBuf ! MemError`
* `[x]` `RawBuf.capacity(self) -> i64`
* `[x]` `RawBuf.read_at(self, idx: i64) -> i64 ! MemError`
* `[x]` `RawBuf.write_at(mut self, idx: i64, val: i64) -> i64 ! MemError`
* `[x]` `RawBuf.grow(mut self, min_cap: i64) -> i64 ! MemError`
* `[x]` `RawBuf.copy_within(mut self, src_off: i64, dst_off: i64, count: i64) -> i64 ! MemError`
* `[x]` `RawBuf.release(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`Core Production APIs` — `0 / 6` Planned)
> **Intent Note**: Completes capacity shrinking (`shrink_to`), in-place element swapping (`swap_at`), range filling (`fill_range`, covering zeroing), cross-buffer copying (`copy_from`), and range equality (`equals_range`) to support high-level bulk container operations (omitting redundant `zero_range` and encapsulation-breaking `as_raw_ptr`).
* `[ ]` `RawBuf.is_allocated(self) -> bool` — *Contract: `ensures result == (self.cap > 0 && self.ptr != 0)`*
* `[ ]` `RawBuf.shrink_to(mut self, new_cap: i64) -> i64 ! MemError` — *Contract: `requires new_cap >= 0 && new_cap <= self.cap else MemError.InvalidCopyRange`, `ensures self.cap == new_cap`*
* `[ ]` `RawBuf.swap_at(mut self, idx_a: i64, idx_b: i64) -> i64 ! MemError` — *Contract: `requires idx_a >= 0 && idx_a < self.cap && idx_b >= 0 && idx_b < self.cap else MemError.OutOfBounds`, `ensures self.cap == old(self.cap)`*
* `[ ]` `RawBuf.fill_range(mut self, start: i64, count: i64, val: i64) -> i64 ! MemError` — *Contract: `requires start >= 0 && count >= 0 else MemError.InvalidCopyRange`, `requires start + count <= self.cap else MemError.OutOfBounds`, `ensures result == count`*
* `[ ]` `RawBuf.copy_from(mut self, dst_off: i64, other: RawBuf, src_off: i64, count: i64) -> i64 ! MemError` — *Contract: `requires count >= 0 && dst_off >= 0 && src_off >= 0 else MemError.InvalidCopyRange`, `requires dst_off + count <= self.cap && src_off + count <= other.cap else MemError.OutOfBounds`, `ensures result == count`*
* `[ ]` `RawBuf.equals_range(self, self_off: i64, other: RawBuf, other_off: i64, count: i64) -> bool ! MemError` — *Contract: `requires count >= 0 && self_off >= 0 && other_off >= 0 else MemError.InvalidCopyRange`, `requires self_off + count <= self.cap && other_off + count <= other.cap else MemError.OutOfBounds`*

### ⏳ Stage 3: Generics `<T>` & Automatic RAII Destruction (`Generics & Auto-Drop` — `0 / 1` Planned)
* `[ ]` `RawBuf.drop(own self)` *(replaces manual `release`)*

### ⏳ Stage 4: Lexicographical Range Comparison (`Production v1.0` — `0 / 1` Planned)
* `[ ]` `RawBuf.compare_range(self, self_off: i64, other: RawBuf, other_off: i64, count: i64) -> i64 ! MemError`

---

## 4. `std::mem::arena` 4-Stage API Checklist (`Stage 1 ~ Stage 4`)

### 🟢 Stage 1: Minimal Contract Skeleton (`Skeleton` — `7 / 7` Completed ✅)
* `[x]` `BumpArena.new(capacity: i64) -> BumpArena ! ArenaError`
* `[x]` `BumpArena.alloc_aligned(mut self, size_bytes: i64) -> i64 ! ArenaError`
* `[x]` `BumpArena.checkpoint(self) -> i64`
* `[x]` `BumpArena.rollback(mut self, watermark: i64) -> i64 ! ArenaError`
* `[x]` `BumpArena.reset(mut self) -> i64`
* `[x]` `immix_spawn_node(id: i64, payload: i64, next: ^ImmixNode?) -> ^ImmixNode`
* `[x]` `immix_collect_keep_two(r1: ^ImmixNode, r2: ^ImmixNode) -> i64`

### 🎯 Stage 2: Core Production API Surface (`Core Production APIs` — `0 / 3` Planned)
> **Intent Note**: Since `capacity`, `used`, `peak_used`, and `allocs` on `BumpArena` are already `pub` read-only fields, redundant single-field getters are omitted, retaining only remaining byte capacity queries, alignment-aware allocation pre-checks (`can_alloc`), and array block allocation (`alloc_array`).
* `[ ]` `BumpArena.remaining_bytes(self) -> i64` — *Contract: `ensures result == self.capacity - self.used && result >= 0`*
* `[ ]` `BumpArena.can_alloc(self, size_bytes: i64) -> bool` — *Contract: `requires size_bytes >= 0`*
* `[ ]` `BumpArena.alloc_array(mut self, elem_size: i64, count: i64) -> i64 ! ArenaError` — *Contract: `requires elem_size > 0 && count > 0 else ArenaError.InvalidRequest`, `ensures self.used > old(self.used) && self.allocs == old(self.allocs) + 1`*

### ⏳ Stage 3: Typed Region Allocation (`*in(arena) T` & Reset Peak — `0 / 2` Planned)
* `[ ]` `BumpArena.reset_peak(mut self) -> i64`
* `[ ]` `immix_active_blocks() -> i64`

### ⏳ Stage 4: Incremental Immix Sweeping & Statistics (`Production v1.0` — `0 / 2` Planned)
* `[ ]` `immix_live_lines() -> i64`
* `[ ]` `immix_collect_all() -> i64`

---

## 5. Subagent Closed-Loop Execution SOP (`Intent -> .jni -> .jn -> Verify`)
1. First add the target Stage's function signatures and Hoare contracts in [`raw_buf.jni`](./raw_buf.jni) / [`arena.jni`](./arena.jni);
2. Next implement them in [`raw_buf.jn`](./raw_buf.jn) / [`arena.jn`](./arena.jn) and `.rs`;
3. Run `node compiler/src/jenny.ts library/std/mem/raw_buf.jni`, `node compiler/src/jenny.ts library/std/mem/arena.jni`, and `node compiler/src/jenny.ts std-check --domain mem` to verify and check off `[x]`.
