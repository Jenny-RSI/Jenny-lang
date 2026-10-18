// Rust `alloc::vec::Vec<i64>` Equivalent Baseline (`std::collections::vec`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VecError {
    EmptyVec,
    IndexOutOfBounds,
    CapacityOverflow,
}

impl From<MemError> for VecError {
    fn from(e: MemError) -> Self {
        match e {
            MemError::OutOfBounds | MemError::InvalidCopyRange => VecError::IndexOutOfBounds,
            MemError::CapacityOverflow => VecError::CapacityOverflow,
        }
    }
}

pub struct Vec {
    buf: RawBuf,
    len: isize,
}

impl Vec {
    pub fn new() -> Self {
        Self {
            buf: RawBuf::new(0).unwrap(),
            len: 0,
        }
    }

    pub fn with_capacity(cap: isize) -> Result<Self, VecError> {
        let buf = RawBuf::new(cap)?;
        Ok(Self { buf, len: 0 })
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

    pub fn reserve(&mut self, additional: isize) -> Result<isize, VecError> {
        if additional < 0 || self.len + additional > 1_048_576 {
            return Err(VecError::CapacityOverflow);
        }
        let needed = self.len + additional;
        if needed > self.buf.capacity() {
            self.buf.grow(needed)?;
        }
        Ok(self.buf.capacity())
    }

    pub fn push(&mut self, val: i64) -> Result<isize, VecError> {
        if self.len >= 1_048_576 {
            return Err(VecError::CapacityOverflow);
        }
        if self.len == self.buf.capacity() {
            self.buf.grow(self.len + 1)?;
        }
        self.buf.write_at(self.len, val)?;
        self.len += 1;
        Ok(self.len)
    }

    pub fn pop(&mut self) -> Result<i64, VecError> {
        if self.len <= 0 {
            return Err(VecError::EmptyVec);
        }
        self.len -= 1;
        let item = self.buf.read_at(self.len)?;
        Ok(item)
    }

    pub fn get(&self, idx: isize) -> Result<i64, VecError> {
        if idx < 0 || idx >= self.len {
            return Err(VecError::IndexOutOfBounds);
        }
        Ok(self.buf.read_at(idx)?)
    }

    pub fn set(&mut self, idx: isize, val: i64) -> Result<i64, VecError> {
        if idx < 0 || idx >= self.len {
            return Err(VecError::IndexOutOfBounds);
        }
        Ok(self.buf.write_at(idx, val)?)
    }

    pub fn insert_at(&mut self, idx: isize, val: i64) -> Result<isize, VecError> {
        if idx < 0 || idx > self.len {
            return Err(VecError::IndexOutOfBounds);
        }
        if self.len >= 1_048_576 {
            return Err(VecError::CapacityOverflow);
        }
        if self.len == self.buf.capacity() {
            self.buf.grow(self.len + 1)?;
        }
        let tail_count = self.len - idx;
        if tail_count > 0 {
            self.buf.copy_within(idx, idx + 1, tail_count)?;
        }
        self.buf.write_at(idx, val)?;
        self.len += 1;
        Ok(self.len)
    }

    pub fn remove_at(&mut self, idx: isize) -> Result<i64, VecError> {
        if idx < 0 || idx >= self.len {
            return Err(VecError::IndexOutOfBounds);
        }
        let removed = self.buf.read_at(idx)?;
        let tail_count = self.len - idx - 1;
        if tail_count > 0 {
            self.buf.copy_within(idx + 1, idx, tail_count)?;
        }
        self.len -= 1;
        Ok(removed)
    }

    pub fn clear(&mut self) -> isize {
        self.len = 0;
        0
    }

    pub fn drop_vec(&mut self) -> isize {
        self.buf.release();
        self.len = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_vec_01_push_doubling_insert_remove_pop_drop() {
        let mut v = Vec::new();
        assert_eq!(v.len(), 0);
        assert_eq!(v.capacity(), 0);
        assert_eq!(v.push(10).unwrap(), 1);
        assert_eq!(v.capacity(), 4);
        assert_eq!(v.push(20).unwrap(), 2);
        assert_eq!(v.push(40).unwrap(), 3);
        assert_eq!(v.insert_at(2, 30).unwrap(), 4);
        assert_eq!(v.push(50).unwrap(), 5);
        assert_eq!(v.capacity(), 8);
        assert_eq!(v.get(2).unwrap(), 30);
        assert_eq!(v.remove_at(1).unwrap(), 20);
        assert_eq!(v.len(), 4);
        assert_eq!(v.pop().unwrap(), 50);
        assert_eq!(v.drop_vec(), 0);
    }

    #[test]
    fn ex_std_vec_02_reject_empty_pop_and_oob() {
        let mut v = Vec::with_capacity(2).unwrap();
        assert_eq!(v.pop(), Err(VecError::EmptyVec));
        assert_eq!(v.push(99).unwrap(), 1);
        assert_eq!(v.get(1), Err(VecError::IndexOutOfBounds));
        assert_eq!(v.remove_at(1), Err(VecError::IndexOutOfBounds));
        assert_eq!(v.insert_at(3, 77), Err(VecError::IndexOutOfBounds));
        assert_eq!(v.drop_vec(), 0);
    }
}

