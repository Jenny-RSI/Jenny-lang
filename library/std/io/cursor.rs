// Rust `std::io::Cursor` Equivalent Baseline (`std::io::cursor`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorError {
    UnexpectedEof,
    InvalidSeek,
    CapacityOverflow,
}

impl From<MemError> for CursorError {
    fn from(_: MemError) -> Self {
        CursorError::CapacityOverflow
    }
}

pub struct IoCursor {
    buf: RawBuf,
    pub pos: isize,
    pub filled: isize,
}

impl IoCursor {
    pub fn new() -> Self {
        Self {
            buf: RawBuf::new(0).unwrap(),
            pos: 0,
            filled: 0,
        }
    }

    pub fn with_capacity(cap: isize) -> Result<Self, CursorError> {
        if !(0..=1_048_576).contains(&cap) {
            return Err(CursorError::CapacityOverflow);
        }
        let buf = RawBuf::new(cap)?;
        Ok(Self {
            buf,
            pos: 0,
            filled: 0,
        })
    }

    pub fn remaining(&self) -> isize {
        self.filled - self.pos
    }

    pub fn write_word(&mut self, val: i64) -> Result<isize, CursorError> {
        if self.pos >= 1_048_576 {
            return Err(CursorError::CapacityOverflow);
        }
        if self.pos == self.buf.capacity() {
            self.buf.grow(self.pos + 1)?;
        }
        self.buf.write_at(self.pos, val)?;
        self.pos += 1;
        if self.pos > self.filled {
            self.filled = self.pos;
        }
        Ok(self.pos)
    }

    pub fn read_word(&mut self) -> Result<i64, CursorError> {
        if self.pos >= self.filled {
            return Err(CursorError::UnexpectedEof);
        }
        let v = self.buf.read_at(self.pos)?;
        self.pos += 1;
        Ok(v)
    }

    pub fn seek_to(&mut self, target_pos: isize) -> Result<isize, CursorError> {
        if target_pos < 0 || target_pos > self.filled {
            return Err(CursorError::InvalidSeek);
        }
        self.pos = target_pos;
        Ok(self.pos)
    }

    pub fn rewind(&mut self) -> isize {
        self.pos = 0;
        0
    }

    pub fn drop_cursor(&mut self) -> isize {
        self.buf.release();
        self.pos = 0;
        self.filled = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_cursor_01_write_rewind_seek_read_drop() {
        let mut cur = IoCursor::new();
        assert_eq!(cur.write_word(111).unwrap(), 1);
        assert_eq!(cur.write_word(222).unwrap(), 2);
        assert_eq!(cur.write_word(333).unwrap(), 3);
        assert_eq!(cur.remaining(), 0);
        assert_eq!(cur.rewind(), 0);
        assert_eq!(cur.remaining(), 3);
        assert_eq!(cur.read_word().unwrap(), 111);
        assert_eq!(cur.seek_to(2).unwrap(), 2);
        assert_eq!(cur.read_word().unwrap(), 333);
        assert_eq!(cur.seek_to(1).unwrap(), 1);
        assert_eq!(cur.write_word(999).unwrap(), 2);
        assert_eq!(cur.filled, 3);
        assert_eq!(cur.drop_cursor(), 0);
    }

    #[test]
    fn ex_std_cursor_02_reject_eof_and_invalid_seek() {
        let mut cur = IoCursor::with_capacity(4).unwrap();
        assert_eq!(cur.read_word(), Err(CursorError::UnexpectedEof));
        assert_eq!(cur.write_word(42).unwrap(), 1);
        assert_eq!(cur.read_word(), Err(CursorError::UnexpectedEof));
        assert_eq!(cur.seek_to(2), Err(CursorError::InvalidSeek));
        assert_eq!(cur.seek_to(-1), Err(CursorError::InvalidSeek));
        assert_eq!(cur.drop_cursor(), 0);
    }
}
