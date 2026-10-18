// Rust `std::io::{BufReader, BufWriter}` Equivalent Baseline (`std::io::buf_io`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BufIoError {
    BufferUnderflow,
    CapacityOverflow,
    InvalidFrame,
}

impl From<MemError> for BufIoError {
    fn from(_: MemError) -> Self {
        BufIoError::CapacityOverflow
    }
}

pub struct BufChannel {
    buf: RawBuf,
    pub read_pos: isize,
    pub write_pos: isize,
    pub flushed_count: isize,
}

impl BufChannel {
    pub fn with_capacity(cap: isize) -> Result<Self, BufIoError> {
        if !(0..=1_048_576).contains(&cap) {
            return Err(BufIoError::CapacityOverflow);
        }
        let buf = RawBuf::new(cap)?;
        Ok(Self {
            buf,
            read_pos: 0,
            write_pos: 0,
            flushed_count: 0,
        })
    }

    pub fn unread_len(&self) -> isize {
        self.write_pos - self.read_pos
    }

    pub fn write_frame(&mut self, payload: i64) -> Result<isize, BufIoError> {
        if self.write_pos >= 1_048_576 {
            return Err(BufIoError::CapacityOverflow);
        }
        if self.write_pos == self.buf.capacity() {
            self.buf.grow(self.write_pos + 1)?;
        }
        self.buf.write_at(self.write_pos, payload)?;
        self.write_pos += 1;
        Ok(self.write_pos - self.read_pos)
    }

    pub fn read_frame(&mut self) -> Result<i64, BufIoError> {
        if self.read_pos >= self.write_pos {
            return Err(BufIoError::BufferUnderflow);
        }
        let v = self.buf.read_at(self.read_pos)?;
        self.read_pos += 1;
        Ok(v)
    }

    pub fn compact(&mut self) -> Result<isize, BufIoError> {
        let unread = self.write_pos - self.read_pos;
        if self.read_pos > 0 && unread > 0 {
            self.buf.copy_within(self.read_pos, 0, unread)?;
        }
        self.read_pos = 0;
        self.write_pos = unread;
        Ok(self.write_pos)
    }

    pub fn flush_all(&mut self) -> isize {
        let unread = self.write_pos - self.read_pos;
        self.flushed_count += unread;
        self.read_pos = 0;
        self.write_pos = 0;
        self.flushed_count
    }

    pub fn drop_channel(&mut self) -> isize {
        self.buf.release();
        self.read_pos = 0;
        self.write_pos = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_bufio_01_write_read_compact_flush_drop() {
        let mut ch = BufChannel::with_capacity(4).unwrap();
        assert_eq!(ch.write_frame(100).unwrap(), 1);
        assert_eq!(ch.write_frame(200).unwrap(), 2);
        assert_eq!(ch.write_frame(300).unwrap(), 3);
        assert_eq!(ch.read_frame().unwrap(), 100);
        assert_eq!(ch.unread_len(), 2);
        assert_eq!(ch.compact().unwrap(), 2);
        assert_eq!(ch.read_frame().unwrap(), 200);
        assert_eq!(ch.flush_all(), 1);
        assert_eq!(ch.unread_len(), 0);
        assert_eq!(ch.drop_channel(), 0);
    }

    #[test]
    fn ex_std_bufio_02_reject_underflow() {
        let mut ch = BufChannel::with_capacity(2).unwrap();
        assert_eq!(ch.read_frame(), Err(BufIoError::BufferUnderflow));
        assert_eq!(ch.write_frame(55).unwrap(), 1);
        assert_eq!(ch.read_frame().unwrap(), 55);
        assert_eq!(ch.read_frame(), Err(BufIoError::BufferUnderflow));
        assert_eq!(ch.drop_channel(), 0);
    }
}
