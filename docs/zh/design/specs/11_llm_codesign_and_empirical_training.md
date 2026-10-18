# Jenny 语言规范 —— 模块十一：语言-模型联合演进与量化实证工程 (PL-LLM Co-Design, JennyBench & RLVR Training)

> **状态**：已定稿 (v2.0-spec)  
> **核心理念**：彻底告别传统编程语言“纯靠人类设计者主观拍脑袋（Prior Intuition）”的设计方式；首创 **“编程语言与大语言模型双向协同演进（PL-LLM Co-Evolution）”** 科学工程范式——以 **五大核心量化指标** 为标尺，将编译器转化为 **RLVR（基于可验证奖励的强化学习）训练环境**，在训练模型精通 Jenny 的同时，根据模型的实证报错分布反向打磨语言语法与 `@spin` 模板库。

---

## 1. 为什么 AI 原生语言必须走“实证与训练协同（Co-Design）”之路？

任何一门新设计的编程语言在面对大语言模型（LLM）时，都面临着严峻的 **“预训练先验壁垒（Pre-training Prior Barrier）”**：
* 基座大模型在数万亿 Token 的 Python、TypeScript、Rust、C/C++、Go 语料上进行了预训练，其内部注意力头与 FFN 层已经形成了稳固的“代码神经回路”。
* 如果新语言的语法设计仅凭人类直觉闭门造车，极易与模型的先验分布发生剧烈冲突（High KL-Divergence），导致模型在生成代码时频繁出现跨语言语法污染（如误写出 Rust 的 `&mut` 或 TS 的 `===`）、Token 切分破碎以及高幻觉率。

因此，Jenny 确立了 **“数据驱动、训赛结合、双向迭代”** 的实证设计准则：**任何语法特性、内存规则与标准库 API 的最终定型，必须经过量化基准测试（JennyBench）与模型训练反馈的实证检验。**

---

## 2. 五大核心量化评估指标体系 (The 5 Quantitative Metrics)

为了科学度量 Jenny 语言设计的优劣，我们建立跨领域的标准评测集 **`JennyBench`**（涵盖：底层 C 库零拷贝封装、高并发网络状态机、复杂图结构业务模型、硬实时音频流处理、微服务 CRUD 管线五大类共 200 个复杂工程任务），并实时监控以下 **5 项硬性量化指标**：

| 指标代号 | 指标名称 | 精确数学定义与测量方法 | 优化目标与设计指导意义 |
| :--- | :--- | :--- | :--- |
| **1. TCR** | **任务 Token 压缩比**<br>*(Token Compression Ratio)* | $$\text{TCR} = \frac{\text{Tokens}(\text{Rust/TS 等价基准实现})}{\text{Tokens}(\text{Jenny .jni 蓝图 + .jn 实现})}$$<br>*(采用主流 BPE Tokenizer 如 `o200k` / `cl100k` 实测)* | **目标：$\text{TCR} \ge 3.0\text{x}$（通用算法）至 $15.0\text{x}$（DSL 业务模块）**。<br>若某类任务 TCR 偏低，说明样板代码仍过多，需引入新的 `@spin` 模板或 `delegate` 语法糖。 |
| **2. ECC** | **有效上下文架构容量**<br>*(Effective Context Capacity)* | 在固定上下文预算（如 32K Tokens）内，仅向模型注入全项目的 `.jni` 蓝图文件，测试模型执行跨 $N$ 个模块的全局需求变更时的**一次修改准确率**。 | **目标：单次 32K 窗口可无损容纳 $\ge 10\text{ 万行}$ 等价规模系统的全量架构拓扑**，验证 `.jni` 物理分离对防止上下文爆炸的真实增益。 |
| **3. $\text{Pass}@1$ & $\text{Heal}@k$** | **盲测首次通过率与自愈效率**<br>*(Blind Compile Pass & Self-Healing Rate)* | • **盲测 $\text{Pass}@1$**：给定物理剥离了 `jenny_test` 的 `.jni` 蓝图（仅含 Markdown 与 `jenny_decl`），Code Agent 零反馈一次生成 `.jn` 并通过全部编译检查、`E0905` 反硬编码审计与隐藏 `jenny_test` 盲测沙箱的比例。<br>• **$\text{Heal}@2 / \text{Heal}@3$**：结合 `--ai-json` 契约违例与脱敏诊断反馈，在 $\le 3$ 轮内完成自愈闭环的比例；若 3 轮均失败，自动触发 **架构模型根因审计 (`Architect Root-Cause Audit`)**。 | **目标：微调前 Few-Shot 盲测 $\text{Pass}@1 \ge 75\%$，微调后 $\text{Pass}@1 \ge 96\%$，$\text{Heal}@3 \ge 99.5\%$**。<br>彻底杜绝模型照抄测试输入走捷径（Reward Hacking），同时检验 `.jni` 蓝图的语义完备性。 |
| **4. SHR** | **语义逻辑幻觉率**<br>*(Semantic Hallucination Rate)* | 代码通过了基础类型检查，但在隐藏的边界属性测试集（Held-out Property & Fuzz Tests）上发生崩溃或逻辑错误的比率。 | **目标：$\text{SHR} \le 1.0\%$**。<br>度量 `.jni` 中的 `requires`、`ensures`、`invariant` 与 `jenny_test` 契约对拦截模型逻辑幻觉的真实防御力。 |
| **5. HCS** | **人类意图审计效率**<br>*(Human Comprehension Score)* | 人类工程师（或独立审计评测集）**仅阅读折叠态/展开态的 `.jni` 蓝图**，在限定时间内准确判断模块内存开销、异常边界与副作用纯度的得分与耗时。 | 验证 `.jni` 原生 Markdown 文学化蓝图与三态参数模式（默认只读 / `mut` / `own`）对人类心智负担的降低程度。 |

---

## 3. 顺应神经先验的语法 A/B 测试与双模型盲测协同方法论 (Perplexity Profiling & Dual-Agent Blind Verification)

在完整编译器后端建成之前，以及在纠结任何具体语法变体（如关键字命名、符号选择、块结构）时，Jenny 采用 **“基座模型困惑度与错误率 A/B 实验”** 代替主观争论：

### 3.1 最小跨度正向迁移测试 (Minimum-Perplexity A/B Test)
1. **实验设置**：针对候选语法方案 A 与方案 B，分别编写等价的 500-Token 极简语法提示词（System Spec），让主流基座模型（如 Gemini / Claude / DeepSeek）在 `JennyBench` 子集上生成代码。
2. **测量生成熵（Token Generation Entropy）**：
   * 提取模型在生成关键语法节点（如函数签名、错误传播、内存前缀、模式匹配）时的 **Log-Probability（对数概率）**。
   * **判定准则**：如果模型在某个语法点上出现明显的概率坍缩（高熵犹豫）或高频退化为 Rust/TS 原生语法，说明该语法违背了预训练语料的先验分布，必须调整为更顺应先验的表述形式！

### 3.2 编译器报错热力图与“摩擦点消除（Friction Elimination）”
在实验与训练过程中，编译器自动统计所有生成失败案例的 **错误码频率热力图（Error Code Heatmap）**，并按以下规则反向演进语言设计：
* **案例 1（冗余重复标注消除）**：若统计发现模型在函数签名已声明 `own x: *Buffer` 的情况下，在调用处有 $>10\%$ 的概率漏写重复的 `own` 关键字，则编译器直接升级支持“调用处省略 `own` 时由 `--ai-json` 零歧义自动静默补全（Auto-Canonicalization）”，将编译报错转化为自动规范化！
* **案例 2（高频样板升格为标准库/DSL）**：若统计发现模型在处理某类任务时反复手写超过 15 行的固定模式代码，立即将该模式沉淀进官方 `spindle` 的 `@spin` 标准模板库。

### 3.3 盲测防走捷径与 `Heal@3 -> Architect Audit` 双模型升级兜底机制
为防止 Code Agent 面向测试用例硬编码（Reward Hacking）并避免低阶模型在错误方向上无限死循环，Jenny 评测与生产流水线强制实行 **四阶盲测与审计闭环**：
1. **盲生隔离（`Pass@1`）**：向 Code Agent 隐藏 ```` ```jenny_test ```` 块，仅提供 Markdown 说明与 ```` ```jenny_decl ```` 声明契约。
2. **脱敏自愈（`Heal@2 ~ Heal@3`）**：当隐藏测试失败时，仅向 Code Agent 反馈触发违例的 `requires` / `ensures` / `invariant` 公式或脱敏后的断言错误类别（屏蔽测试专用魔法字面量）。
3. **AST 反作弊拦截（`E0905_TEST_LITERAL_OVERFITTING`）**：若 `.jn` 实现中出现了仅存在于 `jenny_test` 而未在 `jenny_decl` 声明的测试专用字面量分支，直接判零分并拦截。
4. **`Heal@3` 耗尽后的架构模型根因审计兜底（`Architect Root-Cause Audit`）**：若 Code Agent 连续 3 轮修复均失败，自动唤醒拥有全视角（可见 `jenny_decl` + `jenny_test` + 3 轮失败代码轨迹 + 完整报错栈）的 **负责设计的架构模型（Architect Agent）** 执行根因审计，将失败定性为三大根因之一并输出修复处方：
   * **`RC1_BLUEPRINT_UNDERSPECIFIED`**：蓝图漏写业务规则或契约，由架构模型修补 `.jni` 的 `jenny_decl`；
   * **`RC2_TEST_CASE_DEFECT`**：`jenny_test` 验收断言自身写错，由架构模型修正测试；
   * **`RC3_ALGORITHMIC_BOTTLENECK`**：编码模型陷入算法推导死胡同，由架构模型给出**不泄露测试字面量的算法级根因修正指南（Algorithmic Prescription）**。

---

## 4. 基于编译器可验证奖励的强化学习闭环 (Compiler-in-the-Loop RLVR)

Jenny 的 `.jni` 契约系统与极速编译器（`jennyc`）不仅是一个代码构建工具，更是天然为大模型后训练（Post-Training）量身定制的 **RLVR（Reinforcement Learning with Verifiable Rewards）强化学习环境**！

```mermaid
flowchart TB
    subgraph Data["Stage 1: 合成种子语料与 SFT 冷启动"]
        D1["从 Rust / TS / C 精选高价值开源模块"]
        D2["通过转译 Agent + 编译器验证生成 10万对\n(Markdown 意图 -> .jni 蓝图 -> .jn 实现)"]
        D3["监督微调 (SFT) 注入 Jenny 语法与双轨内存直觉"]
        D1 --> D2 --> D3
    end

    subgraph RL["Stage 2: 编译器内嵌 GRPO 强化学习 (Compiler-in-the-Loop RLVR)"]
        M["Jenny 编码模型 (Policy π_θ)"]
        G["给定剥离 jenny_test 的 .jni 蓝图，并行采样 G=16 个候选 .jn 实现"]
        V["jennyc 亚秒级验证器 + E0905 反硬编码 + 盲测沙箱"]
        R["多维可验证奖励函数 R(y)"]
        M --> G --> V --> R -->|"策略梯度更新"| M
    end

    subgraph CoEvo["Stage 3: 架构模型根因审计与语言/@spin 反向演进"]
        E["收集 Heal@3 失败样本 -> 架构模型根因审计 (RC1/RC2/RC3)"]
        U["1. 修补欠规范的 .jni 蓝图契约 (RC1)\n2. 优化 --ai-json 诊断与 @spin 标准模板库 (RC3)"]
        V -.-> E --> U -.->|"更新语言环境"| V
    end

    Data --> RL
```

### 4.1 精确可验证奖励函数设计 (Multi-Objective Verifiable Reward Function)
在 GRPO（Group Relative Policy Optimization）强化学习阶段，模型根据剥离了 `jenny_test` 的 `.jni` 蓝图盲生 `.jn` 实现代码 $y$，`jennyc` 编译器在毫秒级时间内直接计算确定性标量奖励 $R(y)$：

$$R(y) = R_{\text{compile}}(y) + R_{\text{contract}}(y) + R_{\text{perf}}(y) - P_{\text{overfit}}(y) - \lambda \cdot \text{LengthPenalty}(y)$$

1. **阶段性编译通关奖励 $R_{\text{compile}}(y) \in [0, 0.3]$**：
   * 通过无损语法解析（AST 构建成功）：$+0.1$
   * 通过双轨内存、借用与 `effects` 纯度静态检查：$+0.2$
2. **契约与隐藏盲测实测奖励 $R_{\text{contract}}(y) \in [0, 0.5]$**：
   * 在内置沙箱中 100% 跑通对模型隐藏的 `jenny_test` 套件且未违反 `requires` / `ensures` / `invariant`：$+0.5$（按通过用例比例线性给分）。
3. **双轨内存与零拷贝质量奖励 $R_{\text{perf}}(y) \in [0, 0.2]$**：
   * 静态分析器奖励零冗余 `.clone()`、正确使用 `*in(arena)` 与默认只读借用视图的实现。
4. **反硬编码作弊惩罚项 $-P_{\text{overfit}}(y)$**：
   * 若触发 `E0905_TEST_LITERAL_OVERFITTING`（针对测试字面量硬编码分支），直接施加 $P_{\text{overfit}}(y) = 1.0$ 惩罚，清零当次奖励。
5. **Token 经济学长度惩罚项 $-\lambda \cdot \text{LengthPenalty}(y)$**：
   * **核心驱动力**：在所有通过 100% 盲测契约的候选代码 $y_i$ 中，**Token 数量越少、越善于复用泛型/`delegate`/`@spin` DSL 的实现，获得的净奖励最高**！
   * 这一项奖励将迫使模型在强化学习过程中**自我进化出“极致精简、高复用、零废话”的编码风格**！

---

## 5. 分阶段实证落地路线图 (Empirical Validation Roadmap)

为了在投入重型编译器后端开发前先用数据说话，实证工程按以下三步推进：

1. **Phase 0：零编译器基线对比实验（Week 1 ~ 2）**
   * 选取 10 个涵盖系统、并发与业务的典型模块，手工/半自动编写等价的 Rust、TypeScript 与 Jenny v2.0（`.jni` + `.jn`）对照代码。
   * 使用真实 Tokenizer 跑出第一份 **《Jenny v2.0 vs Rust/TS Token 消耗、上下文压缩比与语法熵实测报告》**，用真实数据校准基础语法。
2. **Phase 1：轻量级前端验证器 + Few-Shot LLM 盲测与架构审计压力测试（Month 1 ~ 2）**
   * 构建包含 **Lexer + Parser + Type/Effect Checker + `--ai-json` 脱敏诊断器 + `Architect Audit` 根因审计器** 的验证工具链。
   * 接入开源代码模型跑 `JennyBench` 盲测（物理剥离 `jenny_test`），实测 Few-Shot 下的盲测 $\text{Pass}@1$、$\text{Heal}@3$、高频错误码热力图及 `Heal@3` 失败后的架构模型根因归类报告。
3. **Phase 2：合成数据集构建与专属小模型 LoRA / RLVR 实验（Month 3 ~ 6）**
   * 利用编译器前端与盲测沙箱作为验证过滤器，自动合成数万条 100% 通过编译的高质量 `.jni <-> .jn` 训练集。
   * 在开源代码基座模型（如 Qwen-Coder / DeepSeek-Coder 7B~32B）上跑通 SFT + RLVR 闭环，实测小参数模型在 Jenny 语言上超越超大模型写 Rust/C++ 的工程拐点！

