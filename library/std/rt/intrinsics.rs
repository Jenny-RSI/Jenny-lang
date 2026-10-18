// Rust Baseline for `std::rt::intrinsics` (`core::intrinsics` / `alloc::alloc` equivalents)

use std::alloc::{alloc_zeroed, dealloc, Layout};
use std::ptr;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RtString {
    Sso { len: u8, bytes: [u8; 22] },
    Shared(String),
}

impl RtString {
    pub fn len(&self) -> usize {
        match self {
            RtString::Sso { len, .. } => *len as usize,
            RtString::Shared(s) => s.len(),
        }
    }

    pub fn is_sso(&self) -> bool {
        matches!(self, RtString::Sso { .. })
    }

    pub fn eq_str(&self, target: &str) -> bool {
        match self {
            RtString::Sso { len, bytes } => &bytes[..(*len as usize)] == target.as_bytes(),
            RtString::Shared(s) => s.as_str() == target,
        }
    }
}

pub fn rt_raw_alloc(cap: i64) -> i64 {
    assert!((0..=1_048_576).contains(&cap));
    if cap == 0 {
        return 0;
    }
    let layout = Layout::array::<i64>(cap as usize).unwrap();
    let ptr = unsafe { alloc_zeroed(layout) as *mut i64 };
    assert!(!ptr.is_null());
    ptr as usize as i64
}

pub fn rt_raw_free(raw_ptr: i64, cap: i64) -> i64 {
    if raw_ptr != 0 && cap > 0 {
        let layout = Layout::array::<i64>(cap as usize).unwrap();
        unsafe { dealloc(raw_ptr as usize as *mut u8, layout) };
    }
    0
}

pub fn rt_raw_realloc(old_ptr: i64, old_cap: i64, new_cap: i64) -> i64 {
    assert!(old_cap >= 0 && (0..=1_048_576).contains(&new_cap));
    if new_cap == 0 {
        rt_raw_free(old_ptr, old_cap);
        return 0;
    }
    let new_ptr = rt_raw_alloc(new_cap);
    if old_ptr != 0 {
        let copy_cnt = old_cap.min(new_cap) as usize;
        unsafe {
            ptr::copy_nonoverlapping(
                old_ptr as usize as *const i64,
                new_ptr as usize as *mut i64,
                copy_cnt,
            );
        }
        rt_raw_free(old_ptr, old_cap);
    }
    new_ptr
}

pub fn rt_raw_get(raw_ptr: i64, idx: i64) -> i64 {
    assert!(raw_ptr != 0 && idx >= 0);
    unsafe { *(raw_ptr as usize as *const i64).add(idx as usize) }
}

pub fn rt_raw_set(raw_ptr: i64, idx: i64, val: i64) -> i64 {
    assert!(raw_ptr != 0 && idx >= 0);
    unsafe {
        *(raw_ptr as usize as *mut i64).add(idx as usize) = val;
    }
    val
}

pub fn rt_raw_copy(dst_ptr: i64, dst_off: i64, src_ptr: i64, src_off: i64, count: i64) -> i64 {
    assert!(count >= 0 && dst_off >= 0 && src_off >= 0);
    if count == 0 {
        return 0;
    }
    unsafe {
        let dst = (dst_ptr as usize as *mut i64).add(dst_off as usize);
        let src = (src_ptr as usize as *const i64).add(src_off as usize);
        ptr::copy(src, dst, count as usize);
    }
    count
}

pub fn rt_raw_put_str(raw_ptr: i64, write_off: i64, s: &str) -> i64 {
    assert!(write_off >= 0);
    for (i, b) in s.bytes().enumerate() {
        rt_raw_set(raw_ptr, write_off + i as i64, b as i64);
    }
    write_off + s.len() as i64
}

pub fn rt_raw_put_string(raw_ptr: i64, write_off: i64, s: &RtString) -> i64 {
    match s {
        RtString::Sso { len, bytes } => {
            for i in 0..(*len as usize) {
                rt_raw_set(raw_ptr, write_off + i as i64, bytes[i] as i64);
            }
            write_off + *len as i64
        }
        RtString::Shared(st) => rt_raw_put_str(raw_ptr, write_off, st),
    }
}

pub fn rt_raw_put_i64(raw_ptr: i64, write_off: i64, val: i64) -> i64 {
    let formatted = val.to_string();
    rt_raw_put_str(raw_ptr, write_off, &formatted)
}

pub fn rt_raw_put_hex_u32(raw_ptr: i64, write_off: i64, val: i64, digits: i64) -> i64 {
    assert!((1..=8).contains(&digits));
    let uval = val as u32;
    for d in 0..digits {
        let shift = ((digits - 1 - d) * 4) as u32;
        let nib = ((uval >> shift) & 0xF) as u8;
        let ch = if nib < 10 { b'0' + nib } else { b'a' + (nib - 10) };
        rt_raw_set(raw_ptr, write_off + d, ch as i64);
    }
    write_off + digits
}

pub fn rt_raw_put_hex_upper_u32(raw_ptr: i64, write_off: i64, val: i64, digits: i64) -> i64 {
    assert!((1..=8).contains(&digits));
    let uval = val as u32;
    for d in 0..digits {
        let shift = ((digits - 1 - d) * 4) as u32;
        let nib = ((uval >> shift) & 0xF) as u8;
        let ch = if nib < 10 { b'0' + nib } else { b'A' + (nib - 10) };
        rt_raw_set(raw_ptr, write_off + d, ch as i64);
    }
    write_off + digits
}

pub fn rt_raw_put_pad_zero(raw_ptr: i64, write_off: i64, val: i64, width: i64) -> i64 {
    assert!((1..=20).contains(&width));
    let s = format!("{:0width$}", val, width = width as usize);
    rt_raw_put_str(raw_ptr, write_off, &s)
}

pub fn rt_raw_put_bin_u32(raw_ptr: i64, write_off: i64, val: i64, bits: i64) -> i64 {
    assert!((1..=32).contains(&bits));
    let uval = val as u32;
    for b in 0..bits {
        let shift = (bits - 1 - b) as u32;
        let ch = if ((uval >> shift) & 1) != 0 { b'1' } else { b'0' };
        rt_raw_set(raw_ptr, write_off + b, ch as i64);
    }
    write_off + bits
}

pub fn rt_raw_put_grouped_i64(raw_ptr: i64, write_off: i64, val: i64, sep_byte: i64) -> i64 {
    if sep_byte <= 0 {
        return rt_raw_put_i64(raw_ptr, write_off, val);
    }
    let s = val.unsigned_abs().to_string();
    let mut cur = write_off;
    if val < 0 {
        rt_raw_set(raw_ptr, cur, b'-' as i64);
        cur += 1;
    }
    let bytes = s.as_bytes();
    for (idx, &ch) in bytes.iter().enumerate() {
        rt_raw_set(raw_ptr, cur, ch as i64);
        cur += 1;
        let rem = bytes.len() - 1 - idx;
        if rem > 0 && rem % 3 == 0 {
            rt_raw_set(raw_ptr, cur, sep_byte);
            cur += 1;
        }
    }
    cur
}

pub fn rt_raw_put_bool(raw_ptr: i64, write_off: i64, flag: bool) -> i64 {
    rt_raw_put_str(raw_ptr, write_off, if flag { "true" } else { "false" })
}

pub fn rt_raw_eq_str(raw_ptr: i64, len: i64, target: &str) -> bool {
    if len as usize != target.len() {
        return false;
    }
    for (i, b) in target.bytes().enumerate() {
        if rt_raw_get(raw_ptr, i as i64) != b as i64 {
            return false;
        }
    }
    true
}

pub fn rt_raw_to_sso_string(raw_ptr: i64, start: i64, len: i64) -> RtString {
    assert!(start >= 0 && len >= 0);
    let n = len as usize;
    if n <= 22 {
        let mut bytes = [0u8; 22];
        for i in 0..n {
            bytes[i] = rt_raw_get(raw_ptr, start + i as i64) as u8;
        }
        RtString::Sso { len: n as u8, bytes }
    } else {
        let mut v = Vec::with_capacity(n);
        for i in 0..n {
            v.push(rt_raw_get(raw_ptr, start + i as i64) as u8);
        }
        RtString::Shared(String::from_utf8(v).unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raw_heap_intrinsics() {
        let p1 = rt_raw_alloc(4);
        assert_ne!(p1, 0);
        rt_raw_set(p1, 0, 101);
        rt_raw_set(p1, 1, 202);
        rt_raw_copy(p1, 2, p1, 0, 2);
        assert_eq!(rt_raw_get(p1, 2), 101);
        assert_eq!(rt_raw_get(p1, 3), 202);
        let p2 = rt_raw_realloc(p1, 4, 8);
        assert_eq!(rt_raw_get(p2, 3), 202);
        rt_raw_free(p2, 8);
    }

    #[test]
    fn test_format_and_sso_intrinsics() {
        let sp = rt_raw_alloc(32);
        let mut off = rt_raw_put_str(sp, 0, "rt=");
        off = rt_raw_put_i64(sp, off, 42);
        off = rt_raw_put_str(sp, off, ",hex=");
        off = rt_raw_put_hex_u32(sp, off, 255, 2);
        assert!(rt_raw_eq_str(sp, off, "rt=42,hex=ff"));
        let s = rt_raw_to_sso_string(sp, 0, off);
        assert!(s.is_sso());
        assert!(s.eq_str("rt=42,hex=ff"));
        rt_raw_free(sp, 32);
    }
}
