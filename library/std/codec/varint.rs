// Rust `prost::encoding::varint` Equivalent Baseline (`std::codec::varint`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodecError {
    UnexpectedEof,
    VarintOverflow,
    NegativeUnsigned,
    CapacityOverflow,
}

impl From<MemError> for CodecError {
    fn from(_: MemError) -> Self {
        CodecError::CapacityOverflow
    }
}

pub fn zigzag_encode(val: i64) -> Result<i64, CodecError> {
    if !(-1_000_000_000..=1_000_000_000).contains(&val) {
        return Err(CodecError::VarintOverflow);
    }
    if val >= 0 {
        Ok(val * 2)
    } else {
        Ok((-val) * 2 - 1)
    }
}

pub fn zigzag_decode(encoded: i64) -> Result<i64, CodecError> {
    if encoded < 0 {
        return Err(CodecError::NegativeUnsigned);
    }
    let half = encoded / 2;
    if encoded % 2 == 0 {
        Ok(half)
    } else {
        Ok(-(half + 1))
    }
}

pub struct VarintStream {
    buf: RawBuf,
    pub read_off: isize,
    pub write_off: isize,
}

impl VarintStream {
    pub fn with_capacity(cap: isize) -> Result<Self, CodecError> {
        if !(0..=1_048_576).contains(&cap) {
            return Err(CodecError::CapacityOverflow);
        }
        let buf = RawBuf::new(cap)?;
        Ok(Self {
            buf,
            read_off: 0,
            write_off: 0,
        })
    }

    pub fn unread_bytes(&self) -> isize {
        self.write_off - self.read_off
    }

    pub fn encode_u64(&mut self, val: i64) -> Result<isize, CodecError> {
        if val < 0 {
            return Err(CodecError::NegativeUnsigned);
        }
        if self.write_off + 10 > 1_048_576 {
            return Err(CodecError::CapacityOverflow);
        }
        if self.write_off + 10 > self.buf.capacity() {
            self.buf.grow(self.write_off + 10)?;
        }
        let start_off = self.write_off;
        let mut rem = val;
        while rem >= 128 {
            let low7 = (rem % 128) + 128;
            self.buf.write_at(self.write_off, low7)?;
            self.write_off += 1;
            rem /= 128;
        }
        self.buf.write_at(self.write_off, rem)?;
        self.write_off += 1;
        Ok(self.write_off - start_off)
    }

    pub fn decode_u64(&mut self) -> Result<i64, CodecError> {
        if self.read_off >= self.write_off {
            return Err(CodecError::UnexpectedEof);
        }
        let mut acc: i64 = 0;
        let mut mult: i64 = 1;
        for _ in 0..9 {
            if self.read_off >= self.write_off {
                return Err(CodecError::UnexpectedEof);
            }
            let byte_val = self.buf.read_at(self.read_off)?;
            self.read_off += 1;
            if byte_val < 128 {
                acc += byte_val * mult;
                return Ok(acc);
            }
            acc += (byte_val - 128) * mult;
            mult *= 128;
        }
        Err(CodecError::VarintOverflow)
    }

    pub fn drop_stream(&mut self) -> isize {
        self.buf.release();
        self.read_off = 0;
        self.write_off = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_varint_01_leb128_roundtrip_and_zigzag() {
        assert_eq!(zigzag_encode(0).unwrap(), 0);
        assert_eq!(zigzag_encode(-1).unwrap(), 1);
        assert_eq!(zigzag_encode(1).unwrap(), 2);
        assert_eq!(zigzag_encode(-2).unwrap(), 3);
        assert_eq!(zigzag_decode(3).unwrap(), -2);

        let mut s = VarintStream::with_capacity(8).unwrap();
        assert_eq!(s.encode_u64(127).unwrap(), 1);
        assert_eq!(s.encode_u64(128).unwrap(), 2);
        assert_eq!(s.encode_u64(300).unwrap(), 2);
        assert_eq!(s.encode_u64(16384).unwrap(), 3);
        assert_eq!(s.unread_bytes(), 8);

        assert_eq!(s.decode_u64().unwrap(), 127);
        assert_eq!(s.decode_u64().unwrap(), 128);
        assert_eq!(s.decode_u64().unwrap(), 300);
        assert_eq!(s.decode_u64().unwrap(), 16384);
        assert_eq!(s.unread_bytes(), 0);
        assert_eq!(s.drop_stream(), 0);
    }

    #[test]
    fn ex_std_varint_02_reject_negative_and_empty_decode() {
        let mut s = VarintStream::with_capacity(4).unwrap();
        assert_eq!(s.decode_u64(), Err(CodecError::UnexpectedEof));
        assert_eq!(s.encode_u64(-10), Err(CodecError::NegativeUnsigned));
        assert_eq!(zigzag_decode(-1), Err(CodecError::NegativeUnsigned));
        assert_eq!(s.drop_stream(), 0);
    }
}
