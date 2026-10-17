# Language Naming & Branding: Spinning Jenny (`Jenny`)

> 🌐 **Language**: English | [中文原文 (Chinese Original)](../zh/design/命名.md)

**Spinning Jenny (shortened to `Jenny`)**

### I. Why "Jenny" Resonates with the Soul of This Language

> 1. **The Historical Metaphor: From "Single-Spindle Handcraft" to "Multi-Spindle Co-Weaving"**  
   * Before James Hargreaves invented the Spinning Jenny in 1764, a spinner could only turn a single spindle to spin one thread at a time—much like how programmers today manually type out C++ or Rust lifetimes and templates line by line.  
   * For the first time in history, the Spinning Jenny enabled **a single pair of human hands to drive multiple spindles simultaneously**, inaugurating the First Industrial Revolution.  
   * At the dawn of today's **AI Industrial Revolution**, the **Jenny programming language** is born for "Human + AI Collaborative Weaving": the human architect steers the master wheel of architecture and intent, while AI agents and the `@spin` metaprogramming engine simultaneously drive multiple code-generation spindles, propelling software engineering productivity into a new era.  
> 2. **Two-Ply Twisting: The Imagery of `*T` and `^T`**  
   * The core craft of spinning is twisting fibers with distinct physical properties into a single yarn that is both supple and high-tensile.  
   * In **Jenny**, **`*T` (Native Heap Pointer)** serves as the rigid, high-tensile **linen warp**, providing a zero-overhead, deterministic backbone straight to C and bare-metal hardware; **`^T` (Managed Shared Handle)** serves as the light, flexible **cotton/wool weft**, offering effortless elasticity for high-level domain graphs. Both are twisted into a unified type system within the Jenny compiler.  
> 3. **Approachability in the AI Era**  
   * When a developer tells an AI coding agent, *"Write this module in Jenny,"* or types `jenny run` in the terminal, it no longer feels like invoking a cold acronym (such as GCC, LLVM, or Rust), but rather collaborating with a rigorous, intelligent engineering partner.

---

### II. The Jenny Toolchain & Ecosystem Nomenclature

Centered around the **Spinning Jenny** motif of textiles and the Industrial Revolution, the entire compiler, package manager, metaprogramming system, and concurrency primitives share a cohesive and evocative vocabulary:

| Core Component / Concept | Name | Inspiration & Engineering Semantics |
| :---- | :---- | :---- |
| **Full / Short Language Name** | **Spinning Jenny** / **Jenny** | A tribute to the catalyst of the Industrial Revolution, ushering in the era of AI-native collaborative programming |
| **Source File Extensions** | **`.jni`** (Blueprint) & **`.jn`** (Impl) | `main.jn` (minimalist and ergonomic on the keyboard) and `module.jni` (Literate Blueprint interface) |
| **Compiler Binary** | **`jenny`** (or **`jennyc`**) | `jenny build`, `jenny run`, `jenny spin --inspect` |
| **Package Manager & Build Tool** | **`spindle`** | `spindle add http`, `spindle publish`. Every third-party package or C binding is a high-speed rotating spindle |
| **Compile-Time Metaprogramming** | **`@spin`** | **"Spinning" is code generation!** `@spin fn` and `@spin dsl` weave procedural logic and `quote` templates into target code |
| **Materialized Metaprogramming Dir** | **`.spun/`** | Stores formatted, human-readable code generated at compile time (e.g., `.spun/network.spun.jn`) for inspection and breakpoint debugging |
| **Lightweight Coroutine** | **`Fiber`** | Computer science already calls lightweight user-space threads "Fibers"—naturally uniting systems terminology with the textile motif |
| **Package Manifest** | **`Tapestry.toml`** or **`Jenny.toml`** | Symbolizes the grand tapestry (project) woven from countless individual threads |

---

### III. When Coding Becomes "Spinning": A Visual Preview of Jenny in Action

Here is how this nomenclature comes together across the command line and source code:

#### 1. Command-Line Experience

```bash
# Initialize a new Jenny project
$ jenny new quantum_engine
# Add a C library or community package via spindle
$ spindle add c:ffmpeg
$ spindle add std/async
# Execute compile-time "spinning" (@spin DSL) and inspect the white-box generated code
$ jenny spin --inspect
✓ Spun 3 meta-templates into .spun/ directory (0 warnings)

# Compile to WebAssembly (WasmGC + Linear Memory dual-track mode)
$ jenny build --target wasm32 -O3
```

#### 2. `main.jn` Source Aesthetics (Jenny v2.0 Syntax)

```rust
module audio_weaver

import c "samplerate.h" as libsr

// Define a compile-time code spindle using @spin.
// Generated code is automatically materialized into .spun/audio_weaver.spun.jn for debugging.
@spin fn derive_buffer_guard(target: MetaType) -> CodeFragment {
    return quote {
        impl $(target.ident()) {
            pub fn is_valid(self) -> bool {
                return self.raw_pcm != null && self.frames > 0
            }
        }
    }
}

// *AudioChunk is allocated on the Native Heap for zero-copy sharing with C
@repr(C)
@apply(derive_buffer_guard)
pub struct AudioChunk {
    pub raw_pcm: *f32,
    pub frames: usize,

    fn drop(own self) {
        free(self.raw_pcm)
    }
}

// ^TrackNode is allocated on the Managed Heap to effortlessly build complex audio graphs
pub struct TrackNode {
    pub name: String,
    pub chunk: *AudioChunk,        // Cross-heap ownership of a native audio frame
    pub next_nodes: []^TrackNode,  // Managed reference graph
}

pub fn process_stream(node: TrackNode) -> usize ! AudioError {
    if !node.chunk.is_valid() {
        raise AudioError.EmptyBuffer
    }
    return node.chunk.frames
}
```

---

### IV. Brand Slogan

**Jenny (Spinning Jenny)**  
*“1764, the Spinning Jenny wove the Industrial Revolution. Today, Jenny weaves Human Intent and AI Intelligence into Native & WebAssembly code.”*
