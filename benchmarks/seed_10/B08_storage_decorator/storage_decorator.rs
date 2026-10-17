#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageError {
    QuotaExceeded,
    InvalidPayloadSize,
    InvalidQuota,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrackedStorage {
    pub quota_bytes: usize,
    pub used_bytes: usize,
    pub read_ops: usize,
    pub write_ops: usize,
}

impl TrackedStorage {
    pub fn check_invariant(&self) {
        assert!(self.quota_bytes > 0);
        assert!(self.used_bytes <= self.quota_bytes);
    }

    pub fn new(quota_bytes: usize) -> Result<TrackedStorage, StorageError> {
        if !(quota_bytes > 0) {
            return Err(StorageError::InvalidQuota);
        }
        let result = TrackedStorage {
            quota_bytes,
            used_bytes: 0,
            read_ops: 0,
            write_ops: 0,
        };
        result.check_invariant();
        assert!(result.used_bytes == 0);
        assert!(result.write_ops == 0);
        Ok(result)
    }

    pub fn write_block(&mut self, payload_bytes: usize) -> Result<usize, StorageError> {
        self.check_invariant();
        if !(payload_bytes > 0) {
            return Err(StorageError::InvalidPayloadSize);
        }
        if !(self.used_bytes + payload_bytes <= self.quota_bytes) {
            return Err(StorageError::QuotaExceeded);
        }
        let old_writes = self.write_ops;
        let old_used = self.used_bytes;
        self.used_bytes += payload_bytes;
        self.write_ops += 1;
        let result = self.used_bytes;
        self.check_invariant();
        assert!(self.write_ops == old_writes + 1);
        assert!(self.used_bytes == old_used + payload_bytes);
        Ok(result)
    }

    pub fn read_block(&mut self) -> usize {
        self.check_invariant();
        let old_reads = self.read_ops;
        self.read_ops += 1;
        let result = self.used_bytes;
        self.check_invariant();
        assert!(self.read_ops == old_reads + 1);
        assert!(result == self.used_bytes);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b08_01_storage_quota_and_telemetry() {
        let mut store = TrackedStorage::new(1024).unwrap();
        let u1 = store.write_block(256).unwrap();
        assert_eq!(u1, 256);
        assert_eq!(store.write_ops, 1);

        let u2 = store.write_block(512).unwrap();
        assert_eq!(u2, 768);
        assert_eq!(store.write_ops, 2);

        let r1 = store.read_block();
        assert_eq!(r1, 768);
        assert_eq!(store.read_ops, 1);
    }

    #[test]
    fn ex_b08_02_reject_quota_overflow() {
        let mut store = TrackedStorage::new(500).unwrap();
        store.write_block(400).unwrap();

        assert_eq!(store.write_block(200), Err(StorageError::QuotaExceeded));
        assert_eq!(store.used_bytes, 400);
        assert_eq!(store.write_block(0), Err(StorageError::InvalidPayloadSize));
    }
}
