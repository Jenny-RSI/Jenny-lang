// Rust `core::fmt::Write` / `format!` / Locale Equivalent Baseline (`std::str::fmt`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FmtError {
    InvalidCapacity,
    BufferOverflow,
    InvalidHexSpec,
    InvalidPadWidth,
    InvalidBinBits,
    SliceOutOfBounds,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Culture {
    Invariant,
    EnUS,
    DeDE,
    ZhCN,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FmtSpec {
    Dec,
    HexLower,
    HexUpper,
    PadZero,
    Bin,
    GroupedInt,
    Fixed,
    Scientific,
    Currency,
}

impl From<MemError> for FmtError {
    fn from(e: MemError) -> Self {
        match e {
            MemError::CapacityOverflow => FmtError::InvalidCapacity,
            MemError::OutOfBounds | MemError::InvalidCopyRange => FmtError::BufferOverflow,
        }
    }
}

pub enum FmtArg<'a> {
    Str(&'a str),
    String(&'a String),
    Int(i64),
    Bool(bool),
    Spec2(i64, FmtSpec),
    Spec3(i64, FmtSpec, isize),
    ToStr(&'a dyn ToStr),
    Custom(&'a dyn Formattable),
}

pub trait ToStr {
    fn to_str_slice(&self) -> &str;
}

pub trait Formattable {
    fn fmt_into(&self, fb: &mut FmtBuffer, culture: Culture) -> Result<isize, FmtError>;
}

pub struct RoleBadge<'a> {
    pub name: &'a str,
}

impl<'a> RoleBadge<'a> {
    pub fn new(name: &'a str) -> Self {
        Self { name }
    }
}

impl<'a> ToStr for RoleBadge<'a> {
    fn to_str_slice(&self) -> &str {
        self.name
    }
}

pub struct KvTag<'a> {
    pub label: &'a str,
    pub code: i64,
}

impl<'a> KvTag<'a> {
    pub fn new(label: &'a str, code: i64) -> Self {
        Self { label, code }
    }
}

impl<'a> Formattable for KvTag<'a> {
    fn fmt_into(&self, fb: &mut FmtBuffer, culture: Culture) -> Result<isize, FmtError> {
        fb.put_str(self.label)?;
        fb.put_str("=")?;
        fb.put_grouped_i64(self.code, culture)
    }
}

pub fn format_with(culture: Culture, args: &[FmtArg<'_>]) -> String {
    let mut fb = FmtBuffer::in_arena(512).unwrap();
    for arg in args {
        match *arg {
            FmtArg::Spec3(val, spec, param) => {
                fb.put_spec(culture, val, spec, param).unwrap();
            }
            FmtArg::Spec2(val, spec) => {
                fb.put_spec(culture, val, spec, 0).unwrap();
            }
            FmtArg::Str(s) => {
                fb.put_str(s).unwrap();
            }
            FmtArg::String(s) => {
                fb.put_string(s).unwrap();
            }
            FmtArg::Bool(b) => {
                fb.put_bool(b).unwrap();
            }
            FmtArg::Int(v) => {
                fb.put_i64(v).unwrap();
            }
            FmtArg::ToStr(t) => {
                fb.put_str(t.to_str_slice()).unwrap();
            }
            FmtArg::Custom(c) => {
                c.fmt_into(&mut fb, culture).unwrap();
            }
        }
    }
    let out = fb.to_sso_string();
    fb.drop_fmt();
    out
}

pub fn format(args: &[FmtArg<'_>]) -> String {
    format_with(Culture::Invariant, args)
}

pub struct FmtBuffer {
    buf: RawBuf,
    len: isize,
    cap: isize,
    arena_mark: isize,
}

impl FmtBuffer {
    pub fn in_arena(cap: isize) -> Result<Self, FmtError> {
        if !(0..=16_384).contains(&cap) {
            return Err(FmtError::InvalidCapacity);
        }
        let buf = RawBuf::new(cap)?;
        Ok(Self {
            buf,
            len: 0,
            cap,
            arena_mark: 0,
        })
    }

    pub fn with_capacity(cap: isize) -> Result<Self, FmtError> {
        if !(0..=1_048_576).contains(&cap) {
            return Err(FmtError::InvalidCapacity);
        }
        let buf = RawBuf::new(cap)?;
        Ok(Self {
            buf,
            len: 0,
            cap,
            arena_mark: -1,
        })
    }

    pub fn len(&self) -> isize {
        self.len
    }

    pub fn capacity(&self) -> isize {
        self.cap
    }

    pub fn clear(&mut self) -> isize {
        self.len = 0;
        0
    }

    pub fn put_str(&mut self, s: &str) -> Result<isize, FmtError> {
        let slen = s.len() as isize;
        if self.len + slen > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        for (i, &b) in s.as_bytes().iter().enumerate() {
            self.buf.write_at(self.len + (i as isize), b as i64)?;
        }
        self.len += slen;
        Ok(self.len)
    }

    pub fn put_string(&mut self, s: &String) -> Result<isize, FmtError> {
        self.put_str(s.as_str())
    }

    pub fn put_i64(&mut self, val: i64) -> Result<isize, FmtError> {
        if self.len + 21 > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        if val == 0 {
            self.buf.write_at(self.len, b'0' as i64)?;
            self.len += 1;
            return Ok(self.len);
        }
        let neg = val < 0;
        let mut mag: u64 = if neg {
            (0u64).wrapping_sub(val as u64)
        } else {
            val as u64
        };
        let mut tmp = [0u8; 24];
        let mut n = 0usize;
        while mag > 0 {
            tmp[n] = b'0' + ((mag % 10) as u8);
            mag /= 10;
            n += 1;
        }
        if neg {
            self.buf.write_at(self.len, b'-' as i64)?;
            self.len += 1;
        }
        while n > 0 {
            n -= 1;
            self.buf.write_at(self.len, tmp[n] as i64)?;
            self.len += 1;
        }
        Ok(self.len)
    }

    pub fn put_hex_u32(&mut self, val: i64, digits: isize) -> Result<isize, FmtError> {
        if !(0..=4_294_967_295).contains(&val) || !(1..=8).contains(&digits) {
            return Err(FmtError::InvalidHexSpec);
        }
        if self.len + digits > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        const HEX_LUT: &[u8; 16] = b"0123456789abcdef";
        let u = val as u32;
        for i in 0..digits {
            let shift = ((digits - 1 - i) * 4) as u32;
            let nib = ((u >> shift) & 0xF) as usize;
            self.buf.write_at(self.len + i, HEX_LUT[nib] as i64)?;
        }
        self.len += digits;
        Ok(self.len)
    }

    pub fn put_hex_upper_u32(&mut self, val: i64, digits: isize) -> Result<isize, FmtError> {
        if !(0..=4_294_967_295).contains(&val) || !(1..=8).contains(&digits) {
            return Err(FmtError::InvalidHexSpec);
        }
        if self.len + digits > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        const HEX_LUT: &[u8; 16] = b"0123456789ABCDEF";
        let u = val as u32;
        for i in 0..digits {
            let shift = ((digits - 1 - i) * 4) as u32;
            let nib = ((u >> shift) & 0xF) as usize;
            self.buf.write_at(self.len + i, HEX_LUT[nib] as i64)?;
        }
        self.len += digits;
        Ok(self.len)
    }

    pub fn put_pad_zero(&mut self, val: i64, width: isize) -> Result<isize, FmtError> {
        if !(1..=20).contains(&width) {
            return Err(FmtError::InvalidPadWidth);
        }
        if self.len + 21 > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        let neg = val < 0;
        let mut mag: u64 = if neg {
            (0u64).wrapping_sub(val as u64)
        } else {
            val as u64
        };
        let mut tmp = [0u8; 24];
        let mut n = 0usize;
        if mag == 0 {
            tmp[0] = b'0';
            n = 1;
        } else {
            while mag > 0 {
                tmp[n] = b'0' + ((mag % 10) as u8);
                mag /= 10;
                n += 1;
            }
        }
        let sign_len = if neg { 1isize } else { 0isize };
        if neg {
            self.buf.write_at(self.len, b'-' as i64)?;
            self.len += 1;
        }
        let mut pad = width - sign_len - (n as isize);
        while pad > 0 {
            self.buf.write_at(self.len, b'0' as i64)?;
            self.len += 1;
            pad -= 1;
        }
        while n > 0 {
            n -= 1;
            self.buf.write_at(self.len, tmp[n] as i64)?;
            self.len += 1;
        }
        Ok(self.len)
    }

    pub fn put_bin_u32(&mut self, val: i64, bits: isize) -> Result<isize, FmtError> {
        if !(0..=4_294_967_295).contains(&val) || !(1..=32).contains(&bits) {
            return Err(FmtError::InvalidBinBits);
        }
        if self.len + bits > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        let u = val as u32;
        for i in 0..bits {
            let shift = (bits - 1 - i) as u32;
            let b = if ((u >> shift) & 1) != 0 { b'1' } else { b'0' };
            self.buf.write_at(self.len + i, b as i64)?;
        }
        self.len += bits;
        Ok(self.len)
    }

    pub fn put_grouped_i64(&mut self, val: i64, culture: Culture) -> Result<isize, FmtError> {
        if self.len + 27 > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        let sep = match culture {
            Culture::DeDE => b'.',
            Culture::Invariant | Culture::EnUS | Culture::ZhCN => b',',
        };
        let neg = val < 0;
        let mut mag: u64 = if neg {
            (0u64).wrapping_sub(val as u64)
        } else {
            val as u64
        };
        if mag == 0 {
            self.buf.write_at(self.len, b'0' as i64)?;
            self.len += 1;
            return Ok(self.len);
        }
        let mut tmp = [0u8; 24];
        let mut n = 0usize;
        while mag > 0 {
            tmp[n] = b'0' + ((mag % 10) as u8);
            mag /= 10;
            n += 1;
        }
        if neg {
            self.buf.write_at(self.len, b'-' as i64)?;
            self.len += 1;
        }
        for i in (0..n).rev() {
            self.buf.write_at(self.len, tmp[i] as i64)?;
            self.len += 1;
            if i > 0 && (i % 3) == 0 {
                self.buf.write_at(self.len, sep as i64)?;
                self.len += 1;
            }
        }
        Ok(self.len)
    }

    pub fn put_spec(
        &mut self,
        culture: Culture,
        val: i64,
        spec: FmtSpec,
        param: isize,
    ) -> Result<isize, FmtError> {
        match spec {
            FmtSpec::HexLower => self.put_hex_u32(val, if param == 0 { 8 } else { param }),
            FmtSpec::HexUpper => self.put_hex_upper_u32(val, if param == 0 { 8 } else { param }),
            FmtSpec::PadZero => self.put_pad_zero(val, if param == 0 { 4 } else { param }),
            FmtSpec::Bin => self.put_bin_u32(val, if param == 0 { 8 } else { param }),
            FmtSpec::GroupedInt => self.put_grouped_i64(val, culture),
            _ => self.put_i64(val),
        }
    }

    pub fn put_bool(&mut self, flag: bool) -> Result<isize, FmtError> {
        if self.len + 5 > self.cap {
            return Err(FmtError::BufferOverflow);
        }
        self.put_str(if flag { "true" } else { "false" })
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

    pub fn slice_to_sso(&self, start: isize, sub_len: isize) -> Result<String, FmtError> {
        if start < 0 || sub_len < 0 || start + sub_len > self.len {
            return Err(FmtError::SliceOutOfBounds);
        }
        let mut out = String::with_capacity(sub_len as usize);
        for i in 0..sub_len {
            let b = self.buf.read_at(start + i).unwrap_or(0) as u8;
            out.push(b as char);
        }
        Ok(out)
    }

    pub fn drop_fmt(&mut self) -> isize {
        self.buf.release();
        self.len = 0;
        self.cap = 0;
        self.arena_mark = -1;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_fmt_01_variadic_format_tuple_specs_and_culture() {
        let s1 = format(&[
            FmtArg::Str("id="),
            FmtArg::Int(-42),
            FmtArg::Str(",hex=0x"),
            FmtArg::Spec3(48879, FmtSpec::HexLower, 4),
        ]);
        assert_eq!(s1.len(), 17);
        assert_eq!(s1, "id=-42,hex=0xbeef");

        let s2 = format(&[
            FmtArg::Str("seq="),
            FmtArg::Spec3(7, FmtSpec::PadZero, 4),
            FmtArg::Str(",bin="),
            FmtArg::Spec3(10, FmtSpec::Bin, 4),
            FmtArg::Str(",HEX="),
            FmtArg::Spec3(48879, FmtSpec::HexUpper, 4),
            FmtArg::Str(",ok="),
            FmtArg::Bool(true),
        ]);
        assert_eq!(s2.len(), 34);
        assert_eq!(s2, "seq=0007,bin=1010,HEX=BEEF,ok=true");

        let us_amt = format_with(
            Culture::EnUS,
            &[FmtArg::Str("USD "), FmtArg::Spec2(1_234_567, FmtSpec::GroupedInt)],
        );
        assert_eq!(us_amt, "USD 1,234,567");

        let de_amt = format_with(
            Culture::DeDE,
            &[
                FmtArg::Str("EUR "),
                FmtArg::Spec2(1_234_567, FmtSpec::GroupedInt),
                FmtArg::Str(" net"),
            ],
        );
        assert_eq!(de_amt, "EUR 1.234.567 net");

        let badge = RoleBadge::new("admin");
        let tag = KvTag::new("tx", 98765);
        let nested = format_with(
            Culture::EnUS,
            &[
                FmtArg::Str("["),
                FmtArg::String(&s1),
                FmtArg::Str("|"),
                FmtArg::ToStr(&badge),
                FmtArg::Str("|"),
                FmtArg::Custom(&tag),
                FmtArg::Str("]"),
            ],
        );
        assert_eq!(nested, "[id=-42,hex=0xbeef|admin|tx=98,765]");
    }
}

