// Rust `alloc::string::String` Equivalent Baseline (`std::str::string_buf`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StringError {
    InvalidAsciiByte,
    IndexOutOfBounds,
    CapacityOverflow,
}

impl From<MemError> for StringError {
    fn from(e: MemError) -> Self {
        match e {
            MemError::OutOfBounds | MemError::InvalidCopyRange => StringError::IndexOutOfBounds,
            MemError::CapacityOverflow => StringError::CapacityOverflow,
        }
    }
}

pub struct StringBuf {
    buf: RawBuf,
    len: isize,
}

impl StringBuf {
    pub fn new() -> Self {
        Self {
            buf: RawBuf::new(0).unwrap(),
            len: 0,
        }
    }

    pub fn with_capacity(cap: isize) -> Result<Self, StringError> {
        if !(0..=1_048_576).contains(&cap) {
            return Err(StringError::CapacityOverflow);
        }
        let buf = RawBuf::new(cap)?;
        Ok(Self { buf, len: 0 })
    }

    pub fn len(&self) -> isize {
        self.len
    }

    pub fn capacity(&self) -> isize {
        self.buf.capacity()
    }

    pub fn push_byte(&mut self, ch: i64) -> Result<isize, StringError> {
        if !(0..=127).contains(&ch) {
            return Err(StringError::InvalidAsciiByte);
        }
        if self.len >= 1_048_576 {
            return Err(StringError::CapacityOverflow);
        }
        if self.len == self.buf.capacity() {
            self.buf.grow(self.len + 1)?;
        }
        self.buf.write_at(self.len, ch)?;
        self.len += 1;
        Ok(self.len)
    }

    pub fn push_repeat(&mut self, ch: i64, count: isize) -> Result<isize, StringError> {
        if !(0..=127).contains(&ch) {
            return Err(StringError::InvalidAsciiByte);
        }
        if count < 0 || self.len + count > 1_048_576 {
            return Err(StringError::CapacityOverflow);
        }
        if count > 0 && self.len + count > self.buf.capacity() {
            self.buf.grow(self.len + count)?;
        }
        for i in 0..count {
            self.buf.write_at(self.len + i, ch)?;
        }
        self.len += count;
        Ok(self.len)
    }

    pub fn push_str(&mut self, s: &str) -> Result<isize, StringError> {
        let slen = s.len() as isize;
        if self.len + slen > 1_048_576 {
            return Err(StringError::CapacityOverflow);
        }
        if slen > 0 && self.len + slen > self.buf.capacity() {
            self.buf.grow(self.len + slen)?;
        }
        for (i, &b) in s.as_bytes().iter().enumerate() {
            self.buf.write_at(self.len + (i as isize), b as i64)?;
        }
        self.len += slen;
        Ok(self.len)
    }

    pub fn equals_str(&self, target: &str) -> bool {
        if self.len != (target.len() as isize) {
            return false;
        }
        for (i, &b) in target.as_bytes().iter().enumerate() {
            if self.buf.read_at(i as isize).unwrap_or(-1) != (b as i64) {
                return false;
            }
        }
        true
    }

    pub fn to_sso_string(&self) -> String {
        let mut out = String::with_capacity(self.len as usize);
        for i in 0..self.len {
            let b = self.buf.read_at(i).unwrap_or(0) as u8;
            out.push(b as char);
        }
        out
    }

    pub fn byte_at(&self, idx: isize) -> Result<i64, StringError> {
        if idx < 0 || idx >= self.len {
            return Err(StringError::IndexOutOfBounds);
        }
        Ok(self.buf.read_at(idx)?)
    }

    pub fn truncate(&mut self, new_len: isize) -> Result<isize, StringError> {
        if new_len < 0 || new_len > self.len {
            return Err(StringError::IndexOutOfBounds);
        }
        self.len = new_len;
        Ok(self.len)
    }

    pub fn fnv1a_hash(&self) -> i64 {
        let mut h: i64 = 2_166_136_261;
        for i in 0..self.len {
            let b = self.buf.read_at(i).unwrap_or(0);
            h = ((h ^ b).wrapping_mul(16_777_619)) % 2_147_483_647;
            if h < 0 {
                h = -h;
            }
        }
        h
    }

    pub fn drop_string(&mut self) -> isize {
        self.buf.release();
        self.len = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_strbuf_01_growth_repeat_truncate_hash() {
        let mut sb = StringBuf::new();
        assert_eq!(sb.len(), 0);
        assert_eq!(sb.capacity(), 0);
        assert_eq!(sb.push_byte(74).unwrap(), 1);
        assert_eq!(sb.push_byte(78).unwrap(), 2);
        assert_eq!(sb.push_repeat(33, 3).unwrap(), 5);
        assert_eq!(sb.capacity(), 8);
        assert_eq!(sb.byte_at(0).unwrap(), 74);
        assert_eq!(sb.byte_at(4).unwrap(), 33);
        assert!(sb.equals_str("JN!!!"));

        let sso_s = sb.to_sso_string();
        assert_eq!(sso_s.len(), 5);
        assert_eq!(sso_s.as_bytes()[0], 74);
        assert_eq!(sso_s, "JN!!!");

        assert_eq!(sb.push_str("_v0.2").unwrap(), 10);
        assert!(sb.equals_str("JN!!!_v0.2"));
        assert!(sb.fnv1a_hash() > 0);
        assert_eq!(sb.truncate(2).unwrap(), 2);
        assert!(sb.equals_str("JN"));
        assert_eq!(sb.drop_string(), 0);
    }

    #[test]
    fn ex_std_strbuf_02_reject_invalid_ascii_and_oob() {
        let mut sb = StringBuf::with_capacity(4).unwrap();
        assert_eq!(sb.push_byte(200), Err(StringError::InvalidAsciiByte));
        assert_eq!(sb.push_byte(-5), Err(StringError::InvalidAsciiByte));
        assert_eq!(sb.push_byte(65).unwrap(), 1);
        assert_eq!(sb.byte_at(1), Err(StringError::IndexOutOfBounds));
        assert_eq!(sb.truncate(5), Err(StringError::IndexOutOfBounds));
        assert_eq!(sb.drop_string(), 0);
    }
}
