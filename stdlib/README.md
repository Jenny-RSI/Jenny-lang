# Jenny Standard Library (`stdlib/` & `std/`)

This directory hosts the Literate Contract Blueprints (`.jni`) and implementations (`.jn`) of the **Spinning Jenny Standard Library**, which is the primary real-world engineering target of **[`v0.2 (Jenny-Std)`](../docs/roadmap/roadmap_v0.2.md)** (benchmarked directly against Rust's `core`, `alloc`, and `std`):

* **`std::mem` & `std::slice`**: `RawBuf` / `ByteBuf` (`*T` dynamic buffers), `Arena` (`*in(arena) T` region pools), and `GcPool` (`^T` 64KB Immix block collector).
* **`std::collections`**: Dual-track generic containers including `Vec<T>`, `VecDeque<T>`, `HashMap<K, V>` (Robin Hood open addressing), `LruCache<K, V>` (`^T` doubly-linked list + hash map with zero `unsafe`), and `BTreeMap<K, V>`.
* **`std::str` & `std::fmt`**: Auto-inferred zero-copy stack view `StrView`, dynamic `*StringBuf`, and string formatting primitives.
* **`std::io` & `std::path`**: Streaming `Cursor`, `BufReader`, `BufWriter` (via `delegate`), and cross-platform `PathView` / `PathBuf`.
* **`std::fiber` & `std::sync`**: Structured concurrency (`FiberScope`, `fiber::all`, `fiber::race`) and bounded channels (`MpscRing`).
