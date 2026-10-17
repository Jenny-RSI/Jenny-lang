#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheError {
    KeyMismatch,
    EntryExpired,
    InvalidTtl,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CacheSlot {
    pub key: i64,
    pub value: i64,
    pub expires_at_ms: i64,
    pub last_access_ms: i64,
    pub hits: usize,
    pub misses: usize,
}

impl CacheSlot {
    pub fn check_invariant(&self) {
        assert!(self.expires_at_ms >= self.last_access_ms);
    }

    pub fn new(key: i64, value: i64, now_ms: i64, ttl_ms: i64) -> Result<CacheSlot, CacheError> {
        if !(now_ms >= 0) {
            return Err(CacheError::InvalidTtl);
        }
        if !(ttl_ms > 0) {
            return Err(CacheError::InvalidTtl);
        }
        let exp = now_ms + ttl_ms;
        let result = CacheSlot {
            key,
            value,
            expires_at_ms: exp,
            last_access_ms: now_ms,
            hits: 0,
            misses: 0,
        };
        result.check_invariant();
        assert!(result.hits == 0);
        assert!(result.expires_at_ms == now_ms + ttl_ms);
        Ok(result)
    }

    pub fn get(&mut self, query_key: i64, now_ms: i64) -> Result<i64, CacheError> {
        self.check_invariant();
        if !(query_key == self.key) {
            return Err(CacheError::KeyMismatch);
        }
        if !(now_ms <= self.expires_at_ms) {
            return Err(CacheError::EntryExpired);
        }
        let old_hits = self.hits;
        self.last_access_ms = now_ms;
        self.hits += 1;
        let result = self.value;
        self.check_invariant();
        assert!(self.hits == old_hits + 1);
        assert!(self.last_access_ms == now_ms);
        Ok(result)
    }

    pub fn refresh(&mut self, now_ms: i64, extra_ttl_ms: i64) -> Result<(), CacheError> {
        self.check_invariant();
        if !(extra_ttl_ms > 0) {
            return Err(CacheError::InvalidTtl);
        }
        if !(now_ms >= self.last_access_ms) {
            return Err(CacheError::InvalidTtl);
        }
        self.last_access_ms = now_ms;
        self.expires_at_ms = now_ms + extra_ttl_ms;
        self.check_invariant();
        assert!(self.expires_at_ms == now_ms + extra_ttl_ms);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b04_01_cache_hit_and_refresh() {
        let mut slot = CacheSlot::new(101, 9999, 1000, 500).unwrap();
        assert_eq!(slot.hits, 0);
        assert_eq!(slot.expires_at_ms, 1500);

        let v1 = slot.get(101, 1200).unwrap();
        assert_eq!(v1, 9999);
        assert_eq!(slot.hits, 1);
        assert_eq!(slot.last_access_ms, 1200);

        slot.refresh(1400, 600).unwrap();
        assert_eq!(slot.expires_at_ms, 2000);

        let v2 = slot.get(101, 1800).unwrap();
        assert_eq!(v2, 9999);
        assert_eq!(slot.hits, 2);
    }

    #[test]
    fn ex_b04_02_expired_and_mismatch() {
        let mut slot = CacheSlot::new(101, 9999, 1000, 500).unwrap();
        let miss_err = slot.get(202, 1100);
        assert_eq!(miss_err, Err(CacheError::KeyMismatch));

        let exp_err = slot.get(101, 1600);
        assert_eq!(exp_err, Err(CacheError::EntryExpired));
    }
}
