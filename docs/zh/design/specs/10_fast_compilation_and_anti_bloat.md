# Jenny 语言规范 —— 模块十：极速增量构建与零膨胀中间产物架构 (Sub-Second Compilation & Anti-Bloat Architecture)

> **状态**：已定稿 (v1.0-spec)  
> **核心母题**：深刻汲取 Rust / C++ 编译缓慢与 `target/` 目录动辄膨胀至数十 GB 的工程教训；在 AI 高频自愈生成循环（AI Edit-Compile-Verify Loop）中，通过 **“`.jni` 编译防火墙 + Debug 默认字典多态 + 内置字节码 `@spin` + 行号表分离 + 定额 LRU 内容寻址缓存”** 五大支柱，实现**亚秒级（Sub-Second）增量验证与 1/20 的磁盘体积占用**。

---

## 1. 历史教训复盘：为什么 Rust 的 `target/` 目录会爆炸式膨胀？

在设计 Jenny 编译器（`jennyc`）与构建系统（`spindle`）前，我们系统解剖了传统系统级语言（以 Rust 为代表）构建产物动辄 10GB~30GB 且增量编译缓慢的五大病灶，并逐一制定了根治架构：

| 传统语言（Rust/C++）的五大膨胀病灶 | 膨胀与变慢的物理成因 | **Jenny 编译器的靶向根治架构** |
| :--- | :--- | :--- |
| **1. 无节制的泛型单态化与跨包重复实例化** | 即使在 Debug 模式下，也对所有泛型做 100% 机器码复制；且不同 Crate 使用 `Vec<String>` 时会在各自的 `.rlib` 中重复编译并存储同一份机器码与符号。 | **Debug 默认字典传递（零复制）+ Release 全量单态化 + `^T` 永久同构指针擦除**：开发态每个泛型函数全全局仅生成 **1 份** 机器码！ |
| **2. 单文件混写导致级联重编与 `.rlib` 元数据肥胖** | 没有接口文件隔离，修改某函数体内一行私有代码，导致所有下游依赖 Crate 全部失效重编；且 `.rlib` 必须打包全量序列化 MIR 与 AST。 | **`.jni` 蓝图编译防火墙（ABI Firewall）**：只要 `<module>.jni` 未修改，AI 将 `<module>.jn` 实现重写十遍，**下游依赖模块 100% 零重编**！ |
| **3. DWARF 调试符号重复拷贝爆炸（占 70% 体积）** | 泛型与巨型异步状态机生成长达数万字符的符号名，完整的 DWARF 类型表在 `.o`、`.rlib`、增量缓存与可执行文件中被重复拷贝 3~4 次。 | **默认轻量行号表（Line-Tables-Only）+ 按需 Split DWARF**：日常与 AI 循环仅生成占 5% 体积的行号映射表；深度调试时采用零拷贝 `.dwo` 分离引用。 |
| **4. 过程宏需要将解析器编译为宿主机动态库** | 每个 `@derive` 宏都需要先拉取并编译庞大的 `syn`/`quote` 语法解析库，在磁盘上生成数百 MB 的宿主机 `.dll`/`.so` 插件二进制。 | **内置 Meta-VM 字节码沙箱**：`@spin fn` 直接共享编译器内存中的 AST，零外部解析库依赖、零 `.dll` 插件产物，仅输出几 KB 的 `.spun/*.jn` 文本！ |
| **5. 散乱文件堆积与无上限的历史指纹垃圾** | 每次微调环境变量或特性都会生成新 Hash 后缀的 CGU 切片文件，只增不减，从不自动清理过期缓存。 | **定额 LRU 内容寻址存储库（Bounded CAS Store）**：所有中间产物存入单一内容哈希缓存池，默认硬上限 **2 GB**，自动按 LRU 淘汰过期历史产物。 |

---

## 2. 支柱一：`.jni` 蓝图编译防火墙 (The `.jni` Compilation Firewall)

Jenny 的 **“`.jni`（文学化蓝图）与 `.jn`（幕后实现）物理分离”** 不仅服务于人类阅读，更在编译器依赖图上构筑了一道天然的**增量编译防火墙**：

```
[ 模块 A: parser.jni ] ◄────(仅依赖 .jni 蓝图哈希)──── [ 模块 B: compiler.jn ]
         ▲
   (双向同构实现)
         │
[ 模块 A: parser.jn  ]  🔥 AI 修改了 parser.jn 内部 500 行实现逻辑！
```

1. **下游模块仅依赖上游的 `.jni` 蓝图 AST 哈希**：
   * 在编译模块 B 时，类型检查器、借用检查器与副作用验证器所需的**全部契约信息（内存轨道 `*`/`^`、类型大小、函数签名、`effects`、前后置契约）100% 包含在 `parser.jni` 中**。
   * **极速重编定理**：只要 `parser.jni` 的形式化 ```` ```jenny ```` 块哈希值未发生变化，无论 AI 如何修改或重构 `parser.jn` 的函数体实现，**下游的 `compiler.jn` 完全不需要重新执行类型检查或重新生成机器码**，仅需在最终一步由极速链接器（`mold` / `lld`）重新缝合修改过的单个目标单元！
2. **告别肥胖的 `.rlib` 元数据打包**：
   * 非泛型函数严禁隐式跨模块源码级泄漏；下游模块直接链接上游编译好的二进制符号，中间库文件不再携带冗余的序列化函数体 IR。

---

## 3. 支柱二：泛型“开发态字典多态 vs 发布态单态化”双模引擎

为了彻底消灭泛型带来的编译耗时与代码体积膨胀，Jenny 对模块四的“三位一体泛型策略”按构建模式施行动态分级调度：

### 3.1 `^T` 托管引用：全模式永久开启“同构指针擦除”
* 无论在 Debug 还是 Release 模式下，`Array<^User>`、`Array<^Order>`、`Map<String, ^Session>` 在物理机器码层**永远共享同一份 `Array<^GcObject>` 实现**，编译次数为 1，体积膨胀率为 0。

### 3.2 值类型 `T` 与 `*T`：Debug 字典传递 vs Release 单态化
| 构建模式 | 泛型编译策略 | 编译耗时与中间体积表现 |
| :--- | :--- | :--- |
| **`jenny check` / `jenny weave` / `jenny build --debug`**（日常开发与 AI 自愈模式） | **默认开启 `@dynamic` 字典传递模式（Witness Table + 尺寸描述符）** | 泛型函数 `fn sort<T: Comparable>(mut arr: []T)` 在整个项目中**仅编译 1 次**！彻底免除 LLVM 重复优化数千个单态化副本的开销，中间 `.o` 体积缩小 **80%**，AI 改码后的验证反馈缩短至 **50~200 毫秒**！ |
| **`jenny build --release`**（生产发布模式） | **开启静态单态化（Monomorphization）+ 跨模块 LTO 内联** | 针对所有值类型与 `*T` 实例生成专用机器码，完全消除虚表间接跳转并解锁 SIMD 自动向量化（用户显式标注 `@dynamic` 以缩减 Wasm 体积的函数除外）。 |

---

## 4. 支柱三：双轨调试信息、四级开关（含零符号反逆向模式）与零拷贝 Split DWARF

针对传统系统语言（C++ / Rust / Go）“DWARF 调试符号占满 70%+ 构建体积、异步状态机与宏展开无法单步调试、以及 Go `.gopclntab` / Rust `panic!` 明文符号极易被逆向工程（IDA Pro / Ghidra）还原源码结构”的三大痛点，Jenny 采用了 **“运行期 `.rodata` 自省表与外部调试器 DWARF 物理分离 + 四级编译开关 + 离线 `.jnsym` 符号还原”** 架构：

### 4.1 双轨调试架构：运行期自省（Track A）vs 硬件调试器 DWARF（Track B）
1. **轨道 A（运行期 `.rodata` 微型自省表，体积占比 `< 2%`）**：
   * 包含以 32-bit `fn_sym_id` 索引的函数符号表 `__jn_fn_symtab`（记录模块名、函数名、泛型/`@spin` 类型实参）与以 64-bit `[TypeHash32 | VariantHash32]` 索引的错误注册表 `__jn_error_registry`（记录错误变体名与三阶 SPO 载荷解包格式化函数）。
   * **核心优势**：业务代码调用 `err.format_with_trace(trace)` 或触发霍尔契约诊断时，直接执行 **$O(1)$ 内存查表**，无需像 C++/Rust `libbacktrace` 那样在运行时去磁盘解析几百 MB 的 DWARF 段，且在 WebAssembly 环境同样 100% 可用。
2. **轨道 B（外部硬件调试器 DWARF v5 / CodeView PDB）**：
   * 仅供 `lldb`、`gdb`、VS Code DAP 或硬件 Profiler（`perf` / `VTune`）挂载进程时使用。

### 4.2 四级调试与商业反逆向保护开关 (`--debug-info=none | line-tables | split | full`)

编译器与 `Tapestry.toml` 提供四个正交的调试信息等级，覆盖从“高保密商业防逆向发布”到“IDE 深度单步调试”的全场景：

| 等级开关 | 适用场景 | 轨道 A (`.rodata` 运行期自省表) | 轨道 B (外部 DWARF / PDB 符号) | 产物特征与反逆向/性能收益 |
| :--- | :--- | :--- | :--- | :--- |
| **`Level 0`**<br>**`--debug-info=none`**<br>*(零符号反逆向模式)* | 商业闭源软件、核心算法 SDK、游戏客户端、金融终端发布 | **100% 剔除明文字符串！**<br>移除所有模块名、函数名、文件名与错误变体名（可选配 `--symbol-salt=<key>` 混淆哈希码） | **100% 剔除**<br>（零 `.debug_*` 段、零内部 `.symtab` 符号） | `strings` / IDA / Ghidra **零内部明文符号泄露**；生成离线私有映射表 `<app>.jnsym` 供服务端 `spindle symbolicate` 还原 |
| **`Level 1` (默认)**<br>**`--debug-info=line-tables`** | 日常开发、`jenny test`、AI 自愈循环、服务端常规生产部署 | 保留精简 `__jn_fn_symtab` 与 `__jn_error_registry` | **仅生成 `.debug_line` 行号表**<br>（对应 `-gline-tables-only`，不生成局部类型树） | 100% 精确源码调用栈与契约报错；比完整 DWARF **缩减 90% 体积**，编译提速 30%+ |
| **`Level 2`**<br>**`--debug-info=split`** | 开发者在 IDE 启动断点调试器（DAP）单步调试局部状态 | 保留完整运行期自省表 + 内嵌调试器美化脚本 | **启用 Split DWARF v5 (`.dwo`)**<br>可执行文件仅含 32B `DW_TAG_skeleton_unit` | 调试类型树留存于 `.jenny-cache/dwo/<hash>.dwo`；**链接器零拷贝**，链接速度提升 5~10 倍 |
| **`Level 3`**<br>**`--debug-info=full`** | 打包上传至崩溃分析平台（Sentry / Crashpad）的独立符号归档 | 保留完整运行期自省表 | 生成独立打包符号文件（`.dwp` / `.dSYM` / `.pdb`） | 主程序与重型调试符号物理分离分发 |

#### 🔒 Level 0（`--debug-info=none`）零符号防逆向模式的三大工程保证
当用户开启 `--debug-info=none`（或在 `Tapestry.toml` 设置 `debug_info = "none"`）以保护商业机密防止逆向分析时：
1. **100% 抹除二进制内的明文标识符，且零运行期行为退化**：
   * 二进制 `.rodata` 中不再包含任何源码路径（`.jni`/`.jn`）、模块名、函数名、结构体名或 `pub error` 变体名字符串；
   * 由于 Jenny 的错误判断 `if err is SpecificError` 与契约校验在底层 **100% 基于 64 位数值码 `[TypeHash32 | VariantHash32]` 比对**（从不依赖字符串比较），剔除明文符号后，所有错误分支、三阶 SPO 参数解包与异步状态机调度 **100% 原样正常工作**！
2. **可选编译期密钥盐值混淆（`--symbol-salt=<secret>`）**：
   * 为防止逆向分析者对常见英文单词计算标准 `fnv1a_32` 进行彩虹表字典猜测，开启 `--symbol-salt` 后，内部模块的 `TypeHash32` 与 `VariantHash32` 自动混入构建专属密钥盐值（Keyed Hash），使二进制中的 64 位错误码对外部逆向者完全不可预测。
3. **脱敏脱机日志与 `spindle symbolicate` 离线符号还原**：
   * 在 `none` 模式下调用 `err.format_with_trace(trace)` 时，不再输出明文名称，而是输出高密度脱敏十六进制诊断码（仍保留 Tier-1/Tier-2 参数值与 `[fn_sym_id:frame_kind:await_state:line_no]` 数字轨迹）：
     ```text
     E#8A3F19C2:D4017B09(42, 255) @ [0x00000412:2:3:142 -> 0x00000108:1:0:89]
     ```
   * 编译器在构建时将符号映射字典单独输出至构建机私有文件 **`<app>.jnsym`**（绝不随客户端分发，类似 Android ProGuard `mapping.txt`）。当收到客户端上报的脱敏诊断串时，开发者在内部服务器运行：
     ```powershell
     spindle symbolicate --map app.jnsym "E#8A3F19C2:D4017B09(42, 255) @ [0x00000412:2:3:142 -> 0x00000108:1:0:89]"
     ```
     即可一键无损还原出完整的明文错误变体、参数名及跨 `.jni`/`.jn`/`.spun.jn` 的异步因果调用栈！

### 4.3 三源精准行号映射：`.jni` 契约 + `.jn` 实现 + `.spun.jn` 元编程
在 `Level 1 ~ Level 3` 模式下，由于单个编译后函数交织了 `.jni`（`requires`/`ensures`/`invariant` 契约）、`.jn`（函数体实现）与 `.spun/<mod>.spun.jn`（`@spin` 编译期展开代码），Jenny 在生成 DWARF `.debug_line` 状态机（及 C99 后端 `#line <line> "<file>"` 指令）时，将三个源文件同时注册进编译单元的 **DWARF File Name Table (`DW_LNS_set_file`)**：
* 在 VS Code 中直接在 Markdown 蓝图 `.jni` 的 `requires` 行打断点，调试器会精准停在入口契约检查指令处；
* 单步执行下一行时自动跳转至 `.jn` 实现文件对应行；
* 步入 `@spin` 展开逻辑时直接跳入白盒落盘的 `.spun/<mod>.spun.jn`，实现**三源零行号漂移单步调试**。

### 4.4 Jenny 专属语法结构的 DWARF DIE 映射与调试器美化器 (`Pretty-Printers`)
在 `Level 2 (split)` 与 `Level 3 (full)` 模式下，编译器生成定制的 DWARF DIE 描述符与 `.debug_gdb_scripts` / LLDB Formatters：
1. **异步 Continuation 状态机帧 (`<Fn>_Frame`)**：对跨 `.await` 存活并被搬移至 `<Fn>_Frame` 的局部变量 `x`，生成基于帧指针偏移的 `DW_AT_location`（`DW_OP_fbreg + offsetof(<Fn>_Frame, x)`），使断点停在异步函数内任意挂起点后，`lldb`/`gdb` 的 `Locals` 面板能像普通同步函数一样直接展示所有局部变量与 `__state` 编号；
2. **24 字节 SSO `String` 与 `^T` 托管句柄**：自动识别 `String` 的 SSO 栈内联标志位（$\le 22\text{B}$）与 Immix 堆指针，在调试器悬停时直接渲染可读文本；
3. **16 字节同构 `Error` / `AnyError`（三阶 SPO 载荷）**：调试器脚本自动按 `code` 检索进程内存中的 `__jn_error_registry` 并解包 Tier-1 寄存器位域或 Tier-2 `ErrorPayloadScratch` 暂存槽，直接展示 `SqlError.SyntaxError { line: 10, col: 4 }`；
4. **Debug 字典传递泛型 (`@dynamic`)**：将隐式字典参数 `__vtable_T: *TypeDesc` 标记为 `DW_AT_artificial`，调试器读取 `TypeDesc` 动态格式化泛型变量 `x: T` 的真实值。

---

## 5. 支柱四：定额 LRU 内容寻址构建缓存 (Bounded CAS Build Cache)

Jenny 废除传统的每个项目在本地生成十几个 GB `target/` 文件夹的粗放模式，改用由 `spindle` 统一管理的**定额内容寻址缓存架构（Bounded Content-Addressable Cache）**：

1. **函数/模块级细粒度哈希寻址**：
   * 编译缓存以 `(编译器版本, 目标平台, .jni 蓝图哈希, .jn 函数 AST 哈希)` 为键值存入高性能本地 CAS 存储池（`.jenny-cache/`）。
   * 即使删除分支或切换 Git Commit，只要函数 AST 未变，直接 0 毫秒命中缓存！
2. **多项目共享第三方库产物**：
   * 机器上多个 Jenny 项目引入相同版本的 `std` 或社区 `spindle` 包时，直接共享全局缓存池中的已编译产物，绝不在每个项目目录下重复编译和存储。
3. **内置容量硬上限与自动 LRU 垃圾回收（Auto-GC）**：
   * 在 `Tapestry.toml` 或全局配置中默认设定缓存水位上限（例如单项目默认 **512 MB**，全局共享池默认 **2 GB**）。
   * 每次构建完成后，后台守护协程以零感知方式自动清理超出水位线的最久未访问（LRU）历史构建碎片，**无需人类手动执行 `clean`，永远不会撑爆开发者磁盘**！
