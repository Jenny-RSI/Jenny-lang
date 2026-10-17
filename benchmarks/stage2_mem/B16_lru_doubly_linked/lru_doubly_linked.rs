use std::cell::RefCell;
use std::rc::{Rc, Weak};

pub type NodeHandle = Rc<RefCell<LruNode>>;

#[derive(Debug)]
pub struct LruNode {
    pub key: i64,
    pub value: i64,
    pub prev: Option<Weak<RefCell<LruNode>>>,
    pub next: Option<NodeHandle>,
}

impl LruNode {
    pub fn check_invariant(&self) {
        assert!(self.key >= 0);
    }
}

pub fn spawn_lru_node(key: i64, value: i64) -> NodeHandle {
    assert!(key >= 0);
    let node = LruNode {
        key,
        value,
        prev: None,
        next: None,
    };
    node.check_invariant();
    Rc::new(RefCell::new(node))
}

pub fn link_two_nodes(first: &NodeHandle, second: &NodeHandle) {
    assert!(first.borrow().key != second.borrow().key);
    first.borrow().check_invariant();
    second.borrow().check_invariant();
    first.borrow_mut().next = Some(Rc::clone(second));
    second.borrow_mut().prev = Some(Rc::downgrade(first));
    first.borrow().check_invariant();
    second.borrow().check_invariant();
}

pub fn sum_linked_pair(head: &NodeHandle) -> i64 {
    let head_ref = head.borrow();
    head_ref.check_invariant();
    let base = head_ref.value;
    match &head_ref.next {
        Some(nxt_rc) => {
            let nxt_ref = nxt_rc.borrow();
            nxt_ref.check_invariant();
            let back_val = nxt_ref
                .prev
                .as_ref()
                .and_then(|w| w.upgrade())
                .map(|p| p.borrow().value)
                .unwrap_or(0);
            base + nxt_ref.value + back_val
        }
        None => base,
    }
}

pub fn run_lru_cycle_demo(k1: i64, v1: i64, k2: i64, v2: i64) -> i64 {
    assert!(k1 >= 0 && k2 >= 0 && k1 != k2);
    let n1 = spawn_lru_node(k1, v1);
    let n2 = spawn_lru_node(k2, v2);
    link_two_nodes(&n1, &n2);
    let result = sum_linked_pair(&n1);
    assert!(result == v1 + v2 + v1);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b16_01_cyclic_doubly_linked_pointers() {
        let a = spawn_lru_node(10, 100);
        let b = spawn_lru_node(20, 250);
        link_two_nodes(&a, &b);

        let total = sum_linked_pair(&a);
        assert_eq!(total, 450);
    }

    #[test]
    fn ex_b16_02_lru_cycle_demo() {
        let res = run_lru_cycle_demo(1, 40, 2, 60);
        assert_eq!(res, 140);
    }
}
