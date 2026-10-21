# `jenny` 模块化 TypeScript 编译器与 Spindle 白盒工具链 (`compiler/`)

本目录存放 **Spinning Jenny (`Jenny v0.2`)** 模块化原生 TypeScript 编译器（`compiler/src/flow/`）、白盒包管理器与供应链审计器（`compiler/src/spindle/`）、C99 原生运行时头文件（[`jenny-flow/jenny_rt.h`](./jenny-flow/jenny_rt.h)）及历史 Python 对照实现。

---

## 1. 模块化 TypeScript 架构 (`compiler/src/`)

基于 **Node.js v24 原生 TypeScript 执行引擎 (`erasableSyntaxOnly`)** 构建，零外部 `node_modules` 依赖，全部 19 个模块均按编译流水线职责正交解耦：

### 1.1 统一入口
* **[`src/jenny.ts`](./src/jenny.ts)（38 行）**：统一顶层 CLI 入口（`node compiler/src/jenny.ts ...`），自动分发 `flow` 编译/验证指令与 `spindle` 包管理子命令。

### 1.2 核心编译器 (`compiler/src/flow/`，共 13 个正交模块)
1. **[`src/flow/ast.ts`](./src/flow/ast.ts)（301 行）**：核心 AST 接口（`StructDecl`, `FnSpec`, `ModuleAST`, `Diagnostic`）与函数签名/参数解析工具。
2. **[`src/flow/blueprint.ts`](./src/flow/blueprint.ts)（701 行）**：`.jni` 双区文学化蓝图提取（`jenny_decl` / `jenny_test`）、`jni_abi_hash` 指纹计算、`parseJniBlueprint` 与 `.jn` 骨架生成器。
3. **[`src/flow/parser.ts`](./src/flow/parser.ts)（258 行）**：`.jn` 实现文件挂载、模块内私有函数识别与自动合成方法剥离。
4. **[`src/flow/spin.ts`](./src/flow/spin.ts)（860 行）**：`@spin` 与 `@apply` 模式包加载（读取 `library/patterns/**/*.jnp`）、`delegate` 委托合成、过程式变参单态化（`.spun/` & `.jenny-cache/spin/`）与 `distill` 反向提炼。
5. **[`src/flow/blind_audit.ts`](./src/flow/blind_audit.ts)（270 行）**：零信任盲测剥离（`stripJennyTestForAgent`）、`E0905_TEST_LITERAL_OVERFITTING` 反硬编码作弊审计与 `RC1`~`RC3` 架构师根因审计。
6. **[`src/flow/bounds_prover.ts`](./src/flow/bounds_prover.ts)（268 行）**：编译期 `QF_LIA` 数组边界完备性证明器（`Jenny-BoundsProver` & `E0711` 反例生成）与 `mask [...]` 副作用阻断安全审计（`E0709` / `W0710`）。
7. **[`src/flow/checker.ts`](./src/flow/checker.ts)（596 行）**：Jenny v2.0 语法门禁、Stage 2 三态所有权/内存与副作用检查、Stage 3 特征约束检查与 Stage 4 FFI 边界检查。
8. **[`src/flow/codegen_expr.ts`](./src/flow/codegen_expr.ts)（738 行）**：C99 类型映射、管道算子 `|>` 展开、具名参数对齐、基于 [`library/std/rt/builtin_dispatch.json`](../library/std/rt/builtin_dispatch.json) 的原语分发与表达式降级。
9. **[`src/flow/codegen_c99.ts`](./src/flow/codegen_c99.ts)（573 行）**：C99 函数体生成、`requires`/`ensures`/`invariant` 契约织入、RAII 独占盒析构与三轨闭包（`fn` / `*fn` / `^fn`）环境提升。
10. **[`src/flow/codegen_harness.ts`](./src/flow/codegen_harness.ts)（320 行）**：`.jni` ABI 编译防火墙 `.h` 头文件生成、`@example` / `jenny_test` 运行器与 `--fuzz` 契约性质测试生成。
11. **[`src/flow/driver.ts`](./src/flow/driver.ts)（604 行）**：跨模块 `import` 拓扑解析、`.jenny-cache/` 内容寻址缓存池与 `clang -O3` 原生构建驱动。
12. **[`src/flow/mutations.ts`](./src/flow/mutations.ts)（332 行）**：Stage 1 ~ Stage 4 全量 18 项语言级故障变异注入门禁套件。
13. **[`src/flow/cli.ts`](./src/flow/cli.ts)（149 行）**：`jenny-flow` 命令行入口。

### 1.3 白盒包管理器 (`compiler/src/spindle/`，共 5 个正交模块)
1. **[`src/spindle/manifest.ts`](./src/spindle/manifest.ts)（397 行）**：`Tapestry.toml` / `pkg.jni` 解析、FNV-1a 32位哈希与模块依赖图校验。
2. **[`src/spindle/audit_and_build.ts`](./src/spindle/audit_and_build.ts)（423 行）**：依赖环检测、零信任副作用沙箱（`E0501`–`E0505`、`E0510`）、可达子图按需裁剪（`build --entry` / `context`）与包级变异门禁（`mutate`）。
3. **[`src/spindle/semver_and_lock.ts`](./src/spindle/semver_and_lock.ts)（453 行）**：`Tapestry.lock` 双 Merkle 根锁定、霍尔逻辑契约语义版本校验（`E0506`–`E0509`）与 `.jni -> .jn` 按需合成（`synthesize`）。
4. **[`src/spindle/bindgen_and_pack.ts`](./src/spindle/bindgen_and_pack.ts)（769 行）**：C 头文件自动桥接（`bindgen-c`）、`CHECKLIST.md` 四阶闭环校验（`std-check`）、统一 AST 归档打包（`pack`）与无损反编译（`decompile`）。
5. **[`src/spindle/cli.ts`](./src/spindle/cli.ts)（144 行）**：`spindle` 命令行入口。

---

## 2. 常用命令速查

```powershell
# 全量 40 模块编译 + 79 个 @example + 18 项语言级变异门禁
node compiler/src/jenny.ts --mutate

# 全量 40 模块 33,380 次契约性质与有状态容器 Fuzzing
node compiler/src/jenny.ts --fuzz

# Spindle 供应链安全审计、变异测试、契约 SemVer 校验与标准库进度检查
node compiler/src/jenny.ts audit
node compiler/src/jenny.ts mutate
node compiler/src/jenny.ts semver-check
node compiler/src/jenny.ts std-check
```
