# `std::collections` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/collections/CHECKLIST.md`)

> **Layer**: Layer 2 (Linear & hash container layer, depends on `std::mem::raw_buf`)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`vec.jni`](./vec.jni), [`vec_deque.jni`](./vec_deque.jni), [`hash_map.jni`](./hash_map.jni), [`lru_cache.jni`](./lru_cache.jni)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain collections`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::collections` builds four foundational containers on top of `std::mem::raw_buf::RawBuf` with zero `unsafe` pointer arithmetic. All capacity growth/shrinking, ring-buffer wrap-arounds, open-addressing load factors ($\le 75\%$), and doubly-linked list MRU promotions are continuously guarded by `.jni` struct `invariant` clauses.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/Iter) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::collections::vec`** | [`vec.jni`](./vec.jni) | `14 / 14` ✅ | `0 / 12` 🎯 | `0 / 4` ⏳ | `0 / 1` ⏳ | **14 / 31** (`45.2%`) |
| **`std::collections::vec_deque`** | [`vec_deque.jni`](./vec_deque.jni) | `13 / 13` ✅ | `0 / 7` 🎯 | `0 / 3` ⏳ | `0 / 1` ⏳ | **13 / 24** (`54.2%`) |
| **`std::collections::hash_map`** | [`hash_map.jni`](./hash_map.jni) | `11 / 11` ✅ | `0 / 7` 🎯 | `0 / 3` ⏳ | `0 / 2` ⏳ | **11 / 23** (`47.8%`) |
| **`std::collections::lru_cache`** | [`lru_cache.jni`](./lru_cache.jni) | `7 / 7` ✅ | `0 / 6` 🎯 | `0 / 3` ⏳ | `0 / 1` ⏳ | **7 / 17** (`41.2%`) |
| **Sub-Domain Total** | **4 Modules** | **`45 / 45` (100%)** | **`0 / 32` (0%)** | **`0 / 13` (0%)** | **`0 / 5` (0%)** | **`45 / 95` (`47.4%`)** |

---

## 3. `std::collections::vec` 4-Stage API Checklist (`14 / 31`)

### 🟢 Stage 1: Minimal Contract Skeleton (`14 / 14` Completed ✅)
* `[x]` `Vec.new() -> Vec`
* `[x]` `Vec.with_capacity(cap: i64) -> Vec ! VecError`
* `[x]` `Vec.len(self) -> i64`
* `[x]` `Vec.capacity(self) -> i64`
* `[x]` `Vec.is_empty(self) -> bool`
* `[x]` `Vec.reserve(mut self, additional: i64) -> i64 ! VecError`
* `[x]` `Vec.push(mut self, val: i64) -> i64 ! VecError`
* `[x]` `Vec.pop(mut self) -> i64 ! VecError`
* `[x]` `Vec.get(self, idx: i64) -> i64 ! VecError`
* `[x]` `Vec.set(mut self, idx: i64, val: i64) -> i64 ! VecError`
* `[x]` `Vec.insert_at(mut self, idx: i64, val: i64) -> i64 ! VecError`
* `[x]` `Vec.remove_at(mut self, idx: i64) -> i64 ! VecError`
* `[x]` `Vec.clear(mut self) -> i64`
* `[x]` `Vec.drop_vec(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 12` Planned)
> **Intent Note**: Completes front/back element access, $O(1)$ tail swap removal (`swap_remove`), in-place truncation/filling/reversal/sorting, linear search, and binary search.
* `[ ]` `Vec.first(self) -> i64 ! VecError` — *Contract: `requires self.len > 0 else VecError.EmptyVec`*
* `[ ]` `Vec.last(self) -> i64 ! VecError` — *Contract: `requires self.len > 0 else VecError.EmptyVec`*
* `[ ]` `Vec.swap_remove(mut self, idx: i64) -> i64 ! VecError` — *Contract: `requires idx >= 0 && idx < self.len else VecError.IndexOutOfBounds`, `ensures self.len == old(self.len) - 1`*
* `[ ]` `Vec.swap(mut self, idx_a: i64, idx_b: i64) -> i64 ! VecError` — *Contract: `requires idx_a >= 0 && idx_a < self.len && idx_b >= 0 && idx_b < self.len else VecError.IndexOutOfBounds`, `ensures self.len == old(self.len)`*
* `[ ]` `Vec.truncate(mut self, new_len: i64) -> i64 ! VecError` — *Contract: `requires new_len >= 0 && new_len <= self.len else VecError.IndexOutOfBounds`, `ensures self.len == new_len`*
* `[ ]` `Vec.resize(mut self, new_len: i64, fill_val: i64) -> i64 ! VecError` — *Contract: `requires new_len >= 0 && new_len <= 1048576 else VecError.CapacityOverflow`, `ensures self.len == new_len`*
* `[ ]` `Vec.fill(mut self, val: i64) -> i64` — *Contract: `ensures self.len == old(self.len) && result == self.len`*
* `[ ]` `Vec.contains(self, target: i64) -> bool`
* `[ ]` `Vec.index_of(self, target: i64) -> i64` — *Contract: `ensures result >= -1 && result < self.len`*
* `[ ]` `Vec.reverse(mut self) -> i64` — *Contract: `ensures self.len == old(self.len)`*
* `[ ]` `Vec.sort_asc(mut self) -> i64` — *Contract: `ensures self.len == old(self.len)`*
* `[ ]` `Vec.binary_search(self, target: i64) -> i64` — *Contract: `ensures result >= -1 && result < self.len`*

### ⏳ Stage 3: Generics `<T>`, Bulk Extension & Automatic RAII (`0 / 4` Planned)
* `[ ]` `Vec.shrink_to_fit(mut self) -> i64 ! VecError`
* `[ ]` `Vec.extend_from(mut self, other: Vec) -> i64 ! VecError`
* `[ ]` `Vec.equals(self, other: Vec) -> bool`
* `[ ]` `Vec.iter(self) -> i64` (`iter fn`)

### ⏳ Stage 4: Sorted Deduplication (`0 / 1` Planned)
* `[ ]` `Vec.dedup_sorted(mut self) -> i64`

---

## 4. `std::collections::vec_deque` 4-Stage API Checklist (`13 / 24`)

### 🟢 Stage 1: Minimal Contract Skeleton (`13 / 13` Completed ✅)
* `[x]` `VecDeque.new() -> VecDeque`
* `[x]` `VecDeque.with_capacity(cap: i64) -> VecDeque ! DequeError`
* `[x]` `VecDeque.len(self) -> i64`
* `[x]` `VecDeque.capacity(self) -> i64`
* `[x]` `VecDeque.is_empty(self) -> bool`
* `[x]` `VecDeque.grow_ring(mut self) -> i64 ! DequeError`
* `[x]` `VecDeque.push_back(mut self, val: i64) -> i64 ! DequeError`
* `[x]` `VecDeque.push_front(mut self, val: i64) -> i64 ! DequeError`
* `[x]` `VecDeque.pop_front(mut self) -> i64 ! DequeError`
* `[x]` `VecDeque.pop_back(mut self) -> i64 ! DequeError`
* `[x]` `VecDeque.get(self, logical_idx: i64) -> i64 ! DequeError`
* `[x]` `VecDeque.clear(mut self) -> i64`
* `[x]` `VecDeque.drop_deque(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 7` Planned)
> **Intent Note**: Completes double-ended queue front/back peeking (`front`/`back`), logical-index overwrite and swap, truncation, search, and ring contiguous linearization (`make_contiguous`, omitting low-frequency `rotate_left`/`rotate_right`).
* `[ ]` `VecDeque.front(self) -> i64 ! DequeError` — *Contract: `requires self.len > 0 else DequeError.EmptyDeque`*
* `[ ]` `VecDeque.back(self) -> i64 ! DequeError` — *Contract: `requires self.len > 0 else DequeError.EmptyDeque`*
* `[ ]` `VecDeque.set(mut self, logical_idx: i64, val: i64) -> i64 ! DequeError` — *Contract: `requires logical_idx >= 0 && logical_idx < self.len else DequeError.IndexOutOfBounds`*
* `[ ]` `VecDeque.swap(mut self, idx_a: i64, idx_b: i64) -> i64 ! DequeError` — *Contract: `requires idx_a >= 0 && idx_a < self.len && idx_b >= 0 && idx_b < self.len else DequeError.IndexOutOfBounds`*
* `[ ]` `VecDeque.truncate(mut self, new_len: i64) -> i64 ! DequeError` — *Contract: `requires new_len >= 0 && new_len <= self.len else DequeError.IndexOutOfBounds`, `ensures self.len == new_len`*
* `[ ]` `VecDeque.contains(self, target: i64) -> bool`
* `[ ]` `VecDeque.make_contiguous(mut self) -> i64 ! DequeError` — *Contract: `ensures self.head == 0 && self.len == old(self.len)`*

### ⏳ Stage 3: Capacity Reservation, Bulk Append & Iterator (`0 / 3` Planned)
* `[ ]` `VecDeque.reserve(mut self, additional: i64) -> i64 ! DequeError`
* `[ ]` `VecDeque.extend_back(mut self, other: VecDeque) -> i64 ! DequeError`
* `[ ]` `VecDeque.iter(self) -> i64` (`iter fn`)

### ⏳ Stage 4: Capacity Shrinking & Slice Views (`0 / 1` Planned)
* `[ ]` `VecDeque.shrink_to_fit(mut self) -> i64 ! DequeError`

---

## 5. `std::collections::hash_map` 4-Stage API Checklist (`11 / 23`)

### 🟢 Stage 1: Minimal Contract Skeleton (`11 / 11` Completed ✅)
* `[x]` `HashMap.new() -> HashMap`
* `[x]` `HashMap.with_capacity(initial_cap: i64) -> HashMap ! MapError`
* `[x]` `HashMap.len(self) -> i64`
* `[x]` `HashMap.capacity(self) -> i64`
* `[x]` `HashMap.is_empty(self) -> bool`
* `[x]` `HashMap.rehash_to(mut self, new_cap: i64) -> i64 ! MapError`
* `[x]` `HashMap.insert(mut self, key: i64, val: i64) -> i64 ! MapError`
* `[x]` `HashMap.get(self, key: i64) -> i64 ! MapError`
* `[x]` `HashMap.contains_key(self, key: i64) -> bool`
* `[x]` `HashMap.remove(mut self, key: i64) -> i64 ! MapError`
* `[x]` `HashMap.drop_map(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 7` Planned)
> **Intent Note**: Completes clear reset, capacity reservation, read with fallback (`get_or_default`), insert-if-absent (`try_insert`), and in-place accumulation (`upsert_add`), while hiding internal tombstone implementation details (omitting `tombstone_count`).
* `[ ]` `HashMap.clear(mut self) -> i64` — *Contract: `ensures self.len == 0 && self.tombstones == 0`*
* `[ ]` `HashMap.reserve(mut self, additional: i64) -> i64 ! MapError` — *Contract: `requires additional >= 0 && self.len + additional <= 196608 else MapError.CapacityOverflow`*
* `[ ]` `HashMap.get_or_default(self, key: i64, default_val: i64) -> i64`
* `[ ]` `HashMap.try_insert(mut self, key: i64, val: i64) -> bool ! MapError` — *Contract: `requires self.len < 196608 else MapError.CapacityOverflow`, `ensures self.len >= old(self.len)`*
* `[ ]` `HashMap.upsert_add(mut self, key: i64, delta: i64) -> i64 ! MapError` — *Contract: `requires self.len < 196608 else MapError.CapacityOverflow`*
* `[ ]` `HashMap.shrink_to_fit(mut self) -> i64 ! MapError`
* `[ ]` `HashMap.equals(self, other: HashMap) -> bool`

### ⏳ Stage 3: Generics `<K: Hash + Eq, V>` & Key-Value Iterators (`0 / 3` Planned)
* `[ ]` `HashMap.keys(self) -> i64` (`iter fn`)
* `[ ]` `HashMap.values(self) -> i64` (`iter fn`)
* `[ ]` `HashMap.iter(self) -> (i64, i64)` (`iter fn`)

### ⏳ Stage 4: Bulk Merge & Automatic Destruction (`0 / 2` Planned)
* `[ ]` `HashMap.extend_from(mut self, other: HashMap) -> i64 ! MapError`
* `[ ]` `HashMap.drop(own self)`

---

## 6. `std::collections::lru_cache` 4-Stage API Checklist (`7 / 17`)

### 🟢 Stage 1: Minimal Contract Skeleton (`7 / 7` Completed ✅)
* `[x]` `LruCache.new(capacity: i64) -> LruCache ! LruError`
* `[x]` `LruCache.len(self) -> i64`
* `[x]` `LruCache.promote_slot(mut self, slot: i64) -> i64 ! LruError`
* `[x]` `LruCache.put(mut self, key: i64, val: i64) -> i64 ! LruError`
* `[x]` `LruCache.get_promote(mut self, key: i64) -> i64 ! LruError`
* `[x]` `LruCache.peek(self, key: i64) -> i64 ! LruError`
* `[x]` `LruCache.drop_cache(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 6` Planned)
> **Intent Note**: Omitting trivial getters for `pub` fields (`hits`/`misses`/`evictions`), focusing on full-capacity checks, key existence, MRU/LRU endpoint key peeking, clear reset, and explicit key removal (`remove`).
* `[ ]` `LruCache.is_full(self) -> bool` — *Contract: `ensures result == (self.len == self.capacity)`*
* `[ ]` `LruCache.contains_key(self, key: i64) -> bool`
* `[ ]` `LruCache.peek_mru_key(self) -> i64 ! LruError` — *Contract: `requires self.len > 0 else LruError.KeyNotFound`*
* `[ ]` `LruCache.peek_lru_key(self) -> i64 ! LruError` — *Contract: `requires self.len > 0 else LruError.KeyNotFound`*
* `[ ]` `LruCache.clear(mut self) -> i64` — *Contract: `ensures self.len == 0`*
* `[ ]` `LruCache.remove(mut self, key: i64) -> i64 ! LruError` — *Contract: `requires self.len > 0 else LruError.KeyNotFound`*

### ⏳ Stage 3: LRU Tail Eviction Pop & Statistics Reset (`0 / 3` Planned)
* `[ ]` `LruCache.pop_lru(mut self) -> i64 ! LruError`
* `[ ]` `LruCache.reset_stats(mut self) -> i64`
* `[ ]` `LruCache.iter_mru_order(self) -> (i64, i64)` (`iter fn`)

### ⏳ Stage 4: Dynamic Capacity Resizing & Automatic RAII (`0 / 1` Planned)
* `[ ]` `LruCache.drop(own self)`
