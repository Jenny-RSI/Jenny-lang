# Jenny v2.0 语法速查卡 (Syntax Card)

根据 `.jni` 文学化契约蓝图编写 `.jn` 实现体：

1. **零 `&` 三态参数模式 (Zero-`&` Parameter Modes)**：
   - 严禁书写 `&T`、`&mut T`、`&self`、`&mut self` 或 `<'a>`。
   - 默认只读借用：`x: T`、`self` | 原地可变借用：`mut x: T`、`mut self` | 所有权接管：`own x: T`、`own self`。

2. **变量绑定与控制流 (Bindings & Control Flow)**：
   - 绑定：`val x = expr`（不可变），`var y: i64 = 0`（可变）。严禁使用 `let`。
   - 非 `void` 具名函数必须显式书写 `return expr`（严禁写 `Ok(expr)`）。
   - 守卫提前返回：`guard cond else { raise Err.Variant }`（严禁写 `return Err(...)`）。

3. **错误处理、双轨内存与零胶水 C FFI (Errors, Dual-Track Memory & Zero-Glue C FFI)**：
   - 错误传播：`call(x)?` | 显式类型转换：`x.as<i64>()` | 空值合并：`opt ?? def`。
   - 独占原生堆：`return *Type { ... }` | 托管共享堆 (GC)：`return ^Type { ... }`。
   - 区域内存池：`var a = Arena.new(256)` | `return *in(arena) Type { f1: v1, ... }`。
   - C FFI 互操作：`c_alias::c_fn(s.as_raw_ptr(), s.len(), ...)`（对 `str` 传指针必须显式调用 `.as_raw_ptr()`）。
