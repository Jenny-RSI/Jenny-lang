# `std::thread` Sub-Domain Intent Blueprint & 4-Stage API Checklist (`std/thread/CHECKLIST.md`)

> **Layer**: Layer 3 (Hardware atomics, 1:1 OS kernel threads, in-process OS native synchronization primitives, cross-process robust synchronization & 4-tier deadlock prevention foundation)  
> **Parent Master Blueprint**: [`../CHECKLIST.md`](../CHECKLIST.md) · **Included Modules**: `atomic.jni`, `os_thread.jni`, `sync.jni`, `os_sync.jni`  
> **Automated Audit**: `node compiler/src/jenny.ts std-check --domain thread`

---

## 1. Sub-Domain Design Intent & Boundaries (`Domain Intent & Invariants`)

`std::thread` is the **Layer 3 hardware atomic and native OS concurrency foundation** positioned directly beneath `std::fiber` (Layer 4 user-space cooperative fibers):
1. **Hardware Atomics & Cache-Line False-Sharing Prevention (`std::thread::atomic`)**: Provides `AtomicBool`, `AtomicI64`, `AtomicUsize`, `MemoryOrder` (`Relaxed`..`SeqCst`), 64/128B cache-line aligned wrapper `CachePadded<T>`, and `spin_loop_hint()`, supporting `CompletionCell` state transitions and bootstrapping `std::fiber`'s Chase-Lev work-stealing deque;
2. **1:1 OS Kernel Threads & Hardware Core Affinity (`std::thread::os_thread`)**: Provides `OsThread`, `ThreadBuilder` (supporting physical core pinning via `pin_to_core(cpu_id)` and `RealTime` scheduling priorities), `'static`-free `ScopedThreadScope` (allowing child threads to safely borrow parent stack data directly), and `ThreadLocal<T>` (with `@non_suspendable` cross-`.await` protection `E0706`);
3. **In-Process Native OS Synchronization & 4-Tier Deadlock Prevention Engine (`std::thread::sync`)**: Encapsulates `Futex` (`futex`/`WaitOnAddress`/`__ulock`), `SpinLock<T>`, `OsMutex<T>` (supporting real-time priority inheritance `PriorityInherit` and `.as_raw_os_ptr()` C FFI interop), `OsRwLock<T>`, `OsCondvar` (bound strictly to monotonic `Duration` to prevent hangs from NTP clock stepbacks), `OsOnce`, and `OsBarrier`; features built-in **`sync::lock_pair` total-address-order locking**, **`LockLevel` hierarchy contracts**, **slow-path $< 30\text{ns}$ Wait-For Graph cycle deadlock detection (`SyncError.DeadlockCycleDetected`)**, and **`@non_suspendable` compile-time interception of holding locks across `.await` (`E0705`)**;
4. **Kernel Handles & Crash-Resilient Cross-Process Synchronization (`std::thread::os_sync`)**: Encapsulates **`OsEvent`** (Linux `eventfd` / Win32 `CreateEventW` / macOS `EVFILT_USER`, which can either block an OS thread or register with the `std::fiber` Reactor for `.await` wakeups), `OsSemaphore` / `NamedSemaphore`, **`RobustNamedMutex`** (leveraging `WAIT_ABANDONED` / `PTHREAD_MUTEX_ROBUST` to automatically return `SyncError.OwnerAbandoned` for state recovery when a lock-holding process crashes, eliminating cross-process deadlocks), and `FileAdvisoryLock`.

---

## 2. Module Stage Completeness Summary (`Module Stage Summary`)

| Module ID | Blueprint File | Stage 1 (Skeleton) | Stage 2 (Core APIs) | Stage 3 (Generics/RAII) | Stage 4 (v1.0 Hardening) | Module Total Progress |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **`std::thread::atomic`** | [`atomic.jni`](./atomic.jni) | `0 / 7` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 14** (`0.0%`) |
| **`std::thread::os_thread`** | [`os_thread.jni`](./os_thread.jni) | `0 / 6` 🎯 | `0 / 4` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 13** (`0.0%`) |
| **`std::thread::sync`** | [`sync.jni`](./sync.jni) | `0 / 9` 🎯 | `0 / 5` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 17** (`0.0%`) |
| **`std::thread::os_sync`** | [`os_sync.jni`](./os_sync.jni) | `0 / 6` 🎯 | `0 / 3` ⏳ | `0 / 2` ⏳ | `0 / 1` ⏳ | **0 / 12** (`0.0%`) |
| **Sub-Domain Total** | **4 Modules** | **`0 / 28` (0%)** | **`0 / 16` (0%)** | **`0 / 8` (0%)** | **`0 / 4` (0%)** | **`0 / 56` (`0.0%`)** |

---

## 3. `std::thread::atomic` 4-Stage API Checklist (Hardware Atomics & Cache-Line Alignment — `0 / 14`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 7` Planned)
* `[ ]` `AtomicI64.new(initial: i64) -> AtomicI64` — *Contract: `ensures result.val == initial`*
* `[ ]` `AtomicI64.load(self, order: MemoryOrder) -> i64` — *Contract: `ensures result == self.val`*
* `[ ]` `AtomicI64.store(mut self, next_val: i64, order: MemoryOrder) -> void` — *`effects [Sync]`, Contract: `ensures self.val == next_val`*
* `[ ]` `AtomicI64.fetch_add(mut self, delta: i64, order: MemoryOrder) -> i64` — *`effects [Sync]`, Contract: `ensures result == old(self.val) && self.val == old(self.val) + delta`*
* `[ ]` `AtomicI64.compare_exchange(mut self, expected: i64, desired: i64, order: MemoryOrder) -> (bool, i64)` — *`effects [Sync]`*
* `[ ]` `AtomicBool.new(initial: bool) -> AtomicBool` — *Contract: `ensures result.flag == initial`*
* `[ ]` `AtomicBool.test_and_set(mut self, order: MemoryOrder) -> bool` — *`effects [Sync]`, Contract: `ensures result == old(self.flag) && self.flag == true`*

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `AtomicI64.fetch_sub(mut self, delta: i64, order: MemoryOrder) -> i64`
* `[ ]` `AtomicI64.swap(mut self, next_val: i64, order: MemoryOrder) -> i64`
* `[ ]` `AtomicBool.clear(mut self, order: MemoryOrder) -> void`
* `[ ]` `spin_loop_hint() -> void` — *CPU spin-wait backoff hint (`PAUSE` / `YIELD`)*

### ⏳ Stage 3: Generic `AtomicPtr<T>` & `CachePadded<T>` False-Sharing Isolation (`0 / 2` Planned)
* `[ ]` `CachePadded.new(val: i64) -> CachePadded` — *64B/128B cache-line aligned wrapper*
* `[ ]` `atomic_fence(order: MemoryOrder) -> void`

### ⏳ Stage 4: 128-Bit Double-Word CAS (`DWCAS`) & ABA-Resistant Tagged Pointers (`0 / 1` Planned)
* `[ ]` `TaggedAtomicPtr.cas_tagged(mut self, exp_ptr: i64, exp_tag: i64, new_ptr: i64) -> bool`

---

## 4. `std::thread::os_thread` 4-Stage API Checklist (1:1 Kernel Threads, Core Affinity & `ThreadLocal` — `0 / 13`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 6` Planned)
* `[ ]` `ThreadBuilder.new(stack_kb: i64, priority: ThreadPriority) -> ThreadBuilder ! ThreadError` — *Contract: `requires stack_kb >= 64 else ThreadError.InvalidStackSize`*
* `[ ]` `ThreadBuilder.pin_to_core(mut self, cpu_id: i64) -> ThreadBuilder ! ThreadError` — *Contract: `requires cpu_id >= 0 else ThreadError.InvalidCoreId`, `ensures result.pinned_core == cpu_id`*
* `[ ]` `ScopedThreadScope.new(max_threads: i64) -> ScopedThreadScope ! ThreadError` — *Contract: `requires max_threads > 0`, `ensures result.active_threads == 0`*
* `[ ]` `ScopedThreadScope.spawn_scoped(mut self, worker_id: i64) -> i64 ! ThreadError` — *`effects [Sync]`, Contract: `requires !self.is_joined && self.active_threads < self.max_threads`, `ensures self.active_threads == old(self.active_threads) + 1`*
* `[ ]` `ScopedThreadScope.join_all(mut self) -> i64 ! ThreadError` — *Contract: `ensures self.active_threads == 0 && self.is_joined == true`*
* `[ ]` `available_parallelism() -> i64` — *Contract: `ensures result >= 1`*

### ⏳ Stage 2: Core Production API Surface (`0 / 4` Planned)
* `[ ]` `current_os_thread_id() -> i64`
* `[ ]` `yield_os_thread() -> void`
* `[ ]` `ThreadLocalSlot.new(default_val: i64) -> ThreadLocalSlot`
* `[ ]` `ThreadLocalSlot.get_for_thread(self, tid: i64) -> i64`

### ⏳ Stage 3: `ThreadLocal<T>` Borrow Guards & Static Cross-`.await` Interception (`E0706`) (`0 / 2` Planned)
* `[ ]` `ThreadLocalSlot.set_for_thread(mut self, tid: i64, val: i64) -> void`
* `[ ]` `OsThreadHandle.join(own self) -> i64 ! ThreadError`

### ⏳ Stage 4: Real-Time Scheduling Policies (`SCHED_FIFO` / `MMCSS`) & Hardware NUMA Node Binding (`0 / 1` Planned)
* `[ ]` `ThreadBuilder.bind_numa_node(mut self, node_id: i64) -> ThreadBuilder ! ThreadError`

---

## 5. `std::thread::sync` 4-Stage API Checklist (In-Process Native OS Synchronization & 4-Tier Deadlock Prevention Engine — `0 / 17`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 9` Planned)
* `[ ]` `OsMutex.with_level(initial_val: i64, lock_level: i64) -> OsMutex ! SyncError` — *Contract: `requires lock_level > 0 else SyncError.InvalidLockLevel`, `ensures !result.is_locked && result.level == lock_level`*
* `[ ]` `OsMutex.lock_checked(mut self, caller_actor_id: i64, caller_max_held_level: i64) -> i64 ! SyncError` — *`effects [Sync]`, enforces hierarchy contract: `requires self.level > caller_max_held_level else SyncError.LockOrderViolation`, and self-reentrancy contract: `requires self.owner_id != caller_actor_id else SyncError.SelfReentrantDeadlock`*
* `[ ]` `OsMutex.unlock_checked(mut self, caller_actor_id: i64, next_val: i64) -> void ! SyncError` — *`effects [Sync]`, Contract: `requires self.is_locked && self.owner_id == caller_actor_id else SyncError.NotLockOwner`, `ensures !self.is_locked && self.protected_val == next_val`*
* `[ ]` `lock_pair_ordered(mut mtx_a: OsMutex, mut mtx_b: OsMutex, actor_id: i64) -> (i64, i64) ! SyncError` — *`effects [Sync]`, atomically locks in total lock-ID/address order, Contract: `requires mtx_a.lock_id != mtx_b.lock_id else SyncError.AliasedSameLock`, `ensures mtx_a.is_locked && mtx_b.is_locked`*
* `[ ]` `WaitForGraph.detect_cycle(actor_id: i64, target_lock_owner_id: i64, next_waiting_owner_id: i64) -> bool ! SyncError` — *Slow-path $< 30\text{ns}$ wait-chain cycle detection; immediately raises `SyncError.DeadlockCycleDetected` if a closed cycle forms*
* `[ ]` `FutexWord.new(initial: i32) -> FutexWord`
* `[ ]` `FutexWord.wait_if_equal(self, expected: i32, timeout_ms: i64) -> bool ! SyncError` — *Enforces monotonic time span: `requires timeout_ms >= 0 else SyncError.InvalidTimeout`*
* `[ ]` `FutexWord.wake_one(mut self) -> i32`
* `[ ]` `OsOnceCell.new() -> OsOnceCell` — *Contract: `ensures !result.is_initialized`*

### ⏳ Stage 2: Core Production API Surface (`0 / 5` Planned)
* `[ ]` `OsMutex.try_lock(mut self, caller_actor_id: i64) -> bool`
* `[ ]` `OsRwLock.new(initial_val: i64) -> OsRwLock`
* `[ ]` `OsRwLock.read_lock(mut self) -> i64 ! SyncError`
* `[ ]` `OsRwLock.write_lock(mut self) -> i64 ! SyncError`
* `[ ]` `OsOnceCell.get_or_init(mut self, init_val: i64) -> i64` — *Contract: `ensures self.is_initialized == true`*

### ⏳ Stage 3: `@non_suspendable` RAII Guards (`OsMutexGuard<T>`), `OsCondvar` & `OsBarrier` (`0 / 2` Planned)
* `[ ]` `OsCondvar.wait_timeout_monotonic(mut self, mut mtx: OsMutex, timeout_ms: i64) -> bool ! SyncError`
* `[ ]` `OsBarrier.new(party_count: i64) -> OsBarrier ! SyncError`

### ⏳ Stage 4: Real-Time Priority Inheritance (`PTHREAD_PRIO_INHERIT`) & C FFI `.as_raw_os_ptr()` (`0 / 1` Planned)
* `[ ]` `OsMutex.enable_priority_inherit(mut self) -> void ! SyncError`

---

## 6. `std::thread::os_sync` 4-Stage API Checklist (Kernel Event `OsEvent`, Cross-Process Semaphores & Crash-Resilient `RobustNamedMutex` — `0 / 12`)

### 🎯 Stage 1: Minimal Contract Skeleton (`0 / 6` Planned)
* `[ ]` `OsEvent.new(manual_reset: bool) -> OsEvent` — *Linux `eventfd` / Win32 `CreateEventW`, Contract: `ensures !result.is_signaled`*
* `[ ]` `OsEvent.notify_signal(mut self) -> void` — *`effects [Sync]`, wakes a blocked OS thread or triggers a bound `std::fiber` Reactor event, Contract: `ensures self.is_signaled == true`*
* `[ ]` `OsEvent.wait_timeout(mut self, timeout_ms: i64) -> bool ! SyncError` — *`effects [Sync]`, Contract: `requires timeout_ms >= 0 else SyncError.InvalidTimeout`*
* `[ ]` `RobustNamedMutex.open_or_create(shm_key: i64) -> RobustNamedMutex ! SyncError` — *Contract: `requires shm_key > 0`*
* `[ ]` `RobustNamedMutex.acquire_robust(mut self, pid: i64, prev_owner_crashed: bool) -> i64 ! SyncError` — *`effects [Sync]`, returns `SyncError.OwnerAbandoned` if `prev_owner_crashed` is true so the caller can restore shared-memory invariants*
* `[ ]` `RobustNamedMutex.mark_consistent_and_unlock(mut self, pid: i64) -> void ! SyncError` — *Contract: `ensures !self.is_abandoned && !self.is_locked`*

### ⏳ Stage 2: Core Production API Surface (`0 / 3` Planned)
* `[ ]` `OsSemaphore.new(initial_permits: i64, max_permits: i64) -> OsSemaphore ! SyncError`
* `[ ]` `OsSemaphore.acquire_timeout(mut self, timeout_ms: i64) -> bool ! SyncError`
* `[ ]` `OsSemaphore.release_one(mut self) -> i64 ! SyncError`

### ⏳ Stage 3: Zero-Copy Async Reactor Bridging Between `OsEvent` & `std::fiber::CompletionCell` (`0 / 2` Planned)
* `[ ]` `OsEvent.bind_completion_cell(mut self, cell_id: i64) -> void ! SyncError`
* `[ ]` `FileAdvisoryLock.try_lock_exclusive(fd: i64, offset: i64, len: i64) -> bool ! SyncError`

### ⏳ Stage 4: RAII Automatic Cross-Process Handle Release (`0 / 1` Planned)
* `[ ]` `RobustNamedMutex.drop(own self) -> void`
