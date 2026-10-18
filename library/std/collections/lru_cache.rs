// Rust `lru::LruCache<i64, i64>` Equivalent Baseline (`std::collections::lru_cache`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LruError {
    KeyNotFound,
    InvalidCapacity,
}

impl From<MemError> for LruError {
    fn from(_: MemError) -> Self {
        LruError::KeyNotFound
    }
}

pub struct LruCache {
    buf: RawBuf,
    pub capacity: isize,
    pub len: isize,
    pub head: isize,
    pub tail: isize,
    pub mru_key: i64,
    pub hits: i64,
    pub misses: i64,
    pub evictions: i64,
}

impl LruCache {
    pub fn new(capacity: isize) -> Result<Self, LruError> {
        if !(1..=65_536).contains(&capacity) {
            return Err(LruError::InvalidCapacity);
        }
        let buf = RawBuf::new(capacity * 5).map_err(|_| LruError::InvalidCapacity)?;
        Ok(Self {
            buf,
            capacity,
            len: 0,
            head: -1,
            tail: -1,
            mru_key: 0,
            hits: 0,
            misses: 0,
            evictions: 0,
        })
    }

    pub fn len(&self) -> isize {
        self.len
    }

    pub fn promote_slot(&mut self, slot: isize) -> Result<isize, LruError> {
        if slot < 0 || slot >= self.len {
            return Err(LruError::KeyNotFound);
        }
        self.mru_key = self.buf.read_at(slot * 5 + 1)?;
        if self.head == slot {
            return Ok(slot);
        }
        let prev_s = self.buf.read_at(slot * 5 + 3)? as isize;
        let next_s = self.buf.read_at(slot * 5 + 4)? as isize;
        if prev_s >= 0 {
            self.buf.write_at(prev_s * 5 + 4, next_s as i64)?;
        }
        if next_s >= 0 {
            self.buf.write_at(next_s * 5 + 3, prev_s as i64)?;
        }
        if self.tail == slot {
            self.tail = prev_s;
        }
        self.buf.write_at(slot * 5 + 3, -1)?;
        self.buf.write_at(slot * 5 + 4, self.head as i64)?;
        if self.head >= 0 {
            self.buf.write_at(self.head * 5 + 3, slot as i64)?;
        }
        self.head = slot;
        if self.tail < 0 {
            self.tail = slot;
        }
        Ok(slot)
    }

    pub fn put(&mut self, key: i64, val: i64) -> Result<isize, LruError> {
        for s in 0..self.len {
            if self.buf.read_at(s * 5)? == 1 && self.buf.read_at(s * 5 + 1)? == key {
                self.buf.write_at(s * 5 + 2, val)?;
                self.promote_slot(s)?;
                return Ok(self.len);
            }
        }
        if self.len < self.capacity {
            let new_s = self.len;
            self.buf.write_at(new_s * 5, 1)?;
            self.buf.write_at(new_s * 5 + 1, key)?;
            self.buf.write_at(new_s * 5 + 2, val)?;
            self.buf.write_at(new_s * 5 + 3, -1)?;
            self.buf.write_at(new_s * 5 + 4, self.head as i64)?;
            if self.head >= 0 {
                self.buf.write_at(self.head * 5 + 3, new_s as i64)?;
            }
            self.head = new_s;
            if self.tail < 0 {
                self.tail = new_s;
            }
            self.len += 1;
            self.mru_key = key;
            return Ok(self.len);
        }
        let evict_s = self.tail;
        self.evictions += 1;
        self.buf.write_at(evict_s * 5 + 1, key)?;
        self.buf.write_at(evict_s * 5 + 2, val)?;
        self.promote_slot(evict_s)?;
        Ok(self.len)
    }

    pub fn get_promote(&mut self, key: i64) -> Result<i64, LruError> {
        if self.len <= 0 {
            return Err(LruError::KeyNotFound);
        }
        for s in 0..self.len {
            if self.buf.read_at(s * 5)? == 1 && self.buf.read_at(s * 5 + 1)? == key {
                let v = self.buf.read_at(s * 5 + 2)?;
                self.hits += 1;
                self.promote_slot(s)?;
                return Ok(v);
            }
        }
        self.misses += 1;
        Err(LruError::KeyNotFound)
    }

    pub fn peek(&self, key: i64) -> Result<i64, LruError> {
        if self.len <= 0 {
            return Err(LruError::KeyNotFound);
        }
        for s in 0..self.len {
            if self.buf.read_at(s * 5)? == 1 && self.buf.read_at(s * 5 + 1)? == key {
                return Ok(self.buf.read_at(s * 5 + 2)?);
            }
        }
        Err(LruError::KeyNotFound)
    }

    pub fn drop_cache(&mut self) -> isize {
        self.buf.release();
        self.len = 0;
        self.head = -1;
        self.tail = -1;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_lru_01_mru_promotion_and_bounded_tail_eviction() {
        let mut cache = LruCache::new(3).unwrap();
        assert_eq!(cache.put(1, 100).unwrap(), 1);
        assert_eq!(cache.put(2, 200).unwrap(), 2);
        assert_eq!(cache.put(3, 300).unwrap(), 3);
        assert_eq!(cache.get_promote(1).unwrap(), 100);
        assert_eq!(cache.mru_key, 1);
        assert_eq!(cache.put(4, 400).unwrap(), 3);
        assert_eq!(cache.evictions, 1);
        assert_eq!(cache.peek(1).unwrap(), 100);
        assert_eq!(cache.peek(3).unwrap(), 300);
        assert_eq!(cache.peek(4).unwrap(), 400);
        assert_eq!(cache.drop_cache(), 0);
    }

    #[test]
    fn ex_std_lru_02_reject_invalid_capacity_and_missing_key() {
        assert!(LruCache::new(0).is_err());
        let mut cache = LruCache::new(2).unwrap();
        assert_eq!(cache.put(10, 1000).unwrap(), 1);
        assert_eq!(cache.put(20, 2000).unwrap(), 2);
        assert_eq!(cache.put(30, 3000).unwrap(), 2);
        assert_eq!(cache.get_promote(10), Err(LruError::KeyNotFound));
        assert_eq!(cache.misses, 1);
        assert_eq!(cache.drop_cache(), 0);
    }
}

