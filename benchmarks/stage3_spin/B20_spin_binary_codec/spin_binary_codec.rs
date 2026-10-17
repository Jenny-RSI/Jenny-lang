// Rust 2021 Safe Idiomatic Baseline — B20: Binary Wire Codec (spin_binary_codec)
// Notice the explicit hand-written big-endian byte encoder/decoder, checksum computation,
// field validation, and error boilerplate required without `@apply(codec::binary)`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecError {
    BufferUnderflow,
    InvalidMagic,
    ChecksumMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TelemetryPacket {
    pub magic: i64,
    pub version: i64,
    pub seq_id: i64,
    pub payload_len: i64,
    pub checksum: i64,
}

impl TelemetryPacket {
    pub const EXPECTED_MAGIC: i64 = 43981;
    pub const WIRE_HEADER_BYTES: usize = 40;

    #[inline]
    fn assert_invariants(&self) {
        debug_assert!(self.version >= 1);
        debug_assert!(self.payload_len >= 0 && self.payload_len <= 4096);
    }

    pub fn new(seq_id: i64, payload_len: i64) -> Self {
        let mut pkt = Self {
            magic: Self::EXPECTED_MAGIC,
            version: 1,
            seq_id,
            payload_len,
            checksum: 0,
        };
        pkt.checksum = pkt.compute_checksum();
        pkt.assert_invariants();
        debug_assert!(pkt.magic == 43981 && pkt.version == 1);
        pkt
    }

    pub fn wire_size(&self) -> i64 {
        self.assert_invariants();
        Self::WIRE_HEADER_BYTES as i64
    }

    pub fn compute_checksum(&self) -> i64 {
        let raw = self.magic * 31 + self.version * 17 + self.seq_id * 13 + self.payload_len * 7;
        let csum = ((raw % 65536) + 65536) % 65536;
        debug_assert!(csum >= 0 && csum < 65536);
        csum
    }

    pub fn to_wire_bytes(&self) -> Result<[u8; 40], CodecError> {
        self.assert_invariants();
        if self.magic != Self::EXPECTED_MAGIC {
            return Err(CodecError::InvalidMagic);
        }
        if self.payload_len < 0 || self.payload_len > 4096 {
            return Err(CodecError::BufferUnderflow);
        }
        if self.checksum != self.compute_checksum() {
            return Err(CodecError::ChecksumMismatch);
        }
        let mut buf = [0u8; 40];
        buf[0..8].copy_from_slice(&self.magic.to_be_bytes());
        buf[8..16].copy_from_slice(&self.version.to_be_bytes());
        buf[16..24].copy_from_slice(&self.seq_id.to_be_bytes());
        buf[24..32].copy_from_slice(&self.payload_len.to_be_bytes());
        buf[32..40].copy_from_slice(&self.checksum.to_be_bytes());
        Ok(buf)
    }

    pub fn from_wire_bytes(buf: &[u8]) -> Result<Self, CodecError> {
        if buf.len() < Self::WIRE_HEADER_BYTES {
            return Err(CodecError::BufferUnderflow);
        }
        let raw_magic = i64::from_be_bytes(buf[0..8].try_into().unwrap());
        let raw_version = i64::from_be_bytes(buf[8..16].try_into().unwrap());
        let seq_id = i64::from_be_bytes(buf[16..24].try_into().unwrap());
        let payload_len = i64::from_be_bytes(buf[24..32].try_into().unwrap());
        let raw_checksum = i64::from_be_bytes(buf[32..40].try_into().unwrap());
        Self::decode_header(raw_magic, raw_version, seq_id, payload_len, raw_checksum)
    }

    pub fn encode_digest(&self) -> Result<i64, CodecError> {
        let _wire = self.to_wire_bytes()?;
        let digest = self.seq_id * 10000 + self.payload_len;
        debug_assert!(digest == self.seq_id * 10000 + self.payload_len);
        Ok(digest)
    }

    pub fn decode_header(
        raw_magic: i64,
        raw_version: i64,
        seq_id: i64,
        payload_len: i64,
        raw_checksum: i64,
    ) -> Result<Self, CodecError> {
        if raw_magic != Self::EXPECTED_MAGIC {
            return Err(CodecError::InvalidMagic);
        }
        if raw_version < 1 || payload_len < 0 || payload_len > 4096 {
            return Err(CodecError::BufferUnderflow);
        }
        let candidate = Self {
            magic: raw_magic,
            version: raw_version,
            seq_id,
            payload_len,
            checksum: raw_checksum,
        };
        if candidate.compute_checksum() != raw_checksum {
            return Err(CodecError::ChecksumMismatch);
        }
        candidate.assert_invariants();
        Ok(candidate)
    }
}

pub fn verify_packet_roundtrip(seq_id: i64, payload_len: i64) -> Result<i64, CodecError> {
    if seq_id < 0 || payload_len < 0 || payload_len > 4096 {
        return Err(CodecError::BufferUnderflow);
    }
    let pkt = TelemetryPacket::new(seq_id, payload_len);
    let wire = pkt.to_wire_bytes()?;
    let decoded = TelemetryPacket::from_wire_bytes(&wire)?;
    let digest = decoded.encode_digest()?;
    let result = digest + decoded.wire_size();
    debug_assert!(result == seq_id * 10000 + payload_len + 40);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b20_01_synthesize_binary_codec_and_roundtrip() {
        let digest = verify_packet_roundtrip(7, 256).unwrap();
        assert_eq!(digest, 70296);

        let pkt = TelemetryPacket::new(12, 512);
        assert_eq!(pkt.wire_size(), 40);
        let decoded = TelemetryPacket::decode_header(43981, 1, 12, 512, pkt.checksum).unwrap();
        assert_eq!(decoded.encode_digest().unwrap(), 120512);
    }

    #[test]
    fn ex_b20_02_reject_invalid_magic_checksum_and_underflow() {
        let pkt = TelemetryPacket::new(3, 128);
        assert_eq!(
            TelemetryPacket::decode_header(999, 1, 3, 128, pkt.checksum),
            Err(CodecError::InvalidMagic)
        );
        assert_eq!(
            TelemetryPacket::decode_header(43981, 1, 3, 128, pkt.checksum + 1),
            Err(CodecError::ChecksumMismatch)
        );
        assert_eq!(
            verify_packet_roundtrip(3, 8192),
            Err(CodecError::BufferUnderflow)
        );
    }
}
