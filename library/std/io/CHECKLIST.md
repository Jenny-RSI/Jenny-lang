# `std::io` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/io/CHECKLIST.md`)

> **Layer**: Layer 3 (Seekable in-memory streams, buffered channels & traversal-safe normalized paths, depends on `std::mem::raw_buf`)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: [`cursor.jni`](./cursor.jni), [`buf_io.jni`](./buf_io.jni), [`path_buf.jni`](./path_buf.jni)  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain io`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::io` provides upper-layer protocol parsers and filesystems with zero-out-of-bounds, zero-path-traversal-escape in-memory stream and path abstractions:
1. **`std::io::cursor::IoCursor`**: Enforces the structural invariant `0 <= pos <= filled <= buf.cap`, eliminating the silent zero-read vulnerability in Rust's `Cursor` where a cursor is permitted to seek past the initialized end;
2. **`std::io::buf_io::BufChannel`**: Unifies buffered read/write watermarks (`0 <= read_pos <= write_pos <= buf.cap`) with in-place `compact()` frame compaction;
3. **`std::io::path_buf::PathBuf`**: Maintains a normalized stack of path segments in memory, statically and at runtime blocking `..` directory traversal attacks past the root (`PathError.TraversalEscape`) during `normalize_parent()`.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/Iter) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::io::cursor`** | [`cursor.jni`](./cursor.jni) | `8 / 8` ✅ | `0 / 6` 🎯 | `0 / 2` ⏳ | `0 / 2` ⏳ | **8 / 18** (`44.4%`) |
| **`std::io::buf_io`** | [`buf_io.jni`](./buf_io.jni) | `7 / 7` ✅ | `0 / 6` 🎯 | `0 / 2` ⏳ | `0 / 1` ⏳ | **7 / 16** (`43.8%`) |
| **`std::io::path_buf`** | [`path_buf.jni`](./path_buf.jni) | `7 / 7` ✅ | `0 / 6` 🎯 | `0 / 2` ⏳ | `0 / 2` ⏳ | **7 / 17** (`41.2%`) |
| **Sub-Domain Total** | **3 Modules** | **`22 / 22` (100%)** | **`0 / 18` (0%)** | **`0 / 6` (0%)** | **`0 / 5` (0%)** | **`22 / 51` (`43.1%`)** |

---

## 3. `std::io::cursor` 4-Stage API Checklist (`8 / 18`)

### 🟢 Stage 1: Minimal Contract Skeleton (`8 / 8` Completed ✅)
* `[x]` `IoCursor.new() -> IoCursor`
* `[x]` `IoCursor.with_capacity(cap: i64) -> IoCursor ! CursorError`
* `[x]` `IoCursor.remaining(self) -> i64`
* `[x]` `IoCursor.write_word(mut self, val: i64) -> i64 ! CursorError`
* `[x]` `IoCursor.read_word(mut self) -> i64 ! CursorError`
* `[x]` `IoCursor.seek_to(mut self, target_pos: i64) -> i64 ! CursorError`
* `[x]` `IoCursor.rewind(mut self) -> i64`
* `[x]` `IoCursor.drop_cursor(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 6` Planned)
> **Intent Note**: Omitting trivial getters for `pub` fields (`pos`/`filled`/`buf.cap`), focusing on EOF checks, relative offset seeking (`seek_relative`), seeking to end, non-destructive peeking (`peek_word`), filled truncation, and clear reset.
* `[ ]` `IoCursor.is_eof(self) -> bool` — *Contract: `ensures result == (self.pos == self.filled)`*
* `[ ]` `IoCursor.seek_relative(mut self, delta: i64) -> i64 ! CursorError` — *Contract: `requires self.pos + delta >= 0 && self.pos + delta <= self.filled else CursorError.InvalidSeek`, `ensures self.pos == old(self.pos) + delta`*
* `[ ]` `IoCursor.seek_to_end(mut self) -> i64` — *Contract: `ensures self.pos == self.filled && result == self.pos`*
* `[ ]` `IoCursor.peek_word(self) -> i64 ! CursorError` — *Contract: `requires self.pos < self.filled else CursorError.UnexpectedEof`*
* `[ ]` `IoCursor.truncate_filled(mut self, new_filled: i64) -> i64 ! CursorError` — *Contract: `requires new_filled >= 0 && new_filled <= self.filled else CursorError.InvalidSeek`*
* `[ ]` `IoCursor.clear(mut self) -> i64` — *Contract: `ensures self.pos == 0 && self.filled == 0`*

### ⏳ Stage 3: 16-Bit Little-Endian Integer Read/Write (`0 / 2` Planned)
* `[ ]` `IoCursor.write_u16_le(mut self, val: i64) -> i64 ! CursorError`
* `[ ]` `IoCursor.read_u16_le(mut self) -> i64 ! CursorError`

### ⏳ Stage 4: 32-Bit Little-Endian Symmetric Read/Write (`0 / 2` Planned)
* `[ ]` `IoCursor.write_u32_le(mut self, val: i64) -> i64 ! CursorError`
* `[ ]` `IoCursor.read_u32_le(mut self) -> i64 ! CursorError`

---

## 4. `std::io::buf_io` 4-Stage API Checklist (`7 / 16`)

### 🟢 Stage 1: Minimal Contract Skeleton (`7 / 7` Completed ✅)
* `[x]` `BufChannel.with_capacity(cap: i64) -> BufChannel ! BufIoError`
* `[x]` `BufChannel.unread_len(self) -> i64`
* `[x]` `BufChannel.write_frame(mut self, payload: i64) -> i64 ! BufIoError`
* `[x]` `BufChannel.read_frame(mut self) -> i64 ! BufIoError`
* `[x]` `BufChannel.compact(mut self) -> i64 ! BufIoError`
* `[x]` `BufChannel.flush_all(mut self) -> i64`
* `[x]` `BufChannel.drop_channel(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 6` Planned)
> **Intent Note**: Omitting `pub` field getters (`buf.cap`/`flushed_count`), focusing on zero-capacity construction, emptiness checks, available write capacity, front-frame peeking (`peek_frame`), bulk frame skipping (`skip_frames`), and clear reset.
* `[ ]` `BufChannel.new() -> BufChannel` — *Contract: `ensures result.read_pos == 0 && result.write_pos == 0 && result.buf.cap == 0`*
* `[ ]` `BufChannel.is_empty(self) -> bool` — *Contract: `ensures result == (self.read_pos == self.write_pos)`*
* `[ ]` `BufChannel.available_write_cap(self) -> i64` — *Contract: `ensures result == self.buf.cap - self.write_pos && result >= 0`*
* `[ ]` `BufChannel.peek_frame(self) -> i64 ! BufIoError` — *Contract: `requires self.read_pos < self.write_pos else BufIoError.BufferUnderflow`*
* `[ ]` `BufChannel.skip_frames(mut self, count: i64) -> i64 ! BufIoError` — *Contract: `requires count >= 0 && self.read_pos + count <= self.write_pos else BufIoError.BufferUnderflow`, `ensures self.read_pos == old(self.read_pos) + count`*
* `[ ]` `BufChannel.clear_reset(mut self) -> i64` — *Contract: `ensures self.read_pos == 0 && self.write_pos == 0`*

### ⏳ Stage 3: Bulk Repeated Writes & Reservation (`0 / 2` Planned)
* `[ ]` `BufChannel.reserve(mut self, additional: i64) -> i64 ! BufIoError`
* `[ ]` `BufChannel.write_repeat_frame(mut self, payload: i64, count: i64) -> i64 ! BufIoError`

### ⏳ Stage 4: Bulk Draining & Automatic Destruction (`0 / 1` Planned)
* `[ ]` `BufChannel.drain_count(mut self, count: i64) -> i64 ! BufIoError`

---

## 5. `std::io::path_buf` 4-Stage API Checklist (`7 / 17`)

### 🟢 Stage 1: Minimal Contract Skeleton (`7 / 7` Completed ✅)
* `[x]` `PathBuf.new(is_abs: i64) -> PathBuf ! PathError`
* `[x]` `PathBuf.depth(self) -> i64`
* `[x]` `PathBuf.push_segment(mut self, seg_id: i64) -> i64 ! PathError`
* `[x]` `PathBuf.pop_segment(mut self) -> i64 ! PathError`
* `[x]` `PathBuf.normalize_parent(mut self) -> i64 ! PathError`
* `[x]` `PathBuf.leaf_segment(self) -> i64 ! PathError`
* `[x]` `PathBuf.drop_path(mut self) -> i64`

### 🎯 Stage 2: Core Production API Surface (`0 / 6` Planned)
> **Intent Note**: Completes absolute path checks (omitting `is_relative` which is equivalent to `!is_absolute()`), empty path checks, root/parent/indexed segment access, and clear reset.
* `[ ]` `PathBuf.is_absolute(self) -> bool` — *Contract: `ensures result == (self.is_abs == 1)`*
* `[ ]` `PathBuf.is_empty(self) -> bool` — *Contract: `ensures result == (self.depth == 0)`*
* `[ ]` `PathBuf.root_segment(self) -> i64 ! PathError` — *Contract: `requires self.depth > 0 else PathError.EmptyPath`*
* `[ ]` `PathBuf.segment_at(self, idx: i64) -> i64 ! PathError` — *Contract: `requires idx >= 0 && idx < self.depth else PathError.EmptyPath`*
* `[ ]` `PathBuf.parent_segment(self) -> i64 ! PathError` — *Contract: `requires self.depth >= 2 else PathError.EmptyPath`*
* `[ ]` `PathBuf.clear(mut self) -> i64` — *Contract: `ensures self.depth == 0`*

### ⏳ Stage 3: Prefix Matching & Path Joining (`0 / 2` Planned)
* `[ ]` `PathBuf.has_prefix(self, prefix: PathBuf) -> bool`
* `[ ]` `PathBuf.join_from(mut self, child: PathBuf) -> i64 ! PathError`

### ⏳ Stage 4: Path Equality Comparison & Segment Iterator (`0 / 2` Planned)
* `[ ]` `PathBuf.equals_path(self, other: PathBuf) -> bool`
* `[ ]` `PathBuf.iter_segments(self) -> i64` (`iter fn`)
