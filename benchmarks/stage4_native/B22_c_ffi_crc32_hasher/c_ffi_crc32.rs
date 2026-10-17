#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FfiError {
    EmptyInput,
    InvalidSeed,
    PrefixMismatch,
    ContractViolation(&'static str),
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrcPacket {
    pub checksum: i64,
    pub byte_len: i64,
    pub seed_used: i64,
}

impl CrcPacket {
    pub fn check_invariant(&self) -> Result<(), FfiError> {
        if self.byte_len < 0 {
            return Err(FfiError::ContractViolation("invariant self.byte_len >= 0"));
        }
        Ok(())
    }
}

extern "C" {
    fn jenny_c_crc32(ptr: *const u8, len: i64, seed: i64) -> i64;
    fn jenny_c_memcmp_prefix(a: *const u8, b: *const u8, n: i64) -> i64;
}

pub fn compute_packet_crc(payload: &str, seed: i64) -> Result<CrcPacket, FfiError> {
    if payload.is_empty() {
        return Err(FfiError::EmptyInput);
    }
    if seed < 0 {
        return Err(FfiError::InvalidSeed);
    }
    let len = payload.len() as i64;
    let crc = unsafe { jenny_c_crc32(payload.as_ptr(), len, seed) };
    let result = CrcPacket {
        checksum: crc,
        byte_len: len,
        seed_used: seed,
    };
    result.check_invariant()?;
    if result.byte_len != len {
        return Err(FfiError::ContractViolation("ensures result.byte_len == payload.len()"));
    }
    if result.checksum <= 0 {
        return Err(FfiError::ContractViolation("ensures result.checksum > 0"));
    }
    Ok(result)
}

pub fn verify_prefix_and_hash(
    payload: &str,
    expected_prefix: &str,
    seed: i64,
) -> Result<i64, FfiError> {
    if payload.len() < expected_prefix.len() {
        return Err(FfiError::PrefixMismatch);
    }
    if expected_prefix.is_empty() {
        return Err(FfiError::EmptyInput);
    }
    if seed < 0 {
        return Err(FfiError::InvalidSeed);
    }
    let cmp = unsafe {
        jenny_c_memcmp_prefix(
            payload.as_ptr(),
            expected_prefix.as_ptr(),
            expected_prefix.len() as i64,
        )
    };
    if cmp != 0 {
        return Err(FfiError::PrefixMismatch);
    }
    let pkt = compute_packet_crc(payload, seed)?;
    let result = pkt.checksum;
    if result <= 0 {
        return Err(FfiError::ContractViolation("ensures result > 0"));
    }
    Ok(result)
}
