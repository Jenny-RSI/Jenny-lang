# `@spin` Declarative Pattern Library (`library/patterns/`)

This directory stores official `@spin` / `@apply` white-box declarative pattern packages (`.jnp`) for **Spinning Jenny**:

* **[`fsm/state_machine.jnp`](./fsm/state_machine.jnp)** (`@spin dsl { state_machine ... }` / `@apply(fsm::state_machine)`): Finite state machine transition validation, event dispatch, and state invariant synthesis (see `B19_spin_fsm_order`).
* **[`codec/binary.jnp`](./codec/binary.jnp)** (`@apply(codec::binary)`): Big-endian binary frame header encoding/decoding and structural length check synthesis (see `B20_spin_binary_codec`).
* **[`crud/service.jnp`](./crud/service.jnp)** (`@spin dsl { crud_service ... }` / `@apply(crud::service)`): Entity CRUD service interface and transactional state update template synthesis (see `B21_spin_crud_service`).

All `.jnp` pattern definitions are loaded dynamically by the compiler (`compiler/src/flow/blueprint.ts` and `compiler/src/flow/spin.ts`) and materialized into `.spun/<module>.spun.jn` for white-box inspection and debugging.
