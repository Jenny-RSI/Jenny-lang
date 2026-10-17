// Rust baseline for B25_closure_lifetimes
// Demonstrates Fn(&i64) -> i64 trait bounds, Box<dyn FnOnce(i64) -> i64>, and Rc<dyn Fn(i64) -> i64>

use std::rc::Rc;

#[derive(Debug, Clone)]
pub struct SignalBox {
    pub base_gain: i64,
    pub offset: i64,
}

impl SignalBox {
    pub fn check_invariant(&self) {
        assert!(self.base_gain > 0, "invariant violated: self.base_gain > 0");
    }
}

pub fn alloc_signal_box(base_gain: i64, offset: i64) -> Box<SignalBox> {
    assert!(base_gain > 0, "requires: base_gain > 0");
    let b = Box::new(SignalBox { base_gain, offset });
    b.check_invariant();
    b
}

pub fn apply_stack_pipeline<F>(x: i64, f: F) -> i64
where
    F: Fn(i64) -> i64,
{
    f(x) + f(x + 1)
}

pub fn run_stack_closure_demo(x: i64, factor: i64, bias: i64) -> i64 {
    let mapper = |v: i64| -> i64 { v * factor + bias };
    let result = apply_stack_pipeline(x, mapper);
    assert_eq!(result, (x * factor + bias) + ((x + 1) * factor + bias));
    result
}

pub fn make_unique_amplifier(sig: Box<SignalBox>, extra: i64) -> Box<dyn FnOnce(i64) -> i64> {
    sig.check_invariant();
    Box::new(move |v: i64| -> i64 {
        let out = v * sig.base_gain + sig.offset + extra;
        drop(sig);
        out
    })
}

pub fn consume_unique_amplifier(x: i64, amp: Box<dyn FnOnce(i64) -> i64>) -> i64 {
    amp(x)
}

pub fn make_shared_scorer(weight: i64, threshold: i64) -> Rc<dyn Fn(i64) -> i64> {
    Rc::new(move |v: i64| -> i64 { v * weight - threshold })
}

pub fn eval_shared_pair(x1: i64, x2: i64, scorer: &Rc<dyn Fn(i64) -> i64>) -> i64 {
    scorer(x1) + scorer(x2)
}
