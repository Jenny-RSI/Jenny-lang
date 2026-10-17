# Jenny Specification — Volume 04: Traits, Generics & Container Adaptation

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../../zh/design/specs/04_traits_and_generics.md)

> **Status**: Finalized (v1.0-spec)  
> **Core Philosophy**: Centered on explicitly bounded quantification and `trait` polymorphic contracts, combined with compiler-synthesized tri-state memory traits (`TrivialCopy` / `UniqueMove` / `GcTrace`) and a tri-mode generics compilation strategy—achieving **"one container implementation across dual-track memory with zero binary bloat"**.

---

## 1. The `Trait` Polymorphic Contract System

### 1.1 Trait Declarations, Default Methods & Intuitive Associated Type Projection (`T.Item`)
* **Associated Types**: Traits may declare `type Name` (optionally with trait bounds, e.g., `type Output: Serializable`).
* **Dot-Notation Type Projection (Farewell to `<T as Trait>::Item`)**: Generic signatures and function bodies access associated types uniformly via intuitive **`T.Output`** dot projection, abolishing Rust's verbose fully-qualified syntax.
* **Package-Level Coherence (Orphan Rule)**: To guarantee global type-system coherence (preventing conflicting hash table or ordering implementations across modules), `impl Trait for Type` must be defined inside either **the package defining `Trait`** or **the package defining `Type`**.

```rust
pub trait Codec {
    type Frame: Send // Associated type declaration

    fn encode(self, frame: Self.Frame) -> *Buffer ! CodecError
    fn decode(self, raw: []u8) -> Self.Frame ! CodecError

    // Default method implementation
    fn reset(mut self) {
        // default no-op
    }
}

// Generic functions access associated types directly via C.Frame!
pub fn transcode_one<C: Codec>(codec: C, input: []u8) -> *Buffer ! CodecError {
    val frame: C.Frame = codec.decode(input)?
    return codec.encode(frame)
}
```

### 1.2 Automatic Synthesis of Structural Capabilities (Zero `@derive` Boilerplate) & `@operator` Annotations
From a token economics perspective, Jenny eliminates repetitive `@derive(Eq, PartialEq, Hash, Debug, Clone)` clutter:
1. **Zero-Boilerplate Synthesis for Pure Data Types**:
   * Whenever all fields of a `struct` or `enum` support equality comparison, hashing, or debug formatting, the compiler **automatically synthesizes field-wise `==`, `!=`, `.hash()`, and `.to_debug_str()`**!
   * Only when custom comparison semantics are needed (such as ignoring a cached timestamp field) does the developer override the default synthesis by defining `@operator("==")` inside an `impl` block.
2. **`@operator("...")` Method Annotations + High-Cohesion Domain Traits**:
   * Rather than splintering `+`, `-`, `*`, `/`, and `[]` across two dozen single-method traits (like Rust's `std::ops::*`), Jenny binds predefined operators (`+`, `-`, `*`, `/`, `%`, `==`, `<=>`, `[]`, `[]=`) directly inside `impl Type` via `@operator("+")` and expresses generic constraints through cohesive domain traits (`Equatable`, `Comparable`, `Numeric`):

```rust
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
// Note: Vec3 automatically gets ==, !=, .hash(), and .to_debug_str() with zero boilerplate!

impl Vec3 {
    @operator("+")
    pub fn add(self, rhs: Vec3) -> Vec3 {
        return Vec3 { x: self.x + rhs.x, y: self.y + rhs.y, z: self.z + rhs.z }
    }

    @operator("*")
    pub fn scale(self, factor: f64) -> Vec3 {
        return Vec3 { x: self.x * factor, y: self.y * factor, z: self.z * factor }
    }
}
```

### 1.3 Zero-Boilerplate Composition: `delegate` Automatic Forwarding & Trait Mixins
To favor composition over inheritance without forcing AI agents to generate dozens of trivial forwarding methods:
1. **`delegate` Struct Field Forwarding**:
   * Structs or `impl` blocks can declare **`delegate <TraitName> to self.<field>`**.
   * The compiler automatically synthesizes zero-overhead inlined forwarding methods for the entire `Trait`; to customize specific methods (e.g., adding metrics or caching), simply write only the overridden methods inside `impl <TraitName> for OuterStruct`!
2. **High-Density Trait Default Method Mixins**:
   * Standard library traits are designed as rich mixins where implementing 1 primitive method automatically unlocks dozens of derived combinators.

```rust
pub struct InstrumentedStore {
    engine: *RocksDbEngine,
    metrics: ^MetricsCollector,

    // Forwards all 15 methods of StorageEngine to self.engine in one line, overriding only put below!
    delegate StorageEngine to self.engine
}

impl StorageEngine for InstrumentedStore {
    // Only customize the instrumented put method; the remaining 14 methods are synthesized by delegate
    pub fn put(mut self, key: str, val: []u8) -> void ! StoreError 
        effects [IO] 
    {
        self.metrics.increment("store.put")
        return self.engine.put(key, val)
    }
}
```

---

## 2. Tri-Modal Dynamic Dispatch Fat Pointers (`dyn` / `*dyn` / `^dyn Trait`)

When runtime polymorphism is needed (e.g., heterogeneous collections, plugin registries, or binary size reduction), Jenny uses the explicit `dyn Trait` keyword (distinct from static generics `<T: Trait>`), aligned with Volume 01's tri-modal memory model. Every `dyn Trait` is physically a **16-byte fat pointer `{ data_ptr: *void, vtable_ptr: *VTable }`**:

| Dynamic Polymorphic Type | Physical Ownership & Lifetime | Key Engineering Characteristics |
| :--- | :--- | :--- |
| **`dyn Trait` / `mut dyn Trait`**<br>*(Used in function parameters)* | **Stack-Bound Borrowed Fat Pointer**<br>*(No `&` sigil needed)* | **Zero-Boxing**: Thanks to default read-only parameter borrowing, whether the caller holds a stack value `v`, a native box `*v`, or a managed handle `^v`, it can be passed directly into `elem: dyn Drawable` with zero heap allocation! |
| **`*dyn Trait`** | **Native Heap Single-Owner Polymorphic Object** | The `vtable` header embeds the concrete type's `drop_and_dealloc` function pointer; when `*dyn Trait` exits scope, it dispatches through the vtable to run the concrete destructor and free native heap memory. |
| **`^dyn Trait`** | **Managed Heap Shared Polymorphic Handle** | Supports heterogeneous object graphs (such as `^Array<^dyn Widget>`), with object lifetimes tracked automatically by GC / WasmGC. |

```rust
pub trait Drawable {
    fn draw(self, mut canvas: Canvas)
}

// Parameter is written directly as elem: dyn Drawable (default read-only borrowed fat pointer):
// callers can pass a stack value, *Button, or ^Sprite with zero heap boxing!
pub fn render_element(elem: dyn Drawable, mut canvas: Canvas) {
    elem.draw(mut canvas)
}
```

---

## 3. Tri-Mode Generics Compilation Strategy

Jenny **strictly forbids C++-style unconstrained duck-typed templates**: inside a generic function, a type parameter `T` may only invoke methods guaranteed by its declared Trait Bounds (ensuring 100% static type checking at generic definition time rather than deferring errors until instantiation).

During backend code generation, Jenny employs a **Tri-Mode On-Demand Compilation Strategy** that eliminates Rust's debug-build monomorphization bloat while preserving peak `--release` throughput and ultra-compact Wasm binaries:

1. **Polymorphic Pointer Erasure (Permanently Enabled for `^T` Across All Modes)**:
   * Because every `^User` and `^Order` shares the exact same physical managed handle width and GC write-barrier semantics, both Debug and Release backends automatically share a single underlying `Array<^GcObject>` machine-code template across `Array<^User>`, `Array<^Order>`, etc.—achieving **100% static type safety with 0% binary code bloat**!
2. **Dictionary Passing (Default in Debug / AI Verification Builds & Explicit via `@dynamic`)**:
   * **Default for Debug & AI Self-Healing Loops**: During `jenny check`, `jenny weave`, and `--debug` builds, value-type generics default to dictionary passing (implicitly passing vtable witness tables and type size descriptors, akin to Swift Witness Tables). Each generic function is compiled **only once globally**, eliminating 80% of intermediate IR and debug symbol bloat!
   * **Explicit `@dynamic` in Production**: Generic functions annotated with `@dynamic` (or compiled under `-Oz` Wasm size optimization) retain single-copy machine code output even in Release builds.
3. **Static Monomorphization (Automatically Enabled in `--release` for Value Types and `*T`)**:
   * Under `--release` builds, unannotated generic instantiations over value types and `*T` (such as `Array<i32>` or `Array<Vec3>`) are statically monomorphized and inlined, unlocking full LLVM SIMD auto-vectorization.

---

## 4. Compiler-Synthesized Intrinsic Traits & Dual-Track Containers (`Array<T>` / `Map<K, V>`)

To prevent the standard library from fracturing into separate "Native Containers" and "GC Containers", the type checker automatically synthesizes three orthogonal intrinsic traits for every type `T`:

* **`TrivialCopy`**: Pure value types containing no `*U`, `^U`, or custom `drop` (such as scalars, `Vec3`, or SSO `String`). Supports bulk `memcpy` and requires no element-wise destruction when the container is freed.
* **`UniqueMove`**: Types that are `*U` or contain `*U` / custom `drop` with single-owner semantics. Container destruction automatically iterates over elements to invoke `drop(own elem)`.
* **`GcTrace`**: Types that are `^U` or contain `^U`. The container's backing buffer registers a GC pointer bitmap and triggers write barriers on element mutation.

### Orthogonal Container Adaptation Matrix
A single `Array<T>` definition automatically adapts into four specialized memory topologies based on the orthogonal combination of outer container prefix and inner element type `T`:

| Container Instance Type | Control Block & Backing Buffer Location | Inner Element `T` Management Strategy |
| :--- | :--- | :--- |
| **`*Array<Vec3>`** | Native Heap (or `*in(arena)`) | Contiguous raw byte buffer; grows via `realloc` and frees in a single `free` call (`@spin if T is UniqueMove` cleanup loop is statically pruned at compile time). |
| **`*Array<*AudioChunk>`** | Native Heap | Single-owner container holding single-owner elements; dropping `*Array` iterates and drops every owned `*AudioChunk`. |
| **`^Array<^User>`** | Managed Heap / WasmGC `arrayref` | Fully managed domain list; leverages polymorphic pointer erasure and automatic GC tracing. |
| **`^Array<*RawFrame>`** | Managed Heap holding Native elements | When the outer `^Array` is reclaimed by the GC, its finalizer automatically iterates and invokes `drop` on every internal `*RawFrame` to free C heap memory. |
