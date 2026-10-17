pub trait KvEngine {
    fn read_slot(&self, slot: i64) -> i64;
    fn write_slot(&mut self, slot: i64, val_data: i64);
    fn capacity(&self) -> i64;
    fn checksum(&self) -> i64;
    fn reset_all(&mut self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemKvStore {
    pub s0: i64,
    pub s1: i64,
    pub s2: i64,
    pub s3: i64,
    pub writes: i64,
}

impl MemKvStore {
    pub fn check_invariant(&self) {
        assert!(self.writes >= 0);
    }

    pub fn new(s0: i64, s1: i64, s2: i64, s3: i64) -> Self {
        let res = Self {
            s0,
            s1,
            s2,
            s3,
            writes: 0,
        };
        res.check_invariant();
        assert!(res.writes == 0);
        res
    }
}

impl KvEngine for MemKvStore {
    fn read_slot(&self, slot: i64) -> i64 {
        self.check_invariant();
        match slot {
            0 => self.s0,
            1 => self.s1,
            2 => self.s2,
            _ => self.s3,
        }
    }

    fn write_slot(&mut self, slot: i64, val_data: i64) {
        self.check_invariant();
        let old_writes = self.writes;
        self.writes += 1;
        if slot == 0 {
            self.s0 = val_data;
        } else if slot == 1 {
            self.s1 = val_data;
        } else if slot == 2 {
            self.s2 = val_data;
        } else {
            self.s3 = val_data;
        }
        self.check_invariant();
        assert!(self.writes == old_writes + 1);
    }

    fn capacity(&self) -> i64 {
        self.check_invariant();
        let result = 4;
        assert!(result == 4);
        result
    }

    fn checksum(&self) -> i64 {
        self.check_invariant();
        self.s0 + self.s1 + self.s2 + self.s3
    }

    fn reset_all(&mut self) {
        self.check_invariant();
        self.s0 = 0;
        self.s1 = 0;
        self.s2 = 0;
        self.s3 = 0;
        self.check_invariant();
        assert!(self.s0 == 0 && self.s1 == 0);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuditedKvDecorator {
    pub inner: MemKvStore,
    pub audit_reads: i64,
    pub audit_writes: i64,
}

impl AuditedKvDecorator {
    pub fn check_invariant(&self) {
        self.inner.check_invariant();
        assert!(self.audit_reads >= 0);
        assert!(self.audit_writes >= 0);
    }

    pub fn new(s0: i64, s1: i64, s2: i64, s3: i64) -> Self {
        let res = Self {
            inner: MemKvStore::new(s0, s1, s2, s3),
            audit_reads: 0,
            audit_writes: 0,
        };
        res.check_invariant();
        assert!(res.audit_reads == 0 && res.audit_writes == 0);
        res
    }

    pub fn read_slot_mut(&mut self, slot: i64) -> i64 {
        self.check_invariant();
        let old_reads = self.audit_reads;
        self.audit_reads += 1;
        let v = self.inner.read_slot(slot);
        self.check_invariant();
        assert!(self.audit_reads == old_reads + 1);
        v
    }
}

// Note: Rust has no built-in `delegate KvEngine to self.inner`; every single trait method
// must be manually forwarded by hand!
impl KvEngine for AuditedKvDecorator {
    fn read_slot(&self, slot: i64) -> i64 {
        self.check_invariant();
        self.inner.read_slot(slot)
    }

    fn write_slot(&mut self, slot: i64, val_data: i64) {
        self.check_invariant();
        let old_writes = self.audit_writes;
        self.audit_writes += 1;
        self.inner.write_slot(slot, val_data);
        self.check_invariant();
        assert!(self.audit_writes == old_writes + 1);
    }

    fn capacity(&self) -> i64 {
        self.check_invariant();
        self.inner.capacity()
    }

    fn checksum(&self) -> i64 {
        self.check_invariant();
        self.inner.checksum()
    }

    fn reset_all(&mut self) {
        self.check_invariant();
        self.inner.reset_all();
        self.check_invariant();
    }
}

pub fn inspect_engine_digest(engine: &dyn KvEngine) -> i64 {
    let result = engine.capacity() * 100 + engine.checksum();
    assert!(result >= 0);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b18_01_delegate_forwarding() {
        let mut dec = AuditedKvDecorator::new(10, 20, 30, 40);
        assert_eq!(dec.capacity(), 4);
        assert_eq!(dec.checksum(), 100);

        let v1 = dec.read_slot_mut(1);
        assert_eq!(v1, 20);
        assert_eq!(dec.audit_reads, 1);

        dec.write_slot(2, 90);
        assert_eq!(dec.audit_writes, 1);
        assert_eq!(dec.checksum(), 160);

        dec.reset_all();
        assert_eq!(dec.checksum(), 0);
    }

    #[test]
    fn ex_b18_02_dyn_polymorphic_dispatch() {
        let raw_store = MemKvStore::new(5, 15, 25, 35);
        let dec_store = AuditedKvDecorator::new(10, 20, 30, 40);

        let d1 = inspect_engine_digest(&raw_store);
        let d2 = inspect_engine_digest(&dec_store);
        assert_eq!(d1, 480);
        assert_eq!(d2, 500);
    }
}
