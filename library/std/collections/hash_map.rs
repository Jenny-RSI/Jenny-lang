// Rust `hashbrown` / Open-Addressing `HashMap<i64, i64>` Equivalent Baseline (`std::collections::hash_map`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MapError {
    KeyNotFound,
    CapacityOverflow,
}

impl From<MemError> for MapError {
    fn from(_: MemError) -> Self {
        MapError::CapacityOverflow
    }
}

pub struct HashMap {
    buf: RawBuf,
    cap: isize,
    len: isize,
    tombstones: isize,
}

impl HashMap {
    pub fn new() -> Self {
        Self {
            buf: RawBuf::new(0).unwrap(),
            cap: 0,
            len: 0,
            tombstones: 0,
        }
    }

    pub fn with_capacity(initial_cap: isize) -> Result<Self, MapError> {
        if !(0..=262_144).contains(&initial_cap) {
            return Err(MapError::CapacityOverflow);
        }
        let buf = RawBuf::new(initial_cap * 3)?;
        Ok(Self {
            buf,
            cap: initial_cap,
            len: 0,
            tombstones: 0,
        })
    }

    pub fn len(&self) -> isize {
        self.len
    }

    pub fn capacity(&self) -> isize {
        self.cap
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn rehash_to(&mut self, new_cap: isize) -> Result<isize, MapError> {
        if !(8..=262_144).contains(&new_cap) || self.len * 4 > new_cap * 3 {
            return Err(MapError::CapacityOverflow);
        }
        let mut new_buf = RawBuf::new(new_cap * 3)?;
        for b in 0..self.cap {
            let st = self.buf.read_at(b * 3)?;
            if st == 1 {
                let k = self.buf.read_at(b * 3 + 1)?;
                let v = self.buf.read_at(b * 3 + 2)?;
                let mut idx = (((k.wrapping_mul(1_103_515_245).wrapping_add(12_345)) % new_cap as i64
                    + new_cap as i64)
                    % new_cap as i64) as isize;
                loop {
                    if new_buf.read_at(idx * 3)? == 0 {
                        new_buf.write_at(idx * 3, 1)?;
                        new_buf.write_at(idx * 3 + 1, k)?;
                        new_buf.write_at(idx * 3 + 2, v)?;
                        break;
                    }
                    idx = (idx + 1) % new_cap;
                }
            }
        }
        self.buf.release();
        self.buf = new_buf;
        self.cap = new_cap;
        self.tombstones = 0;
        Ok(self.cap)
    }

    pub fn insert(&mut self, key: i64, val: i64) -> Result<isize, MapError> {
        if self.len >= 196_608 {
            return Err(MapError::CapacityOverflow);
        }
        if (self.len + self.tombstones + 1) * 4 > self.cap * 3 {
            let next_cap = if self.cap < 8 { 8 } else { self.cap * 2 };
            self.rehash_to(next_cap)?;
        }
        let mut idx = (((key.wrapping_mul(1_103_515_245).wrapping_add(12_345)) % self.cap as i64
            + self.cap as i64)
            % self.cap as i64) as isize;
        let mut first_tomb: isize = -1;
        for _ in 0..self.cap {
            let st = self.buf.read_at(idx * 3)?;
            if st == 0 {
                let target = if first_tomb >= 0 { first_tomb } else { idx };
                if first_tomb >= 0 {
                    self.tombstones -= 1;
                }
                self.buf.write_at(target * 3, 1)?;
                self.buf.write_at(target * 3 + 1, key)?;
                self.buf.write_at(target * 3 + 2, val)?;
                self.len += 1;
                return Ok(self.len);
            }
            if st == 1 {
                if self.buf.read_at(idx * 3 + 1)? == key {
                    self.buf.write_at(idx * 3 + 2, val)?;
                    return Ok(self.len);
                }
            } else if first_tomb < 0 {
                first_tomb = idx;
            }
            idx = (idx + 1) % self.cap;
        }
        Err(MapError::CapacityOverflow)
    }

    pub fn get(&self, key: i64) -> Result<i64, MapError> {
        if self.cap == 0 || self.len == 0 {
            return Err(MapError::KeyNotFound);
        }
        let mut idx = (((key.wrapping_mul(1_103_515_245).wrapping_add(12_345)) % self.cap as i64
            + self.cap as i64)
            % self.cap as i64) as isize;
        for _ in 0..self.cap {
            let st = self.buf.read_at(idx * 3)?;
            if st == 0 {
                return Err(MapError::KeyNotFound);
            }
            if st == 1 && self.buf.read_at(idx * 3 + 1)? == key {
                return Ok(self.buf.read_at(idx * 3 + 2)?);
            }
            idx = (idx + 1) % self.cap;
        }
        Err(MapError::KeyNotFound)
    }

    pub fn remove(&mut self, key: i64) -> Result<i64, MapError> {
        if self.len <= 0 {
            return Err(MapError::KeyNotFound);
        }
        let mut idx = (((key.wrapping_mul(1_103_515_245).wrapping_add(12_345)) % self.cap as i64
            + self.cap as i64)
            % self.cap as i64) as isize;
        for _ in 0..self.cap {
            let st = self.buf.read_at(idx * 3)?;
            if st == 0 {
                return Err(MapError::KeyNotFound);
            }
            if st == 1 && self.buf.read_at(idx * 3 + 1)? == key {
                let removed_v = self.buf.read_at(idx * 3 + 2)?;
                self.buf.write_at(idx * 3, 2)?;
                self.len -= 1;
                self.tombstones += 1;
                return Ok(removed_v);
            }
            idx = (idx + 1) % self.cap;
        }
        Err(MapError::KeyNotFound)
    }

    pub fn drop_map(&mut self) -> isize {
        self.buf.release();
        self.cap = 0;
        self.len = 0;
        self.tombstones = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_map_01_insert_rehash_update_and_tombstone_remove() {
        let mut m = HashMap::new();
        assert_eq!(m.insert(101, 1000).unwrap(), 1);
        assert_eq!(m.capacity(), 8);
        assert_eq!(m.insert(202, 2000).unwrap(), 2);
        assert_eq!(m.insert(303, 3000).unwrap(), 3);
        assert_eq!(m.insert(101, 1500).unwrap(), 3);
        assert_eq!(m.get(101).unwrap(), 1500);
        assert_eq!(m.remove(202).unwrap(), 2000);
        assert_eq!(m.len(), 2);
        assert_eq!(m.insert(404, 4000).unwrap(), 3);
        assert_eq!(m.get(404).unwrap(), 4000);
        assert_eq!(m.drop_map(), 0);
    }

    #[test]
    fn ex_std_map_02_reject_missing_key_lookup_and_remove() {
        let mut m = HashMap::with_capacity(8).unwrap();
        assert_eq!(m.get(999), Err(MapError::KeyNotFound));
        assert_eq!(m.insert(42, 84).unwrap(), 1);
        assert_eq!(m.remove(999), Err(MapError::KeyNotFound));
        assert_eq!(m.remove(42).unwrap(), 84);
        assert_eq!(m.get(42), Err(MapError::KeyNotFound));
        assert_eq!(m.drop_map(), 0);
    }
}

