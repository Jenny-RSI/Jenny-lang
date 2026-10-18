# `std::fiber` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/fiber/CHECKLIST.md`)

> **Layer**: Layer 4 (Structured concurrency, synchronization dispatch contexts, proactive completion cells, bounded backpressure channels & data parallelism)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: `task.jni`, `channel.jni`, `sync.jni`, `parallel.jni`  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain fiber`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::fiber` is Jenny's core production concurrency foundation built upon **"Pin-Free Cooperative State-Machine Lowering + the Concurrency Iron Triangle (`SyncContext` + `CompletionCell` + `FiberScope`)"**:
1. **Pin-Free Relocatable Continuation State Machines (`Pin-Free Continuation Lowering`)**: Because Jenny v2.0 forbids taking addresses of local stack variables (`&x`), any function with `effects [Async]` and `.await` suspension points is automatically lowered by the compiler into a 100% position-independent (`Relocatable`) flat frame struct `<Fn>_Frame`, completely eliminating Rust's `Pin<&mut Self>` / `Unpin` viral complexity and C++20 coroutines' implicit per-invocation heap allocations;
2. **Four Orthogonal Dispatch Contexts (`SyncContext`)**: Explicitly provides `ThreadPinned` (UI/Wasm single-thread affinity), `StrandSerial` (logical serial queue with `invariant active_running <= 1`, enabling multiple fibers to safely share mutable `^T` managed object graphs without locks), `WorkStealing` (multi-threaded work-stealing pool that statically requires cross-task payloads to satisfy `Send`), and `DeterministicSim` (virtual-clock sandbox enabling 100% reproducible concurrent contract verification in `@example` tests), while eliminating C#'s `ConfigureAwait(false)` deadlock traps via in-place `drain_ready` / `block_on` event pumps;
3. **Single-Shot Proactive Async Event Completion Slot (`CompletionCell`)**: Follows a 3-state monotonic state machine (`Pending -> ResolvedOk | ResolvedErr | Abandoned`) allowing low-level I/O events, timers, or external callbacks to proactively fulfill results, automatically waking the suspended frame and posting it back to its original `SyncContext`, while triggering RAII `abandon` protection if dropped before completion to completely prevent forever-hangs;
4. **Structured Concurrency Nursery & Cascading Cancellation (`FiberScope` & `CancelToken`)**: Strictly enforces the Hoare invariant `invariant total_spawned == active_count + completed_count + failed_count + cancelled_count` and exit postcondition `ensures active_count == 0`, allowing child tasks to share parent stack slices directly with zero copying and without `'static` bounds or `Arc` wrappers.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/Combinators) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::fiber::task`** | [`task.jni`](./task.jni) | `0 / 12` 🎯 | `0 / 9` ⏳ | `0 / 3` ⏳ | `0 / 1` ⏳ | **0 / 25** (`0.0%`) |
| **`std::fiber::channel`** | [`channel.jni`](./channel.jni) | `0 / 7` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 14** (`0.0%`) |
| **`std::fiber::sync`** | [`sync.jni`](./sync.jni) | `0 / 7` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 14** (`0.0%`) |
| **`std::fiber::parallel`** | [`parallel.jni`](./parallel.jni) | `0 / 5` 🎯 | `0 / 3` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 11** (`0.0%`) |
| **Sub-Domain Total** | **4 Modules** | **`0 / 31` (0%)** | **`0 / 20` (0%)** | **`0 / 9` (0%)** | **`0 / 4` (0%)** | **`0 / 64` (`0.0%`)** |

---

## 3. `std::fiber::task` 4-Stage API Checklist (`SyncContext`, `CompletionCell`, `FiberScope` & `CancelToken` — `0 / 25`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 12` Planned)
* `[ ]` `SyncContext.new_strand_serial(max_queue_cap: i64) -> SyncContext ! TaskError` — *Contract: `requires max_queue_cap > 0`, `ensures result.mode == DispatchMode.StrandSerial && result.active_running == 0`*
* `[ ]` `SyncContext.new_deterministic_sim(max_queue_cap: i64, start_clock_ms: i64) -> SyncContext ! TaskError` — *Contract: `requires max_queue_cap > 0 && start_clock_ms >= 0`, `ensures result.mode == DispatchMode.DeterministicSim && result.virtual_clock_ms == start_clock_ms`*
* `[ ]` `SyncContext.post_continuation(mut self, frame_id: i64) -> i64 ! TaskError` — *Contract: `requires !self.is_shutdown else TaskError.ContextClosed`, `requires self.queued_ready < self.max_queue_cap else TaskError.QueueFull`, `ensures self.queued_ready == old(self.queued_ready) + 1`*
* `[ ]` `SyncContext.drain_ready(mut self, max_steps: i64) -> i64 ! TaskError` — *Pumps ready continuation frames in-place, Contract: `requires max_steps > 0`, `ensures self.active_running == 0`*
* `[ ]` `CompletionCell.new(bound_ctx_id: i64) -> CompletionCell ! TaskError` — *Contract: `requires bound_ctx_id > 0`, `ensures result.state == CompletionState.Pending && !result.has_waiter`*
* `[ ]` `CompletionCell.register_waiter(mut self, frame_id: i64) -> bool ! TaskError` — *Contract: `requires !self.has_waiter else TaskError.DuplicateWaiter`*
* `[ ]` `CompletionCell.complete_ok(mut self, mut sync_ctx: SyncContext, val: i64) -> i64 ! TaskError` — *Contract: `requires self.state == CompletionState.Pending else TaskError.AlreadyCompleted`, `ensures self.state == CompletionState.ResolvedOk && self.value_slot == val`*
* `[ ]` `CompletionCell.complete_err(mut self, mut sync_ctx: SyncContext, err_code64: i64) -> i64 ! TaskError` — *Contract: `requires self.state == CompletionState.Pending else TaskError.AlreadyCompleted`, `ensures self.state == CompletionState.ResolvedErr && self.err_code64 == err_code64`*
* `[ ]` `CompletionCell.await_result(mut self) -> i64 ! TaskError` — *Contract: `requires self.state != CompletionState.Abandoned else TaskError.ProducerAbandoned`*
* `[ ]` `FiberScope.new(max_concurrency: i64, budget_ms: i64) -> FiberScope ! TaskError` — *Contract: `requires max_concurrency > 0 && budget_ms >= 0`, `ensures result.total_spawned == 0 && result.active_count == 0`*
* `[ ]` `FiberScope.spawn_val(mut self, simulated_val: i64, simulated_err_code: i64) -> TaskHandle ! TaskError` — *Contract: `requires !self.is_closed && !self.cancel_triggered`, `ensures self.total_spawned == old(self.total_spawned) + 1`*
* `[ ]` `FiberScope.join_all(mut self) -> i64 ! TaskError` — *Contract: `ensures self.active_count == 0 && self.is_closed == true`*

### ⏳ Stage 2: Core Production API Surface (`0 / 9` Planned)
* `[ ]` `SyncContext.new_thread_pinned(thread_id: i64, max_queue_cap: i64) -> SyncContext ! TaskError`
* `[ ]` `SyncContext.new_work_stealing(worker_threads: i64, max_queue_cap: i64) -> SyncContext ! TaskError`
* `[ ]` `SyncContext.advance_virtual_clock(mut self, delta_ms: i64) -> i64 ! TaskError` — *Contract: `requires self.mode == DispatchMode.DeterministicSim && delta_ms >= 0`, `ensures self.virtual_clock_ms == old(self.virtual_clock_ms) + delta_ms`*
* `[ ]` `CompletionCell.try_complete_ok(mut self, mut sync_ctx: SyncContext, val: i64) -> bool` — *Idempotent completion primitive safe for races between timeouts and normal callbacks*
* `[ ]` `CompletionCell.abandon(mut self, mut sync_ctx: SyncContext) -> i64` — *RAII deadlock-prevention safeguard when a producer is abnormally dropped*
* `[ ]` `FiberScope.race_first(mut self) -> i64 ! TaskError` — *Automatically cancels remaining active child tasks once the first child task wins (`ensures self.active_count == 0`)*
* `[ ]` `FiberScope.settle_all(mut self) -> (i64, i64)` — *Waits for all tasks to settle and returns `(completed_count, failed_count)`*
* `[ ]` `FiberScope.cancel_token(self) -> CancelToken`
* `[ ]` `CancelToken.check_cancelled(self) -> i64 ! TaskError` — *Contract: `requires !self.is_cancelled else TaskError.Cancelled`*

### ⏳ Stage 3: True Generics `TaskHandle<T ! E>`, `CompletionCell<T ! E>` & Causal Stack Stitching (`0 / 3` Planned)
* `[ ]` `FiberScope.await_handle(mut self, mut handle: TaskHandle) -> i64 ! TaskError` — *Contract: `requires handle.scope_id == self.scope_id && !handle.is_joined`, automatically invokes `ErrorTrace.stitch_from_child` on error*
* `[ ]` `SyncContext.block_on(mut self, root_frame_id: i64) -> i64 ! TaskError` — *Adaptive event pump eliminating sync-over-async deadlocks*
* `[ ]` `CancelToken.is_cancelled(self) -> bool`

### ⏳ Stage 4: RAII `drop(own self)` Structured Nursery Fallback Convergence Verification (`0 / 1` Planned)
* `[ ]` `FiberScope.drop(own self) -> void` — *Forces cascading cancellation and reclamation of all child fibers when exiting a `@scoped` block*

---

## 4. `std::fiber::channel` 4-Stage API Checklist (Bounded Backpressure MPSC Channels & Oneshot Channels — `0 / 14`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `BoundedChannel.with_capacity(cap: i64) -> BoundedChannel ! ChannelError` — *Contract: `requires cap > 0 else ChannelError.InvalidCapacity`, `ensures result.cap == cap && result.len == 0 && !result.is_closed`*
* `[ ]` `BoundedChannel.send(mut self, val: i64) -> i64 ! ChannelError` — *Contract: `requires !self.is_closed else ChannelError.Closed`, `requires self.len < self.cap else ChannelError.Full`, `ensures self.len == old(self.len) + 1`*
* `[ ]` `BoundedChannel.recv(mut self) -> i64 ! ChannelError` — *Contract: `requires self.len > 0 else ChannelError.Empty`, `ensures self.len == old(self.len) - 1`*
* `[ ]` `BoundedChannel.try_send(mut self, val: i64) -> bool`
* `[ ]` `BoundedChannel.try_recv(mut self) -> i64?`
* `[ ]` `BoundedChannel.close(mut self) -> i64` — *Contract: `ensures self.is_closed == true`*
* `[ ]` `BoundedChannel.len(self) -> i64` — *Contract: `ensures result == self.len && result >= 0 && result <= self.cap`*

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `BoundedChannel.is_empty(self) -> bool`
* `[ ]` `BoundedChannel.is_full(self) -> bool`
* `[ ]` `OneshotChannel.new() -> OneshotChannel`
* `[ ]` `OneshotChannel.send_once(mut self, val: i64) -> i64 ! ChannelError`

### ⏳ Stage 3: Zero-Copy Exclusive Ownership Transfer (`BoundedChannel<*T>`) & `iter fn drain` (`0 / 2` Planned)
* `[ ]` `OneshotChannel.recv_once(mut self) -> i64 ! ChannelError`
* `[ ]` `BoundedChannel.remaining_capacity(self) -> i64`

### ⏳ Stage 4: RAII Close Wakeup & Buffer Deallocation (`0 / 1` Planned)
* `[ ]` `BoundedChannel.drop(own self) -> void`

---

## 5. `std::fiber::sync` 4-Stage API Checklist (Fiber-Aware Async Mutexes, Semaphores & WaitGroups — `0 / 14`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `AsyncMutex.new(initial_val: i64) -> AsyncMutex` — *Contract: `ensures !result.is_locked && result.protected_val == initial_val`*
* `[ ]` `AsyncMutex.lock_acquire(mut self) -> i64 ! SyncError` — *Contract: `requires !self.is_locked else SyncError.WouldDeadlock`, `ensures self.is_locked == true`*
* `[ ]` `AsyncMutex.unlock_release(mut self, new_val: i64) -> i64 ! SyncError` — *Contract: `requires self.is_locked else SyncError.NotLocked`, `ensures !self.is_locked && self.protected_val == new_val`*
* `[ ]` `AsyncSemaphore.new(max_permits: i64) -> AsyncSemaphore ! SyncError` — *Contract: `requires max_permits > 0 else SyncError.InvalidPermits`, `ensures result.available == max_permits && result.max_permits == max_permits`*
* `[ ]` `AsyncSemaphore.acquire(mut self, count: i64) -> i64 ! SyncError` — *Contract: `requires count > 0 && count <= self.available else SyncError.InsufficientPermits`, `ensures self.available == old(self.available) - count`*
* `[ ]` `AsyncSemaphore.release(mut self, count: i64) -> i64 ! SyncError` — *Contract: `requires count > 0 && self.available + count <= self.max_permits else SyncError.PermitOverflow`, `ensures self.available == old(self.available) + count`*
* `[ ]` `AsyncSemaphore.available_permits(self) -> i64`

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `AsyncMutex.try_lock(mut self) -> bool`
* `[ ]` `AsyncSemaphore.try_acquire(mut self, count: i64) -> bool`
* `[ ]` `WaitGroup.new() -> WaitGroup` — *Contract: `ensures result.pending == 0`*
* `[ ]` `WaitGroup.add_delta(mut self, delta: i64) -> i64 ! SyncError`

### ⏳ Stage 3: RAII Scoped Lock Guards (`MutexGuard<T>`) & `WaitGroup` Rendezvous (`0 / 2` Planned)
* `[ ]` `WaitGroup.done_one(mut self) -> i64 ! SyncError`
* `[ ]` `WaitGroup.wait_zero(self) -> i64 ! SyncError` — *Contract: `requires self.pending == 0 else SyncError.PendingTasksRemain`*

### ⏳ Stage 4: Deadlock Topology Detection & Deterministic Schedule Verification (`0 / 1` Planned)
* `[ ]` `AsyncMutex.read_locked_val(self) -> i64 ! SyncError`

---

## 6. `std::fiber::parallel` 4-Stage API Checklist (Data-Race-Free Structured Divide-and-Conquer Parallelism — `0 / 11`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 5` Planned)
* `[ ]` `par_chunk_bounds(total_len: i64, num_chunks: i64, chunk_idx: i64) -> (i64, i64) ! ParallelError` — *Contract: `requires total_len >= 0 && num_chunks > 0 && chunk_idx >= 0 && chunk_idx < num_chunks else ParallelError.InvalidChunkBounds`*
* `[ ]` `par_reduce_sum(xs: []i64, grain_size: i64) -> i64 ! ParallelError` — *Contract: `requires grain_size > 0 else ParallelError.InvalidGrainSize`*
* `[ ]` `par_reduce_min(xs: []i64, grain_size: i64) -> i64 ! ParallelError` — *Contract: `requires xs.len > 0 && grain_size > 0`*
* `[ ]` `par_reduce_max(xs: []i64, grain_size: i64) -> i64 ! ParallelError` — *Contract: `requires xs.len > 0 && grain_size > 0`*
* `[ ]` `par_count_ge(xs: []i64, threshold: i64, grain_size: i64) -> i64 ! ParallelError` — *Contract: `requires grain_size > 0`, `ensures result >= 0 && result <= xs.len`*

### ⏳ Stage 2: Core Production API Surface (`0 / 3` Planned)
* `[ ]` `par_map_scale_inplace(mut xs: []i64, factor: i64, grain_size: i64) -> i64 ! ParallelError` — *In-place parallel mapping over disjoint mutable sub-slices (`Disjoint Mutable Sub-Slices`)*
* `[ ]` `par_all_ge(xs: []i64, min_val: i64, grain_size: i64) -> bool ! ParallelError`
* `[ ]` `par_any_ge(xs: []i64, min_val: i64, grain_size: i64) -> bool ! ParallelError`

### ⏳ Stage 3: True Generic Higher-Order Parallel Operators (`par_map` / `par_reduce` / `par_sort` — `0 / 2` Planned)
* `[ ]` `par_dot_product(a: []i64, b: []i64, grain_size: i64) -> i64 ! ParallelError` — *Contract: `requires a.len == b.len && grain_size > 0`*
* `[ ]` `par_prefix_scan_sum(mut xs: []i64, grain_size: i64) -> i64 ! ParallelError`

### ⏳ Stage 4: Adaptive Grain-Size Splitting for Work-Stealing Thread Pools (`0 / 1` Planned)
* `[ ]` `optimal_grain_size(total_len: i64, worker_threads: i64) -> i64 ! ParallelError`
