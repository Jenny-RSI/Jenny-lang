#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsmError {
    InvalidTransition,
    AlreadyTerminal,
    InvalidAmount,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderStateMachine {
    pub order_id: i64,
    pub state: i32,
    pub version: usize,
    pub paid_cents: i64,
}

impl OrderStateMachine {
    pub fn check_invariant(&self) {
        assert!(self.state >= 0 && self.state <= 4);
        assert!(self.version >= 1);
        assert!(self.paid_cents >= 0);
    }

    pub fn new(order_id: i64) -> OrderStateMachine {
        let result = OrderStateMachine {
            order_id,
            state: 0,
            version: 1,
            paid_cents: 0,
        };
        result.check_invariant();
        assert!(result.state == 0);
        assert!(result.version == 1);
        result
    }

    pub fn pay(&mut self, amount_cents: i64) -> Result<(), FsmError> {
        self.check_invariant();
        if !(self.state == 0) {
            return Err(FsmError::InvalidTransition);
        }
        if !(amount_cents > 0) {
            return Err(FsmError::InvalidAmount);
        }
        let old_ver = self.version;
        self.state = 1;
        self.paid_cents = amount_cents;
        self.version += 1;
        self.check_invariant();
        assert!(self.state == 1);
        assert!(self.version == old_ver + 1);
        Ok(())
    }

    pub fn ship(&mut self) -> Result<(), FsmError> {
        self.check_invariant();
        if !(self.state == 1) {
            return Err(FsmError::InvalidTransition);
        }
        let old_ver = self.version;
        self.state = 2;
        self.version += 1;
        self.check_invariant();
        assert!(self.state == 2);
        assert!(self.version == old_ver + 1);
        Ok(())
    }

    pub fn deliver(&mut self) -> Result<(), FsmError> {
        self.check_invariant();
        if !(self.state == 2) {
            return Err(FsmError::InvalidTransition);
        }
        let old_ver = self.version;
        self.state = 3;
        self.version += 1;
        self.check_invariant();
        assert!(self.state == 3);
        assert!(self.version == old_ver + 1);
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<(), FsmError> {
        self.check_invariant();
        if !(self.state == 0 || self.state == 1) {
            return Err(FsmError::AlreadyTerminal);
        }
        let old_ver = self.version;
        self.state = 4;
        self.version += 1;
        self.check_invariant();
        assert!(self.state == 4);
        assert!(self.version == old_ver + 1);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b09_01_valid_lifecycle() {
        let mut fsm = OrderStateMachine::new(9001);
        assert_eq!(fsm.state, 0);

        fsm.pay(4500).unwrap();
        assert_eq!(fsm.state, 1);
        assert_eq!(fsm.version, 2);
        assert_eq!(fsm.paid_cents, 4500);

        fsm.ship().unwrap();
        assert_eq!(fsm.state, 2);
        assert_eq!(fsm.version, 3);

        fsm.deliver().unwrap();
        assert_eq!(fsm.state, 3);
        assert_eq!(fsm.version, 4);
    }

    #[test]
    fn ex_b09_02_reject_illegal_transitions() {
        let mut fsm = OrderStateMachine::new(9002);
        assert_eq!(fsm.ship(), Err(FsmError::InvalidTransition));

        fsm.pay(3000).unwrap();
        fsm.ship().unwrap();

        assert_eq!(fsm.cancel(), Err(FsmError::AlreadyTerminal));
        assert_eq!(fsm.state, 2);
    }
}
