// Rust `alloc::collections::VecDeque<i64>` Equivalent Baseline (`std::collections::vec_deque`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DequeError {
    EmptyDeque,
    IndexOutOfBounds,
    CapacityOverflow,
}

impl From<MemError> for DequeError {
    fn from(e: MemError) -> Self {
        match e {
            MemError::OutOfBounds | MemError::InvalidCopyRange => DequeError::IndexOutOfBounds,
            MemError::CapacityOverflow => DequeError::CapacityOverflow,
        }
    }
}

pub struct VecDeque {
    buf: RawBuf,
    head: isize,
    len: isize,
}

impl VecDeque {
    pub fn new() -> Self {
        Self {
            buf: RawBuf::new(0).unwrap(),
            head: 0,
            len: 0,
        }
    }

    pub fn with_capacity(cap: isize) -> Result<Self, DequeError> {
        let buf = RawBuf::new(cap)?;
        Ok(Self {
            buf,
            head: 0,
            len: 0,
        })
    }

    pub fn len(&self) -> isize {
        self.len
    }

    pub fn capacity(&self) -> isize {
        self.buf.capacity()
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn grow_ring(&mut self) -> Result<isize, DequeError> {
        let old_cap = self.buf.capacity();
        if old_cap >= 1_048_576 {
            return Err(DequeError::CapacityOverflow);
        }
        let new_cap = if old_cap == 0 { 4 } else { old_cap * 2 };
        let mut new_buf = RawBuf::new(new_cap)?;
        for i in 0..self.len {
            let phys = (self.head + i) % old_cap;
            let item = self.buf.read_at(phys)?;
            new_buf.write_at(i, item)?;
        }
        self.buf.release();
        self.buf = new_buf;
        self.head = 0;
        Ok(self.buf.capacity())
    }

    pub fn push_back(&mut self, val: i64) -> Result<isize, DequeError> {
        if self.len >= 1_048_576 {
            return Err(DequeError::CapacityOverflow);
        }
        if self.len == self.buf.capacity() {
            self.grow_ring()?;
        }
        let phys = (self.head + self.len) % self.buf.capacity();
        self.buf.write_at(phys, val)?;
        self.len += 1;
        Ok(self.len)
    }

    pub fn push_front(&mut self, val: i64) -> Result<isize, DequeError> {
        if self.len >= 1_048_576 {
            return Err(DequeError::CapacityOverflow);
        }
        if self.len == self.buf.capacity() {
            self.grow_ring()?;
        }
        let cap = self.buf.capacity();
        self.head = (self.head + cap - 1) % cap;
        self.buf.write_at(self.head, val)?;
        self.len += 1;
        Ok(self.len)
    }

    pub fn pop_front(&mut self) -> Result<i64, DequeError> {
        if self.len <= 0 {
            return Err(DequeError::EmptyDeque);
        }
        let item = self.buf.read_at(self.head)?;
        self.head = (self.head + 1) % self.buf.capacity();
        self.len -= 1;
        if self.len == 0 {
            self.head = 0;
        }
        Ok(item)
    }

    pub fn pop_back(&mut self) -> Result<i64, DequeError> {
        if self.len <= 0 {
            return Err(DequeError::EmptyDeque);
        }
        let phys = (self.head + self.len - 1) % self.buf.capacity();
        let item = self.buf.read_at(phys)?;
        self.len -= 1;
        if self.len == 0 {
            self.head = 0;
        }
        Ok(item)
    }

    pub fn get(&self, logical_idx: isize) -> Result<i64, DequeError> {
        if logical_idx < 0 || logical_idx >= self.len {
            return Err(DequeError::IndexOutOfBounds);
        }
        let phys = (self.head + logical_idx) % self.buf.capacity();
        Ok(self.buf.read_at(phys)?)
    }

    pub fn clear(&mut self) -> isize {
        self.head = 0;
        self.len = 0;
        0
    }

    pub fn drop_deque(&mut self) -> isize {
        self.buf.release();
        self.head = 0;
        self.len = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_deque_01_wrap_around_push_front_back_and_unroll() {
        let mut dq = VecDeque::with_capacity(4).unwrap();
        assert_eq!(dq.push_back(20).unwrap(), 1);
        assert_eq!(dq.push_back(30).unwrap(), 2);
        assert_eq!(dq.push_front(10).unwrap(), 3);
        assert_eq!(dq.push_front(5).unwrap(), 4);
        assert_eq!(dq.push_back(40).unwrap(), 5);
        assert_eq!(dq.capacity(), 8);
        assert_eq!(dq.get(0).unwrap(), 5);
        assert_eq!(dq.get(1).unwrap(), 10);
        assert_eq!(dq.get(4).unwrap(), 40);
        assert_eq!(dq.pop_front().unwrap(), 5);
        assert_eq!(dq.pop_back().unwrap(), 40);
        assert_eq!(dq.len(), 3);
        assert_eq!(dq.drop_deque(), 0);
    }

    #[test]
    fn ex_std_deque_02_reject_empty_pop_and_oob() {
        let mut dq = VecDeque::new();
        assert_eq!(dq.pop_front(), Err(DequeError::EmptyDeque));
        assert_eq!(dq.pop_back(), Err(DequeError::EmptyDeque));
        assert_eq!(dq.push_back(77).unwrap(), 1);
        assert_eq!(dq.get(1), Err(DequeError::IndexOutOfBounds));
        assert_eq!(dq.get(-1), Err(DequeError::IndexOutOfBounds));
        assert_eq!(dq.drop_deque(), 0);
    }
}

