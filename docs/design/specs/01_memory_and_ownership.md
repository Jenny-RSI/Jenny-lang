# Jenny Specification — Volume 01: AI-Native Dual-Track Memory & Parameter Passing Modes

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../../zh/design/specs/01_memory_and_ownership.md)

> **Status**: Finalized (v2.0 — AI-Native Evolution Edition)  
> **Core Breakthrough**: Completely discards the legacy baggage of traditional languages (C++/Rust) that conflate *physical storage location* with *parameter passing mode* (**abolishing `&T`, `&mut T`, `&*T`, and `&^T` nested reference sigils**). Establishes an orthogonal architecture of **"Dual-Track Storage Topology (`T` / `*T` / `^T`) $\times$ Tri-Modal Parameter Passing Intent (Read-Only Borrow by Default / `mut` In-Place Mutation / `own` Ownership Transfer)"**, enabling AI code generation with **zero borrow/move hallucination errors** and making `.jni` blueprints immediately transparent to human readers.

---

## 1. Why Must Traditional Memory Models Be Reconstructed from an AI Perspective?

In traditional hand-written systems languages like Rust, memory control relies on `&T` / `&mut T` borrow pointer types combined with "move-by-default parameter passing" (where passing a value implicitly invalidates the caller's variable). Viewed from the perspective of **autoregressive LLM token generation and human `.jni` blueprint auditing**, this legacy model suffers from three fatal flaws:

1. **Implicit Moves Are the #1 Source of LLM Compilation Failures**: LLMs generate code top-to-bottom line by line. If an LLM passes `buf` by value to a read-only helper `check(buf)` on line 10—triggering an implicit move—any subsequent access to `buf` on line 25 crashes compilation with `Use of moved value`.
2. **Compounding Storage and Borrow Sigils Creates Visual Noise**: Combining dual-track heap pointers (`*T`, `^T`) with borrow sigils (`&`, `&mut`) produces unreadable sigil soup like `&*AudioChunk` and `&mut ^TrackNode`.
3. **Redundant Manual `view struct` Annotations**: Whether a struct contains a slice view (`[]T` or `str`) is 100% statically knowable the instant the compiler parses its fields; forcing humans or AI agents to annotate an extra keyword adds unnecessary friction.

To solve this, Jenny v2.0 decouples the memory model into two orthogonal dimensions: **[Dimension 1: Data Storage Topology (Where the Object Lives)]** and **[Dimension 2: Parameter Passing Intent (How a Function Treats Its Input)]**.

---

## 2. Dimension 1: Tri-State Data Storage Topology (`T` vs. `*T` vs. `^T`)

When defining struct fields, local variables, and return types, there are only three clean data storage forms (**the `&T` reference type does not exist in Jenny**):

| Storage Syntax | Canonical Name | Physical Memory Region | Ownership & Assignment Semantics | Primary Use Cases |
| :--- | :--- | :--- | :--- | :--- |
| **`T`** | **Inline Value / View** | Call stack (Stack) or inlined directly inside a parent container | Pure value types copy bitwise (`TrivialCopy`); structs containing `*U` fields inherit single-owner move semantics (`UniqueMove`) | Primitives, small vectors (`Vec3`), immutable SSO `String`, slice views (`[]T` / `str`) |
| **`*T`** | **Native Box Pointer** | **Native Heap** (global `mimalloc`, custom `*in(arena)`, or Wasm Linear Memory) | **Single-Owner**. Automatically invokes `drop(own self)` and frees memory deterministically upon exiting lexical scope | Zero-copy C struct mapping, audio/video/GPU buffers, hard real-time zero-GC hot paths |
| **`^T`** | **Managed Shared Handle** | **Managed Heap** (pluggable concurrent Immix GC / optimized ARC, or WasmGC `structref`) | **Multi-Owner Shared Aliasing**. Assignment and parameter passing copy only a lightweight handle; naturally supports cyclic graphs | Complex domain graphs/trees, UI state trees, shared closure environments |

---

## 3. Dimension 2: Tri-Modal Parameter Passing Intent (Parameter Passing Modes)

Jenny **completely abolishes `&T` and `&mut T` reference type sigils**. In function and method signatures, parameter prefix modifiers directly declare **how the callee accesses and affects ownership of the argument** (building on theoretical advances from Val/Hylo and Swift value semantics):

| Parameter Syntax | Passing Mode Name | Semantic Contract & Lowering | Call-Site Syntax & AI Ergonomics |
| :--- | :--- | :--- | :--- |
| **`x: T`**<br>*(Default, no modifier)* | **Read-Only Borrow Mode**<br>(`in` mode) | **The default behavior for 90% of parameters!** The function only reads `x`, never mutates it, and **never consumes its ownership**.<br>• Lowering: Scalars pass in registers; large structs, `*T`, and `^T` are automatically passed by read-only address (zero-copy, auto-adapting across `T`/`*T`/`^T`). | Write `foo(x)` directly.<br>🌟 **Zero AI Move Errors**: After calling any default-parameter function, the caller's variable `x` **remains 100% valid**, and `*T`, `^T`, and `T` automatically deref-adapt to match `x: T`! |
| **`mut x: T`**<br>*(or `mut self`)* | **In-Place Mutation Mode**<br>(`inout` mode) | The function mutates the contents of `x` in place, while ownership remains with the caller after the call returns.<br>• Lowering: Passes a mutable borrow pointer and locks local exclusivity for the duration of the call (preventing container reallocation dangling pointers). | Caller passes a mutable binding (e.g., `arr.push(...)` or `fill(mut buf)`), making mutation intent explicit in the signature. |
| **`own x: T`**<br>*(or `own self`)* | **Ownership Transfer Mode**<br>(`sink` mode) | The function formally **takes over (consumes)** ownership of `x` (e.g., storing it into a container, sending it across threads to another `Fiber`, or destroying it in `drop(own self)`). | **Call sites must explicitly write `own x`** (e.g., `list.push(own chunk)`)!<br>🌟 **Eliminates Implicit Move Traps**: A variable is invalidated *only* where `own` is explicitly written—letting humans and AI trace ownership flow at a glance! |

### Side-by-Side Comparison: Eliminating `&`, `&mut`, `&*`, and `&^`

```rust
// ❌ Legacy Rust-hybrid style: cluttered with &self, &mut self, &*PcmFrame, and &^TrackNode sigil noise
// pub fn process(node: &^TrackNode, frame: &*PcmFrame, out: &mut Buffer) -> usize

// ✅ Jenny v2.0 (AI-Native Parameter Modes): Zero & sigils! Self-explanatory intent!
pub struct TrackNode {
    pub title: String,
    pub frame: *PcmFrame,     // Exclusively owns a native audio frame
    pub next: ^TrackNode?,    // Shared handle to the next managed graph node
}

// 1. Default read-only borrow: node and frame are read-only borrows, do not transfer ownership,
//    and automatically deref-adapt * and ^!
pub fn inspect_node(node: TrackNode, frame: PcmFrame) -> usize 
    effects [] 
{
    return frame.length
}

// 2. mut in-place mutation and own explicit ownership transfer:
impl<T> Array<T> {
    // mut self mutates the array in place; own item formally transfers ownership of item into the array!
    pub fn push(mut self, own item: T) {
        if self.len == self.cap { self.grow() }
        self.buf.write_at(self.len, own item)
        self.len += 1
    }

    // self defaults to read-only borrow
    pub fn len(self) -> usize {
        return self.len
    }

    // own self consumes and destroys this instance
    fn drop(own self) {
        @spin if T is UniqueMove {
            for i in 0..self.len {
                drop(own self.buf.read_and_take(i))
            }
        }
        self.buf.dealloc()
    }
}
```

---

## 4. Slice Views (`[]T` / `str`) & Automatic Stack-Bound Inference (`Auto-View Inference`)

### 4.1 Farewell to Manual `view struct` and `'a` Lifetime Annotations
In early drafts, allowing a struct to hold a slice `[]T` or `str` (for zero-copy parsing) required declaring `view struct`.
From an AI-native perspective, **this distinction is now 100% inferred automatically by the compiler**:
1. **Automatic Stack-Bound View Inference**:
   * Users declare standard structs: `pub struct HttpHeader { pub name: str, pub value: str }`.
   * Upon detecting `str` or `[]T` (borrowed slices) among a struct's fields, the compiler automatically marks the struct in the type table as a **Stack-Bound View**.
2. **Safety Boundaries & Lifetime-Elision Intersection Rule**:
   * Any struct containing a slice is statically forbidden from being boxed onto the heap as `*HttpHeader` or `^HttpHeader` (preventing dangling pointers from escaping to the heap).
   * When a function returns a slice or a slice-bearing struct (e.g., `fn parse_kv(line: str) -> KvPair?`), the compiler automatically binds the return value's lifetime to the **intersection of the input read-only borrow parameters' lifetimes**—achieving 100% memory safety while completely eliminating `<'a>` syntax and the `view` keyword.

### 4.2 Zero-Cost Inlined Generators (`iter fn` & `yield`)
Container iteration and streaming pipelines use `iter fn` + `yield`, which are 100% inlined into flat loops via Stream Fusion during the MIR phase:

```rust
impl<T> Array<T> {
    // self defaults to read-only borrow; yielded elements are accessed as read-only borrow views in the loop body
    pub iter fn iter(self) -> T {
        for i in 0..self.len {
            yield self.buf.ref_at(i)
        }
    }
}
```

---

## 5. Local Borrow Safety, Cross-Heap References & `@scoped` Linear Resources

### 5.1 Local Mutation Exclusivity Protection (Preventing Container Reallocation Dangling)
* During a `mut x` in-place mutation call, the compiler statically verifies within the current stack frame that no active slice or iterator view points into `x`'s contiguous backing buffer (whether `x` is a stack value, `*Array`, or `^Array`), eliminating Use-After-Free bugs caused by pushing to a container while iterating over it.
* Meanwhile, ordinary field reads and writes across multiple `^T` managed handles permit free aliasing just like Go or C#.

### 5.2 Native Heap Arena Region Allocation (`*in(arena)`)
```rust
var arena = Arena::with_capacity(64 * 1024)
val packet = *in(arena) PacketHeader { magic: 0x4A4E, payload_len: 128 }
// Reclaimed in O(1) bulk when arena exits scope; compiler forbids *in(arena) pointers from escaping the scope
```

### 5.3 Cross-Heap References & `@scoped` Linear Scope Resources
1. **Automatic Cross-Heap Reference Maintenance**: When `^A` holds `*B`, the GC finalizer automatically cascades to trigger `*B.drop()`. When `*A` holds `^B`, the compiler automatically registers the slot in an inlined **Cross-Heap Root Table** (mapped to a `table<anyref>` slot index under WebAssembly) so the GC traces `^B`.
2. **`@scoped` Linear System Resources**: Types annotated with `@scoped` (such as `File`, `Socket`, or `MutexGuard`) are statically forbidden from being stored on the `^T` managed heap, guaranteeing deterministic release of OS handles the instant their stack scope or owning `*T` is destroyed.
