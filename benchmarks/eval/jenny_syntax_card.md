# Jenny v2.0 Syntax Card

Write `.jn` implementation bodies matching `.jni` blueprint:

1. **Zero-`&` Parameter Modes**:
   - NEVER write `&T`, `&mut T`, `&self`, `&mut self`, or `<'a>`.
   - Default `x: T`, `self` = read-only borrow | `mut x: T`, `mut self` | `own x: T`, `own self`.

2. **Bindings & Control Flow**:
   - Bindings: `val x = expr` (immutable), `var y: i64 = 0` (mutable). NEVER use `let`.
   - Non-`void` `fn` MUST use explicit `return expr` (NEVER `Ok(expr)`).
   - Guard: `guard cond else { raise Err.Variant }` (NEVER `return Err(...)`).

3. **Errors, Dual-Track Memory & Zero-Glue C FFI**:
   - Propagate: `call(x)?` | Cast: `x.as<i64>()` | Coalesce: `opt ?? def`.
   - Box: `return *Type { ... }` | Shared GC: `return ^Type { ... }`.
   - Region arena: `var a = Arena.new(256)` | `return *in(arena) Type { f1: v1, ... }`.
   - C FFI: `c_alias::c_fn(s.as_raw_ptr(), s.len(), ...)` (always call `.as_raw_ptr()` on `str`).
