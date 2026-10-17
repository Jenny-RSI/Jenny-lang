# Jenny Language Specification — Module 06: `@spin` Compile-Time White-Box Metaprogramming

> **Language**: English | [中文版 (Chinese)](../../zh/design/specs/06_spin_metaprogramming.md)  
> **Status**: Finalized (v2.0-spec)  
> **Core Theme**: "Spinning" as Code Generation — Unifying procedural control flow with declarative AST quasiquotation (`quote`). All compile-time capabilities across the language are 100% consolidated under `@spin`, and all generated code is materialized in a white-box manner into the `.spun/` directory, supporting direct Go-to-Definition and single-step breakpoint debugging.

---

## 1. The `@spin` Unified Syntax Triad

Following the principle of orthogonal minimalism, Jenny completely eliminates C-style preprocessors (`#ifdef`), Rust-style declarative macros (`macro_rules!`), and external procedural macro crates, unifying all compile-time evaluation, type derivation, and conditional compilation under the **`@spin`** keyword:

| Syntax Form | Target Scenario | Compiler Execution Stage & Behavior |
| :--- | :--- | :--- |
| **`@spin fn` + `@apply(...)`** | **Type/Function-Level Derivation & Parameterized Configuration Spinning** (e.g., `@apply(crud_repo(table: "users", cache: true))`) | Executed in Stage 2 (Meta-VM); receives the read-only reflection descriptor `MetaType` of the target type and structured configuration arguments, formatting and writing the generated `CodeFragment` to `.spun/<module>.spun.jn` |
| **`@spin <dsl_name>(...) { ... }`** | **Block-Level Declarative Domain DSLs** (e.g., finite state machines (FSM), HTTP routing tables, dataflow topologies, UI trees) | Passes the declarative domain AST inside the braces to the corresponding `@spin fn` for parsing, spinning out an entire suite of business structs, state transition functions, and boilerplate implementations in a single pass (achieving 10x–50x Token compression) |
| **`@spin <expr>`** | **Inline Compile-Time Evaluation** (e.g., building lookup tables at compile time, precompiling regex state machines, statically validating SQL strings) | Evaluates the expression directly inside the compile-time Meta-VM, folding the result into static read-only data segment (`.rodata`) constants or inline AST nodes |
| **`@spin if <cond> { ... }`** | **Static Generic Trait Pruning & Cross-Platform Conditional Compilation** (replacing legacy `#if`) | Statically evaluates the boolean condition during generic instantiation or target platform resolution (e.g., `T is UniqueMove` or `platform.target == "wasm32"`); untaken branches are completely erased at compile time |

---

## 2. The Additive-Only Principle

To guarantee **"What You See Is What You Get (Source Code as 100% Physical Truth)"** when humans and AI read source files, Jenny enforces a strict **Additive-Only Constraint** on `@apply` derivation metaprogramming:

1. **Mutating Original Definitions is Strictly Forbidden**: The `target: MetaType` received by an `@spin fn` is strictly **read-only**. No `@apply(...)` is ever permitted to **silently add, remove, rename, or alter existing fields, memory layouts, or function signatures of the original `struct` or `fn`**.
2. **Only Appending and Static Auditing are Permitted**:
   * It may append new `impl` method blocks to the target type, implement traits (such as `impl Equatable for User`), or generate companion helper structs (such as `UserRepository` or `UserBuilder`).
   * It may enforce custom compile-time architectural audits via `@spin.error(msg, span)` and `@spin.warn(msg, span)` (for instance, intercepting accidental use of a managed `^T` handle inside a `@repr(C)` struct).

---

## 3. Reflection API, `quote` Templates, and the Spindle Pattern Library

### 3.1 Core Compile-Time Reflection Types (`std::spin`)
Inside an `@spin fn`, developers can use the exact same `for`, `while`, `if`, and `match` constructs as in everyday application code to inspect built-in reflection objects:
* **`MetaType`**: Provides introspection methods including `.ident()` (type identifier), `.fields() -> []MetaField`, `.variants() -> []MetaVariant`, `.attributes() -> []MetaAttr`, `.is_native_ptr()`, `.is_gc_handle()`, and `.is_trivial_copy()`.
* **`MetaField`**: Provides `.ident()`, `.type_info() -> MetaType`, `.default_expr()`, `.has_attr(name: str)`, and the exact source location `.span`.
* **`MetaAstBlock`**: Used to parse structured custom DSL syntax blocks passed into `@spin dsl_name { ... }`.
* **`CodeFragment` & `CodeList`**: Type-safe containers for AST code fragments.

### 3.2 `quote { ... }` and `$(...)` Interpolation Rules
* **Single-Node Interpolation `$(expr)`**: Injects an `Ident`, numeric/string literal, `MetaType`, or child `CodeFragment` into the AST template.
* **List Splicing Interpolation `$(...list)`**: Seamlessly expands multiple code fragments from a `CodeList` as statement lines or parameter lists.
* **Lexical Hygiene**: Local temporary variables defined inside a `quote` block (such as `val _tmp = ...`) are automatically given unique hygienic prefixes so they never pollute or shadow variables in the host scope; meanwhile, explicitly declared `pub fn` items or spliced identifiers like `$(f.ident() + "_Changed")` remain visible as intended.

```jenny
module models

// 1. Define a compile-time code spindle (@spin fn)
@spin fn derive_binary_codec(target: MetaType) -> CodeFragment {
    var encode_stmts = CodeList::new()
    var decode_fields = CodeList::new()

    for f in target.fields() {
        // Compile-time architectural safeguard: reject managed handles in raw binary protocols
        if f.type_info().is_gc_handle() {
            @spin.error("Binary protocol structs cannot contain ^T managed handles; use value types or *T instead", f.span)
        }

        encode_stmts.push(quote {
            writer.write_field(self.$(f.ident()))?
        })
        decode_fields.push(quote {
            $(f.ident()): reader.read_field::<$(f.type_info())>()?,
        })
    }

    return quote {
        impl BinaryCodec for $(target.ident()) {
            pub fn encode(self, mut writer: ByteWriter) -> void ! IoError 
                effects [IO] 
            {
                $(...encode_stmts)
            }

            pub fn decode(mut reader: ByteReader) -> $(target.ident()) ! IoError 
                effects [IO] 
            {
                return $(target.ident()) {
                    $(...decode_fields)
                }
            }
        }
    }
}

// 2. Apply the spindle: generated code is automatically materialized to .spun/models.spun.jn
@apply(derive_binary_codec)
pub struct PacketHeader {
    pub magic: u32 = 0x4A4E5900,
    pub seq_id: u64,
    pub flags: u16,
}
```

### 3.3 Domain DSL Template Ecosystem Against Context Explosion (Spindle Patterns & `jenny distill`)
To compress boilerplate code volume and LLM context Tokens by 10x–50x, Jenny encourages building declarative domain skeletons via the **`spindle` pattern library**:

1. **Parameterized Policy Derivation (Parameterized `@apply`)**:
   ```jenny
   @apply(patterns::crud_service(
       table: "invoices",
       cache: RedisCache(ttl: 600.sec),
       retry: ExponentialBackoff(max_attempts: 3)
   ))
   pub struct Invoice {
       pub id: u64,
       pub total_cents: i64,
   }
   ```
2. **Block-Level Declarative Domain DSLs (`@spin <dsl_name> { ... }`)**:
   ```jenny
   // Just 6 lines of declarative state-machine DSL automatically spin out hundreds of lines
   // of type-safe state transitions and event dispatch implementations in .spun/
   @spin fsm::state_machine(InvoiceFsm) {
       Draft     --[Issue]---> Issued    guard (inv.total_cents > 0)
       Issued    --[Pay]-----> Paid
       Issued    --[Void]----> Voided
   }
   ```
3. **`jenny distill` (Reverse Distillation Workflow for Shared Project Boilerplate)**:
   * When a project accumulates multiple `.jn` implementation modules with structurally similar patterns, running `jenny distill` coordinates the compiler's AST clone detector with an AI agent to automatically extract repeated business skeletons into project-local `@spin fn` templates, replacing the verbose implementations with concise `@apply(...)` declarations to continuously combat codebase bloat.

---

## 4. `@spin if`: Generic Trait Branching and Cross-Platform Conditional Compilation

In generic containers or low-level cross-platform systems code, `@spin if` enables compile-time branch pruning with zero runtime overhead:

```jenny
impl<T> Array<T> {
    fn drop(own self) {
        // 1. Generic synthetic trait pruning: if T is f32 or ^User, the entire loop is eliminated at compile time!
        @spin if T is UniqueMove {
            for i in 0..self.len {
                drop(self.buf.read_and_take(i))
            }
        }

        // 2. Cross-platform target pruning: select deallocation intrinsic based on backend architecture
        @spin if platform.target == "wasm32" {
            wasm_linear_free(self.buf.raw_ptr())
        } else {
            mimalloc_free(self.buf.raw_ptr())
        }
    }
}
```

---

## 5. `.spun/` White-Box Materialization and the Deterministic Sandbox VM (Meta-VM)

### 5.1 First-Class Source Experience in `.spun/`
1. **Formatted, Human-Readable Disk Output**: Every time `jenny build`, `jenny check`, or `jenny spin --inspect` runs, the Stage 2 VM formats all `@spin` expansion artifacts through the official formatter and writes them to **`.spun/<module_path>.spun.jn`** in the project root.
2. **Real Line-Number Mapping (Zero-Blackbox Debugging)**:
   * Triggering **Go to Definition** on `packet.encode(mut writer)` in an IDE opens `.spun/models.spun.jn` directly at the exact generated method line!
   * When a runtime error occurs or a developer steps into a generated method in the debugger, execution pauses directly on the real source lines inside `.spun/models.spun.jn`.
3. **Compile-Time DAP Breakpoint Debugging**: Developers can place breakpoints directly inside `@spin fn derive_binary_codec` on `for f in target.fields()`, and run `jenny debug-spin` to step through and watch `encode_stmts` being spun line by line in the IDE.

### 5.2 100% Deterministic Sandbox Principle
To guarantee **100% bit-for-bit reproducible builds** across any machine, any timestamp, and incremental compilation caches, the built-in bytecode virtual machine (Meta-VM) that executes `@spin` enforces strict sandbox isolation:
* **Strictly Forbidden**: Initiating network socket requests, reading the system wall-clock time, querying hardware random number generators, reading or writing host filesystem paths outside the project root, or spawning external shell processes.
* **Controlled Static Asset Inclusion**: Reading static files inside the project directory is only permitted through `@spin.include_str("schema.sql")` or `@spin.include_bytes("icon.png")`, and the compiler automatically records those files in the incremental build hash dependency graph.
