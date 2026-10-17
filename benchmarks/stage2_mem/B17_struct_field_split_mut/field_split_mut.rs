#[derive(Debug, Clone, Copy)]
pub struct MotionController {
    pub pos_x: i64,
    pub vel_x: i64,
    pub max_speed: i64,
    pub ticks: i64,
}

impl MotionController {
    pub fn check_invariant(&self) {
        assert!(self.max_speed > 0);
        assert!(self.ticks >= 0);
    }

    pub fn new(pos_x: i64, vel_x: i64, max_speed: i64) -> Self {
        assert!(max_speed > 0);
        let ctrl = Self {
            pos_x,
            vel_x,
            max_speed,
            ticks: 0,
        };
        ctrl.check_invariant();
        assert!(ctrl.ticks == 0);
        ctrl
    }

    pub fn effective_delta(&self, scale: i64) -> i64 {
        self.check_invariant();
        assert!(scale >= 1 && scale <= 10);
        let raw = self.vel_x * scale;
        if raw > self.max_speed {
            self.max_speed
        } else if raw < -self.max_speed {
            -self.max_speed
        } else {
            raw
        }
    }

    pub fn apply_step(&mut self, delta: i64) -> i64 {
        self.check_invariant();
        let old_ticks = self.ticks;
        self.pos_x += delta;
        self.ticks += 1;
        self.check_invariant();
        assert!(self.ticks == old_ticks + 1);
        self.pos_x
    }

    // Note: In Rust, `self.apply_step(self.effective_delta(scale))` fails with:
    // error[E0502]: cannot borrow `*self` as immutable because it is also borrowed as mutable.
    // The programmer/LLM is forced to bind an intermediate variable `let d = self.effective_delta(scale);`.
    pub fn tick_with_scale(&mut self, scale: i64) -> i64 {
        self.check_invariant();
        assert!(scale >= 1 && scale <= 10);
        let old_ticks = self.ticks;
        let d = self.effective_delta(scale);
        let res = self.apply_step(d);
        self.check_invariant();
        assert!(self.ticks == old_ticks + 1);
        res
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b17_01_nested_mut_and_readonly_self_call() {
        let mut ctrl = MotionController::new(100, 15, 40);
        assert_eq!(ctrl.effective_delta(2), 30);

        let p1 = ctrl.tick_with_scale(2);
        assert_eq!(p1, 130);
        assert_eq!(ctrl.ticks, 1);

        let p2 = ctrl.tick_with_scale(5);
        assert_eq!(p2, 170);
        assert_eq!(ctrl.ticks, 2);
    }
}
