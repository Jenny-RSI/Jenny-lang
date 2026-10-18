// Rust Equivalent Baseline for `std::mem::arena` (`BumpArena` + Managed Immix Pool)

use std::cell::RefCell;
use std::rc::Rc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArenaError {
    OutOfMemory,
    InvalidRequest,
    InvalidWatermark,
}

pub struct BumpArena {
    pub capacity: i64,
    pub used: i64,
    pub allocs: i64,
    pub peak_used: i64,
}

impl BumpArena {
    pub fn new(capacity: i64) -> Result<Self, ArenaError> {
        if !(64..=16_777_216).contains(&capacity) {
            return Err(ArenaError::InvalidRequest);
        }
        Ok(Self {
            capacity,
            used: 0,
            allocs: 0,
            peak_used: 0,
        })
    }

    pub fn alloc_aligned(&mut self, size_bytes: i64) -> Result<i64, ArenaError> {
        if size_bytes <= 0 {
            return Err(ArenaError::InvalidRequest);
        }
        let rem = size_bytes % 8;
        let aligned = if rem == 0 { size_bytes } else { size_bytes + (8 - rem) };
        if self.used + aligned > self.capacity {
            return Err(ArenaError::OutOfMemory);
        }
        let offset = self.used;
        self.used += aligned;
        self.allocs += 1;
        if self.used > self.peak_used {
            self.peak_used = self.used;
        }
        Ok(offset)
    }

    pub fn checkpoint(&self) -> i64 {
        self.used
    }

    pub fn rollback(&mut self, watermark: i64) -> Result<i64, ArenaError> {
        if watermark < 0 || watermark > self.used {
            return Err(ArenaError::InvalidWatermark);
        }
        self.used = watermark;
        Ok(self.used)
    }

    pub fn reset(&mut self) -> i64 {
        self.used = 0;
        self.allocs = 0;
        self.peak_used
    }
}

pub struct ImmixNode {
    pub id: i64,
    pub payload: i64,
    pub next: Option<Rc<RefCell<ImmixNode>>>,
}

pub fn immix_spawn_node(
    id: i64,
    payload: i64,
    next: Option<Rc<RefCell<ImmixNode>>>,
) -> Rc<RefCell<ImmixNode>> {
    assert!(id >= 0);
    Rc::new(RefCell::new(ImmixNode { id, payload, next }))
}

pub fn immix_chain_sum(n1: &Rc<RefCell<ImmixNode>>, n2: &Rc<RefCell<ImmixNode>>, n3: &Rc<RefCell<ImmixNode>>) -> i64 {
    n1.borrow().payload + n2.borrow().payload + n3.borrow().payload
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_arena_01_bump_arena_checkpoint_rollback_and_immix() {
        let mut arena = BumpArena::new(256).unwrap();
        assert_eq!(arena.alloc_aligned(13).unwrap(), 0);
        assert_eq!(arena.used, 16);
        let mark = arena.checkpoint();
        assert_eq!(arena.alloc_aligned(20).unwrap(), 16);
        assert_eq!(arena.used, 40);
        assert_eq!(arena.rollback(mark).unwrap(), 16);
        assert_eq!(arena.peak_used, 40);
        assert_eq!(arena.reset(), 40);
        assert_eq!(arena.used, 0);

        let n1 = immix_spawn_node(1, 100, None);
        let n2 = immix_spawn_node(2, 250, Some(n1.clone()));
        let n3 = immix_spawn_node(3, 650, Some(n2.clone()));
        assert_eq!(immix_chain_sum(&n3, &n2, &n1), 1000);
    }

    #[test]
    fn ex_std_arena_02_reject_oom_and_invalid_watermark() {
        let mut arena = BumpArena::new(64).unwrap();
        assert_eq!(arena.alloc_aligned(48).unwrap(), 0);
        assert_eq!(arena.alloc_aligned(24), Err(ArenaError::OutOfMemory));
        assert_eq!(arena.rollback(56), Err(ArenaError::InvalidWatermark));
        assert_eq!(arena.rollback(-4), Err(ArenaError::InvalidWatermark));
    }
}

