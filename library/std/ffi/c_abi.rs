// Rust 2021 Counterpart for `std::ffi::c_abi` (STD15)
// Notice how Rust lacks native C bitfields in `#[repr(C)]` structs and requires
// manual shift/mask boilerplate plus `unsafe` union field accesses.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CAbiError {
    InvalidVersion,
    InvalidHeaderLen,
    PayloadUnderflow,
    BitfieldOverflow,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CFrameHeader {
    pub packed_word0: u32,
    pub seq_id: u32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CHalfWords {
    pub low16: u16,
    pub high16: u16,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union CWord32Union {
    pub raw_u32: u32,
    pub halves: CHalfWords,
    pub signed_i32: i32,
}

impl CFrameHeader {
    pub fn new(
        version: u32,
        ihl: u32,
        dscp: u32,
        ecn: u32,
        total_len: u32,
        seq_id: u32,
    ) -> Result<Self, CAbiError> {
        if !(4..=15).contains(&version) {
            return Err(CAbiError::InvalidVersion);
        }
        if !(5..=15).contains(&ihl) {
            return Err(CAbiError::InvalidHeaderLen);
        }
        if dscp > 63 || ecn > 3 || !(20..=65535).contains(&total_len) {
            return Err(CAbiError::BitfieldOverflow);
        }
        if total_len < ihl * 4 {
            return Err(CAbiError::PayloadUnderflow);
        }
        let packed_word0 = (version & 0xF)
            | ((ihl & 0xF) << 4)
            | ((dscp & 0x3F) << 8)
            | ((ecn & 0x3) << 14)
            | ((total_len & 0xFFFF) << 16);
        Ok(Self { packed_word0, seq_id })
    }

    pub fn version(&self) -> u32 {
        self.packed_word0 & 0xF
    }

    pub fn ihl(&self) -> u32 {
        (self.packed_word0 >> 4) & 0xF
    }

    pub fn total_len(&self) -> u32 {
        (self.packed_word0 >> 16) & 0xFFFF
    }

    pub fn header_byte_len(&self) -> i64 {
        (self.ihl() * 4) as i64
    }

    pub fn payload_byte_len(&self) -> i64 {
        (self.total_len() - self.ihl() * 4) as i64
    }
}

pub fn union_from_raw(raw_val: u32) -> CWord32Union {
    CWord32Union { raw_u32: raw_val }
}

pub fn union_from_halves(low16: u32, high16: u32) -> Result<CWord32Union, CAbiError> {
    if low16 > 65535 || high16 > 65535 {
        return Err(CAbiError::BitfieldOverflow);
    }
    Ok(CWord32Union {
        halves: CHalfWords {
            low16: low16 as u16,
            high16: high16 as u16,
        },
    })
}

pub fn union_low16(u: CWord32Union) -> i64 {
    unsafe { u.halves.low16 as i64 }
}

pub fn union_high16(u: CWord32Union) -> i64 {
    unsafe { u.halves.high16 as i64 }
}

pub fn union_as_signed(u: CWord32Union) -> i64 {
    unsafe { u.signed_i32 as i64 }
}

pub fn c_sizeof_frame(_hdr: CFrameHeader) -> i64 {
    std::mem::size_of::<CFrameHeader>() as i64
}

pub fn c_sizeof_union(_u: CWord32Union) -> i64 {
    std::mem::size_of::<CWord32Union>() as i64
}

pub fn c_frame_word0(hdr: CFrameHeader) -> i64 {
    hdr.packed_word0 as i64
}

pub fn c_bswap32(x: u32) -> i64 {
    x.swap_bytes() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_c_abi_layout_and_union() {
        let hdr = CFrameHeader::new(4, 5, 0, 0, 84, 7).unwrap();
        assert_eq!(c_sizeof_frame(hdr), 8);
        assert_eq!(hdr.header_byte_len(), 20);
        assert_eq!(hdr.payload_byte_len(), 64);
        assert!(c_frame_word0(hdr) > 0);

        let u1 = union_from_halves(513, 1027).unwrap();
        assert_eq!(c_sizeof_union(u1), 4);
        assert_eq!(union_low16(u1), 513);
        assert_eq!(union_high16(u1), 1027);
    }
}
