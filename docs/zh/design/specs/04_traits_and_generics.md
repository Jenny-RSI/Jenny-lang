# Jenny 语言规范 —— 模块四：Trait 契约、泛型系统与容器适配 (Traits, Generics & Container Adaptation)

> **状态**：已定稿 (v1.0-spec)  
> **核心理念**：以显式受限泛型（Bounded Quantification）与 `trait` 多态契约为核心，结合编译器自动合成的内存三态特征（`TrivialCopy` / `UniqueMove` / `GcTrace`）与三位一体泛型编译策略，实现**“一套容器代码通吃双轨内存，零二进制体积膨胀”**。

---

## 1. Trait 多态契约系统 (Trait System)

### 1.1 Trait 声明、默认实现与直观关联类型投影 (`T.Item`)
* **关联类型（Associated Types）**：支持在 `trait` 内声明 `type Name`（可附带约束，如 `type Output: Serializable`）。
* **点号类型投影（告别 `<T as Trait>::Item`）**：在泛型签名与函数体中，一律通过直观的 **`T.Output`** 访问关联类型，彻底废除 Rust 中晦涩冗长的完全限定语法。
* **包级孤儿规则（Package-Level Coherence）**：为保证全局类型系统的一致性（防止哈希表或排序算法在不同模块产生冲突实现），`impl Trait for Type` 必须定义在 **`Trait` 所属的包（Package）** 或 **`Type` 所属的包** 内部。

```rust
pub trait Codec {
    type Frame: Send // 关联类型声明

    fn encode(&self, frame: &Self.Frame) -> *Buffer ! CodecError
    fn decode(&self, raw: []u8) -> Self.Frame ! CodecError

    // 默认方法实现
    fn reset(&mut self) {
        // default no-op
    }
}

// 泛型函数中直接通过 C.Frame 直观访问关联类型！
pub fn transcode_one<C: Codec>(codec: &C, input: []u8) -> *Buffer ! CodecError {
    val frame: C.Frame = codec.decode(input)?
    return codec.encode(&frame)
}
```

### 1.2 自动合成基础能力（免 `@derive` 样板）与 `@operator` 注解
站在 Token 经济学（消灭无脑样板代码）视角下，Jenny 彻底废除传统语言中满屏的 `@derive(Eq, PartialEq, Hash, Debug, Clone)` 噪音：
1. **纯数据类型的基础能力默认自动合成（Zero-Boilerplate Synthesis）**：
   * 只要一个 `struct` 或 `enum` 的所有字段均支持相等比较/哈希/格式化，编译器**默认自动为其合成按字段逐一比对的 `==`、`!=`、`.hash()` 以及结构化调试文本 `.to_debug_str()`**！
   * 仅当开发者需要自定义特殊比较逻辑（如忽略某个缓存时间戳字段）时，才需通过在 `impl` 中定义 `@operator("==")` 显式覆写默认合成实现。
2. **`@operator("...")` 方法注解 + 高内聚领域 Trait**：
   * 避免将 `+`, `-`, `*`, `/`, `[]` 拆碎成二十多个单方法 Trait（如 Rust 的 `std::ops::*`）。直接在 `impl Type` 中使用 `@operator("+")` 绑定预定义安全运算符（`+`, `-`, `*`, `/`, `%`, `==`, `<=>`, `[]`, `[]=`），并通过 `Equatable`、`Comparable`、`Numeric` 进行高内聚泛型约束：

```rust
pub struct Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
// 注：Vec3 已默认自动具备 ==、!=、.hash() 与 .to_debug_str()，无需手写！

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

### 1.3 零样板组合复用：`delegate` 自动委托与 Trait Mixins
为了在放弃传统类继承的同时，避免“组合模式”产生海量无意义的样板转发方法（防止浪费 AI Token 与污染上下文）：
1. **`delegate` 结构体字段委托**：
   * 支持在 `struct` 内部或 `impl` 块中声明 **`delegate <TraitName> to self.<field>`**。
   * 编译器自动为外层结构体生成该 `Trait` 全部方法的零开销内联转发实现；若外层结构体需要覆写（Override）其中某几个特定方法，只需在 `impl <TraitName> for OuterStruct` 中单独写出需定制的方法即可！
2. **高密度 Trait 默认方法织入（Trait Mixins）**：
   * 标准库广泛采用 Mixin 模式设计 Trait（如只实现 1 个底层原语方法，自动继承数十个派生组合算子）。

```rust
pub struct InstrumentedStore {
    engine: *RocksDbEngine,
    metrics: ^MetricsCollector,

    // 一行代码将 StorageEngine 的 15 个方法全部委托给 self.engine，仅覆写 put 方法！
    delegate StorageEngine to self.engine
}

impl StorageEngine for InstrumentedStore {
    // 仅定制需要埋点的 put 方法，其余 14 个方法由 delegate 自动合成
    pub fn put(mut self, key: str, val: []u8) -> void ! StoreError 
        effects [IO] 
    {
        self.metrics.increment("store.put")
        return self.engine.put(key, val)
    }
}
```

---

## 2. 全三态动态分发胖指针 (`dyn` / `*dyn` / `^dyn Trait`)

当需要运行时多态（如异构集合、插件接口或缩减代码体积）时，Jenny 使用显式的 `dyn Trait` 关键字（与静态泛型 `<T: Trait>` 清晰区分），并与模块一 v2.0 的三态内存模型完全对齐。所有 `dyn Trait` 在物理上均表示为 **16 字节胖指针 `{ data_ptr: *void, vtable_ptr: *VTable }`**：

| 动态多态类型 | 物理归属与生命周期 | 核心工程特性 |
| :--- | :--- | :--- |
| **`dyn Trait` / `mut dyn Trait`**<br>*(用于函数参数)* | **栈绑定借用胖指针**<br>*(无需写 `&`)* | **零堆分配（Zero-Boxing）**：得益于参数默认只读借用规则，无论调用方手头是栈上值 `v`、原生堆 `*v` 还是托管堆 `^v`，均可直接零拷贝传入 `elem: dyn Drawable`！ |
| **`*dyn Trait`** | **Native 堆唯一所有权多态对象** | `vtable` 头部固定内嵌具体类型的 `drop_and_dealloc` 函数指针；当 `*dyn Trait` 离开作用域时，通过虚表精准执行底层具体结构体的析构与原生堆释放。 |
| **`^dyn Trait`** | **GC 托管堆共享多态句柄** | 支持构建复杂异构对象图（如 `^Array<^dyn Widget>`），由 GC / WasmGC 自动追踪底层具体对象的存活期。 |

```rust
pub trait Drawable {
    fn draw(self, mut canvas: Canvas)
}

// 参数直接写 elem: dyn Drawable（默认只读借用胖指针）：调用方传栈值、*Button 或 ^Sprite 均零堆分配！
pub fn render_element(elem: dyn Drawable, mut canvas: Canvas) {
    elem.draw(mut canvas)
}
```

---

## 3. 三位一体泛型编译策略 (Tri-Mode Generics Compilation)

Jenny **严禁 C++ 风格的鸭子类型无约束模板**，所有泛型类型参数 `T` 在函数内部仅允许调用其声明的 Trait Bound 方法（保证泛型函数在定义处即可完成 100% 静态类型检查，无需等到实例化时才报错）。

在后端代码生成阶段，Jenny 采用独创的**三位一体按需分级编译策略**，既根治了 Rust 开发态单态化导致的中间文件膨胀与编译缓慢，又保证了生产发布的极致吞吐量与 Wasm 极小体积：

1. **同构指针擦除优化（Polymorphic Pointer Erasure，针对 `^T` 全模式永久开启）**：
   * 由于所有 `^User`、`^Order` 在物理上具有完全相同的托管句柄宽度与 GC 写屏障语义，编译器在 Debug 与 Release 后端均自动将 `Array<^User>`、`Array<^Order>` 的机器码实现合并指向同一份底层 `Array<^GcObject>` 机器码模板，**静态类型 100% 安全，而二进制膨胀率为 0**！
2. **字典传递模式（Dictionary Passing，Debug 开发态默认开启 & `@dynamic` 显式开启）**：
   * **Debug / AI 自愈验证模式默认策略**：在 `jenny check`、`jenny weave` 与 `--debug` 构建时，值类型泛型默认采用字典传递（隐式传入 `vtable` 与类型尺寸描述符，类似 Swift Witness Table），每个泛型函数全局**仅编译 1 次**，消除 80% 的中间代码与调试符号膨胀！
   * **生产态显式 `@dynamic`**：当泛型函数标注 `@dynamic`（或开启 `-Oz` Wasm 极限体积编译模式）时，在 Release 下同样保持单份机器码输出。
3. **静态单态化（Monomorphization，`--release` 生产态针对值类型与 `*T` 自动开启）**：
   * 在 `--release` 构建下，对于未标记 `@dynamic` 的 `Array<i32>`、`Array<Vec3>` 等值类型与 `*T` 泛型，编译器自动生成专用机器码并完全内联方法调用，解锁 LLVM SIMD 自动向量化。

---

## 4. 编译器合成特征与双轨通用容器 (`Array<T>` / `Map<K, V>`)

为了避免标准库分裂为“原生版容器”与“GC 版容器”，编译器在类型检查阶段自动为所有类型 `T` 推导三个底层正交内建特征（Intrinsic Traits）：

* **`TrivialCopy`**：不包含任何 `*U`、`^U` 或自定义 `drop` 的纯值类型（如标量、`Vec3`、SSO `String`）。支持 `memcpy` 批量复制，销毁时无元素级析构。
* **`UniqueMove`**：本身为 `*U` 或内部含有 `*U` / 自定义 `drop` 的唯一所有权类型。赋值触发隐式 Move，容器销毁时必须遍历调用元素 `drop`。
* **`GcTrace`**：本身为 `^U` 或内部含有 `^U` 的类型。容器底层缓冲区需注册 GC 指针位图（Pointer Bitmap）并在元素写入时触发写屏障。

### 通用容器的正交组合矩阵
同一个 `Array<T>` 定义，通过外层指针修饰符与内层元素类型 `T` 的正交组合，自动演化出四种精准的内存拓扑：

| 容器实例类型 | 容器控制块与连续缓冲区位置 | 内部元素 `T` 的管理策略 |
| :--- | :--- | :--- |
| **`*Array<Vec3>`** | 原生堆（或 `*in(arena)`） | 纯连续字节块，扩容直接 `realloc`，销毁时一次性 `free` 缓冲区（`#if T is UniqueMove` 分支在编译期被静态裁剪消除）。 |
| **`*Array<*AudioChunk>`** | 原生堆 | 唯一所有权容器持有唯一所有权元素；销毁 `*Array` 时自动遍历 `drop` 释放每一个 `*AudioChunk`。 |
| **`^Array<^User>`** | GC 托管堆 / WasmGC `arrayref` | 全托管业务列表，适用同构指针擦除优化，由 GC 自动追踪回收。 |
| **`^Array<*RawFrame>`** | GC 托管堆持有原生元素 | 当外层 `^Array` 被 GC 回收时，终结器自动遍历触发内部所有 `*RawFrame` 的 `drop` 释放 C 内存。 |
