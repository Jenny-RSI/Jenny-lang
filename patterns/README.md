# `Spindle Patterns` — Official `@spin` Declarative Templates (`patterns/`)

This directory hosts the official **`@spin` compile-time white-box code generation templates** (see [Specification Module 06](../docs/design/specs/06_spin_metaprogramming.md)), which achieve **10x+ implementation token compression** while materializing readable, auditable source files into `.spun/<module>.spun.jn`:

* **`fsm/`**: `@spin fsm::state_machine` declarative finite-state machine generator (demonstrated in [`B19_spin_fsm_order`](../benchmarks/stage3_spin/B19_spin_fsm_order/)).
* **`codec/`**: `@apply(codec::binary)` zero-copy binary wire-protocol encoder/decoder generator with static GC-pointer boundary protection `E0305` (demonstrated in [`B20_spin_binary_codec`](../benchmarks/stage3_spin/B20_spin_binary_codec/)).
* **`crud/`**: `@apply(crud::service)` repository & cache/retry service boilerplate generator enforcing the Additive-Only Rule `E0306` (demonstrated in [`B21_spin_crud_service`](../benchmarks/stage3_spin/B21_spin_crud_service/)).
