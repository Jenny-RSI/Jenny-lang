# Jenny Language Specification — Module 09: Literate Architectural Blueprints (`.jni`) and First-Class Contract System

> **Language**: English | [中文版 (Chinese)](../../zh/design/specs/09_literate_blueprint_and_contracts.md)  
> **Status**: Finalized (v2.0-spec)  
> **Core Theme**: Crown "native Markdown documentation" as a first-class citizen! Humans only read and write beautifully formatted `<module>.jni` literate architectural blueprints (where formal interfaces and contract blocks fold into status capsules by default in the IDE), while AI automatically generates and maintains `<module>.jn` implementation code behind the scenes, and the compiler enforces zero-trust automated acceptance via formal contracts (`requires` / `ensures` / `invariant` / `@example`).

---

## 1. `.jni` Literate Architectural Blueprint Specification

### 1.1 Separating Top-Level Markdown Prose from ```` ```jenny ```` Contract Blocks
* **Top-Level Syntax Is Standard Markdown**:
  * The `.jni` top-level parser directly ignores all regions outside fenced code blocks, allowing human architects to freely use Markdown headings, paragraphs, tables, Mermaid diagrams, and LaTeX formulas to articulate domain context and design intent (**completely abolishing `///` doc-comment syntax**).
  * The compiler imposes zero syntactic restrictions on Markdown prose, keeping the human authoring experience effortless.
* **Formal Contract Blocks (```` ```jenny ... ``` ````)**:
  * The compiler frontend extracts only fenced code blocks tagged as `jenny` inside a `.jni` file, concatenating them in top-to-bottom order to form the module's **Formal Blueprint AST**.
  * **Default IDE Folded Capsules**: In editors supporting the Jenny LSP, ```` ```jenny ```` blocks inside `.jni` files fold by default into single-line visual status badges:
    `▶ [✓ Contracts Verified | effects [IO] | (path: str) -> *Image ! IoError | 4/4 Examples Passed]`

### 1.2 Bidirectional Isomorphic Binding Between `.jni` and `.jn`
Every module consists of a paired `<module>.jni` (blueprint) and `<module>.jn` (implementation) sharing the same base name:
1. **Single Source of Truth for Public Contracts**: All `pub` and `pkg` `struct`, `enum`, `trait`, and function signatures must be declared inside ```` ```jenny ```` blocks in `.jni`.
2. **Pure Implementation Role of `.jn`**:
   * `<module>.jn` contains only the concrete function bodies for functions declared in `.jni`, along with module-private helper functions and internal data structures.
   * **Zero-Redundancy Contract Weaving & Strict Signature Verification**: When implementing a `.jni`-declared function in `.jn`, the compiler enforces 100% agreement across parameter modes, return types, and `effects`; `requires`, `ensures`, and `invariant` clauses declared in `.jni` do not need to be repeated in `.jn`—the compiler **automatically weaves them into** function entry and exit points during mid-level IR (MIR) lowering!

---

## 2. First-Class Formal Contract Syntax

So that humans can retain 100% control over program behavior without ever opening `.jn` implementation files, Jenny builds four formal contract primitives directly into `.jni` function and type declarations:

### 2.1 Precondition Contract: `requires <cond> [else <error_expr>]`
* **Semantics**: Declares the boolean assertion that arguments must satisfy when the function is called.
* **Automatic Error Mapping (Zero Hand-Written Parameter Checks)**:
  * When a function's return type is `T ! E`, it supports writing `requires cond else ErrorVariant`.
  * **Automatic Compiler Code Generation**: The compiler automatically injects `if !(cond) { raise ErrorVariant }` at the entry of the `.jn` function body! When generating `.jn`, the AI never needs to write repetitive defensive parameter validation boilerplate and can focus immediately on core algorithmic logic.

### 2.2 Postcondition Guarantee Contract: `ensures <cond>`
* **Semantics**: Declares the promise that the return value and object state must satisfy when the function returns normally (without triggering `raise`).
* **Dedicated Built-in Identifiers**:
  * **`result`**: Refers to the function's successful return value (e.g., `ensures result >= 0.0 && result <= 1.0`).
  * **`old(expr)`**: Refers to the pre-state snapshot value of an expression or field upon function entry (used in `mut self` or `mut x: T` methods, e.g., `ensures self.len == old(self.len) + 1`).

### 2.3 Data Structure Invariant: `invariant <cond>`
* **Semantics**: Declared inside a `struct` definition, specifying a state constraint that must hold upon construction completion and both before and after every public method (`pub fn`) call on that type (e.g., `invariant self.len <= self.cap`).

### 2.4 Inline Golden Acceptance Examples: `@example <expr> == <expected>`
* **Semantics**: Input-output contract anchors attached directly beneath a function or `impl` declaration.
* **Immediate Compile-Time Meta-VM Execution**:
  * For functions without external `IO` side effects (or functions operating on compile-time mock data), immediately after compiling `.jn`, the compiler **executes all `@example` assertions inside its built-in deterministic sandbox virtual machine (Meta-VM)**!
  * If any `@example` evaluation disagrees with the expected value (or raises an unexpected error), **compilation fails immediately**, and the diff between actual and expected output is fed back via `--ai-json` to force the AI Coding Agent to repair `.jn`!

---

## 3. The "Three-Stage Progressive Weaving" Human-AI Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 1: Human architect writes design intent in native Markdown (.jni)  │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ Run `jenny spec`
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 2: AI reads Markdown and generates foldable ```jenny contract      │
│         blocks (*T/^T topology, effects, requires/ensures, @example)    │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ Run `jenny weave`
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Step 3: AI generates <module>.jn behind the scenes; compiler enforces   │
│         zero-trust contract verification:                               │
│         • Statically verifies signatures, dual-track memory & effects   │
│         • Automatically weaves requires / ensures / invariant guards    │
│         • Executes all @example blocks in Meta-VM, rejecting failures   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Complete End-to-End Example: `ring_buffer.jni` and Behind-the-Scenes `ring_buffer.jn`

### 4.1 The Human-Authored Blueprint File: `ring_buffer.jni`
````markdown
# Zero-Copy Fixed-Capacity Ring Buffer (`ring_buffer`)

This module provides a native-heap ring buffer for hard real-time audio and network pipelines.
- **Memory Policy**: Allocated on the Native Heap (`*RingBuffer<T>`), supporting `*in(arena)` with **100% zero GC involvement**.
- **Capacity Rules**: Initial `capacity` must be greater than 0; pushing to a full buffer returns `BufferFull` without implicit reallocation.

```jenny
blueprint ring_buffer

pub enum RingError {
    InvalidCapacity,
    BufferFull,
}

pub struct RingBuffer<T: TrivialCopy> {
    buf: *mut c_raw<T>,
    cap: usize,
    len: usize = 0,
    head: usize = 0,
    tail: usize = 0,

    invariant self.cap > 0
    invariant self.len <= self.cap
    invariant self.head < self.cap && self.tail < self.cap
}
```

## Construction and Read/Write Operations

1. **`with_capacity`**: Allocates a native ring buffer with the specified element capacity; rejects `cap == 0` with `InvalidCapacity`.
2. **`push`**: Appends an element to the tail, strictly incrementing length by 1 on success; raises `BufferFull` if full.
3. **`pop`**: Pops the oldest element from the head; returns `null` if the buffer is empty.

```jenny
impl<T: TrivialCopy> RingBuffer<T> {
    pub fn with_capacity(cap: usize) -> *RingBuffer<T> ! RingError
        effects []
        requires cap > 0 else RingError.InvalidCapacity
        ensures  result.cap == cap && result.len == 0

    pub fn push(mut self, item: T) -> void ! RingError
        effects []
        requires self.len < self.cap else RingError.BufferFull
        ensures  self.len == old(self.len) + 1

    pub fn pop(mut self) -> T?
        effects []
        ensures  if old(self.len) == 0 { result == null } else { self.len == old(self.len) - 1 }

    @example {
        var rb = RingBuffer::<i32>::with_capacity(2)?
        rb.push(10)?
        rb.push(20)?
        assert(rb.push(30) == RingError.BufferFull)
        assert(rb.pop() == 10 && rb.pop() == 20 && rb.pop() == null)
    }
}
```
````

### 4.2 The AI-Generated Implementation File: `ring_buffer.jn` (Humans Rarely Need to Open)
```jenny
module ring_buffer

// Note: `requires` parameter checks, `ensures` postcondition assertions, and `invariant` guards
// are automatically woven by the compiler from `.jni`!
// AI-generated `.jn` code only needs to focus on pure core state transitions:
impl<T: TrivialCopy> RingBuffer<T> {
    pub fn with_capacity(cap: usize) -> *RingBuffer<T> ! RingError {
        val raw = mem::alloc_array::<T>(cap)
        return *RingBuffer<T> {
            buf: raw,
            cap: cap,
        }
    }

    pub fn push(mut self, item: T) -> void ! RingError {
        mem::write_at(self.buf, self.tail, item)
        self.tail = (self.tail + 1) % self.cap
        self.len += 1
    }

    pub fn pop(mut self) -> T? {
        guard self.len > 0 else {
            return null
        }
        val item = mem::read_at(self.buf, self.head)
        self.head = (self.head + 1) % self.cap
        self.len -= 1
        return item
    }

    fn drop(own self) {
        mem::free_array(self.buf, self.cap)
    }
}
```
