#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecError {
    BufferUnderflow,
    InvalidMagic,
    ChecksumMismatch,
    InvalidKey,
    ContractViolation(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WalPacket {
    pub magic: i64,
    pub version: i64,
    pub seq_id: i64,
    pub payload_len: i64,
    pub checksum: i64,
}

impl WalPacket {
    pub fn check_invariant(&self) -> Result<(), CodecError> {
        if self.version < 1 {
            return Err(CodecError::ContractViolation("invariant self.version >= 1"));
        }
        if self.payload_len < 0 || self.payload_len > 4096 {
            return Err(CodecError::ContractViolation(
                "invariant self.payload_len >= 0 && self.payload_len <= 4096",
            ));
        }
        Ok(())
    }

    pub fn new(seq_id: i64, payload_len: i64) -> Self {
        let csum = ((43981 * 31 + 17 + seq_id * 13 + payload_len * 7) % 65536 + 65536) % 65536;
        Self {
            magic: 43981,
            version: 1,
            seq_id,
            payload_len,
            checksum: csum,
        }
    }

    pub fn wire_size(&self) -> i64 {
        40
    }

    pub fn compute_checksum(&self) -> i64 {
        ((self.magic * 31 + self.version * 17 + self.seq_id * 13 + self.payload_len * 7) % 65536
            + 65536)
            % 65536
    }

    pub fn encode_digest(&self) -> Result<i64, CodecError> {
        if self.magic != 43981 {
            return Err(CodecError::InvalidMagic);
        }
        if self.payload_len < 0 || self.payload_len > 4096 {
            return Err(CodecError::BufferUnderflow);
        }
        if self.checksum != self.compute_checksum() {
            return Err(CodecError::ChecksumMismatch);
        }
        self.check_invariant()?;
        Ok(self.seq_id * 10000 + self.payload_len)
    }

    pub fn decode_header(
        raw_magic: i64,
        raw_version: i64,
        seq_id: i64,
        payload_len: i64,
        raw_checksum: i64,
    ) -> Result<Self, CodecError> {
        if raw_magic != 43981 {
            return Err(CodecError::InvalidMagic);
        }
        if raw_version < 1 || payload_len < 0 || payload_len > 4096 {
            return Err(CodecError::BufferUnderflow);
        }
        let expected = ((raw_magic * 31 + raw_version * 17 + seq_id * 13 + payload_len * 7)
            % 65536
            + 65536)
            % 65536;
        if raw_checksum != expected {
            return Err(CodecError::ChecksumMismatch);
        }
        let pkt = Self {
            magic: raw_magic,
            version: raw_version,
            seq_id,
            payload_len,
            checksum: raw_checksum,
        };
        pkt.check_invariant()?;
        Ok(pkt)
    }
}

pub trait KvBackend {
    fn write_wal(&mut self, seq_id: i64, payload_len: i64) -> Result<i64, CodecError>;
    fn total_bytes(&self) -> i64;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemKvBackend {
    pub entry_count: i64,
    pub bytes_written: i64,
}

impl MemKvBackend {
    pub fn check_invariant(&self) -> Result<(), CodecError> {
        if self.entry_count < 0 || self.bytes_written < 0 {
            return Err(CodecError::ContractViolation(
                "invariant self.entry_count >= 0 && self.bytes_written >= 0",
            ));
        }
        Ok(())
    }

    pub fn new() -> Self {
        Self {
            entry_count: 0,
            bytes_written: 0,
        }
    }
}

impl KvBackend for MemKvBackend {
    fn write_wal(&mut self, seq_id: i64, payload_len: i64) -> Result<i64, CodecError> {
        let pkt = WalPacket::new(seq_id, payload_len);
        let _digest = pkt.encode_digest()?;
        self.entry_count += 1;
        self.bytes_written += pkt.wire_size();
        self.check_invariant()?;
        Ok(self.bytes_written)
    }

    fn total_bytes(&self) -> i64 {
        self.bytes_written
    }
}

pub struct AuditedKvEngine {
    pub inner: MemKvBackend,
    pub audit_calls: i64,
}

impl AuditedKvEngine {
    pub fn check_invariant(&self) -> Result<(), CodecError> {
        if self.audit_calls < 0 {
            return Err(CodecError::ContractViolation("invariant self.audit_calls >= 0"));
        }
        self.inner.check_invariant()
    }

    pub fn new() -> Self {
        Self {
            inner: MemKvBackend::new(),
            audit_calls: 0,
        }
    }
}

impl KvBackend for AuditedKvEngine {
    fn write_wal(&mut self, seq_id: i64, payload_len: i64) -> Result<i64, CodecError> {
        self.inner.write_wal(seq_id, payload_len)
    }

    fn total_bytes(&self) -> i64 {
        self.inner.total_bytes()
    }
}

pub fn replicate_and_verify_wal(
    engine: &mut AuditedKvEngine,
    seq_id: i64,
    payload_len: i64,
) -> Result<i64, CodecError> {
    if seq_id <= 0 {
        return Err(CodecError::InvalidKey);
    }
    engine.audit_calls += 1;
    let total = engine.write_wal(seq_id, payload_len)?;
    engine.check_invariant()?;
    if total < 40 {
        return Err(CodecError::ContractViolation("ensures result >= 40"));
    }
    Ok(total)
}
