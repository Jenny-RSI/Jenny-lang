// Rust 2021 Safe Idiomatic Baseline — B19: Order Lifecycle State Machine (spin_fsm_order)
// Notice the explicit state/event enum boilerplate, conversion helpers,
// exhaustive match tables, guard checks, and invariant assertions required
// in Rust compared to Jenny's declarative `@spin fsm::state_machine(OrderMachine)`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsmError {
    InvalidTransition,
    GuardRejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i64)]
pub enum OrderState {
    Draft = 0,
    Submitted = 1,
    Paid = 2,
    Shipped = 3,
    Delivered = 4,
    Cancelled = 5,
}

impl OrderState {
    pub fn from_code(code: i64) -> Result<Self, FsmError> {
        match code {
            0 => Ok(OrderState::Draft),
            1 => Ok(OrderState::Submitted),
            2 => Ok(OrderState::Paid),
            3 => Ok(OrderState::Shipped),
            4 => Ok(OrderState::Delivered),
            5 => Ok(OrderState::Cancelled),
            _ => Err(FsmError::InvalidTransition),
        }
    }

    pub fn to_code(self) -> i64 {
        self as i64
    }

    pub fn is_terminal_state(self) -> bool {
        matches!(self, OrderState::Delivered | OrderState::Cancelled)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i64)]
pub enum OrderEvent {
    Submit = 0,
    Pay = 1,
    Ship = 2,
    Deliver = 3,
    Cancel = 4,
}

impl OrderEvent {
    pub fn from_code(code: i64) -> Result<Self, FsmError> {
        match code {
            0 => Ok(OrderEvent::Submit),
            1 => Ok(OrderEvent::Pay),
            2 => Ok(OrderEvent::Ship),
            3 => Ok(OrderEvent::Deliver),
            4 => Ok(OrderEvent::Cancel),
            _ => Err(FsmError::InvalidTransition),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OrderMachine {
    pub state: i64,
    pub amount_cents: i64,
    pub transitions: i64,
}

impl OrderMachine {
    #[inline]
    pub fn check_invariant(&self) {
        debug_assert!(self.state >= 0 && self.state <= 5);
        debug_assert!(self.transitions >= 0);
    }

    pub fn new(amount_cents: i64) -> Self {
        let m = Self {
            state: OrderState::Draft.to_code(),
            amount_cents,
            transitions: 0,
        };
        m.check_invariant();
        debug_assert!(m.state == 0 && m.transitions == 0);
        m
    }

    pub fn can_fire(&self, ev: i64) -> bool {
        self.check_invariant();
        let Ok(st_enum) = OrderState::from_code(self.state) else {
            return false;
        };
        let Ok(ev_enum) = OrderEvent::from_code(ev) else {
            return false;
        };
        match (st_enum, ev_enum) {
            (OrderState::Draft, OrderEvent::Submit) => self.amount_cents > 0,
            (OrderState::Submitted, OrderEvent::Pay) => self.amount_cents > 0,
            (OrderState::Paid, OrderEvent::Ship) => true,
            (OrderState::Shipped, OrderEvent::Deliver) => true,
            (OrderState::Draft, OrderEvent::Cancel) => true,
            (OrderState::Submitted, OrderEvent::Cancel) => true,
            _ => false,
        }
    }

    pub fn step(&mut self, ev: i64) -> Result<i64, FsmError> {
        self.check_invariant();
        let old_transitions = self.transitions;
        let st_enum = OrderState::from_code(self.state)?;
        let ev_enum = OrderEvent::from_code(ev)?;
        let next_state = match (st_enum, ev_enum) {
            (OrderState::Draft, OrderEvent::Submit) => {
                if !(self.amount_cents > 0) {
                    return Err(FsmError::GuardRejected);
                }
                OrderState::Submitted
            }
            (OrderState::Submitted, OrderEvent::Pay) => {
                if !(self.amount_cents > 0) {
                    return Err(FsmError::GuardRejected);
                }
                OrderState::Paid
            }
            (OrderState::Paid, OrderEvent::Ship) => OrderState::Shipped,
            (OrderState::Shipped, OrderEvent::Deliver) => OrderState::Delivered,
            (OrderState::Draft, OrderEvent::Cancel) => OrderState::Cancelled,
            (OrderState::Submitted, OrderEvent::Cancel) => OrderState::Cancelled,
            _ => return Err(FsmError::InvalidTransition),
        };
        self.state = next_state.to_code();
        self.transitions += 1;
        self.check_invariant();
        debug_assert!(self.transitions == old_transitions + 1);
        Ok(self.state)
    }

    pub fn is_terminal(&self) -> bool {
        self.check_invariant();
        match OrderState::from_code(self.state) {
            Ok(st) => st.is_terminal_state(),
            Err(_) => false,
        }
    }
}

pub fn run_order_lifecycle(amount_cents: i64) -> Result<i64, FsmError> {
    if !(amount_cents > 0) {
        return Err(FsmError::GuardRejected);
    }
    let mut m = OrderMachine::new(amount_cents);
    m.step(OrderEvent::Submit as i64)?;
    m.step(OrderEvent::Pay as i64)?;
    m.step(OrderEvent::Ship as i64)?;
    let final_st = m.step(OrderEvent::Deliver as i64)?;
    let result = final_st * 100 + m.transitions;
    debug_assert!(result == 404);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b19_01_declarative_fsm_lifecycle() {
        let code = run_order_lifecycle(2500).unwrap();
        assert_eq!(code, 404);

        let mut m = OrderMachine::new(1200);
        assert!(m.can_fire(0));
        assert!(!m.can_fire(2));
        let st1 = m.step(0).unwrap();
        assert_eq!(st1, 1);
        let st5 = m.step(4).unwrap();
        assert_eq!(st5, 5);
        assert!(m.is_terminal());
    }

    #[test]
    fn ex_b19_02_reject_invalid_transitions_and_guards() {
        let mut m = OrderMachine::new(1200);
        assert_eq!(m.step(3), Err(FsmError::InvalidTransition));

        let mut zero_m = OrderMachine::new(0);
        assert_eq!(zero_m.step(0), Err(FsmError::GuardRejected));
    }
}
