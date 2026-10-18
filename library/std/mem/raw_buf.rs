// Rust `alloc::raw_vec::RawVec<i64>` Equivalent Baseline (`std::mem::raw_buf`)
// Requires `NonNull<i64>`, `Layout::array`, `unsafe` alloc/realloc/dealloc/ptr::copy.

use std::alloc::{alloc_zeroed, dealloc, realloc, Layout};
use std::ptr::{self, NonNull};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemError {
    OutOfBounds,
    CapacityOverflow,
    InvalidCopyRange,
}

pub struct RawBuf {
    ptr: NonNull<i64>,
    cap: usize,
}

impl RawBuf {
    pub const MAX_CAP: usize = 1_048_576;

    pub fn new(cap: isize) -> Result<Self, MemError> {
        if cap < 0 || (cap as usize) > Self::MAX_CAP {
            return Err(MemError::CapacityOverflow);
        }
        let ucap = cap as usize;
        if ucap == 0 {
            return Ok(Self {
                ptr: NonNull::dangling(),
                cap: 0,
            });
        }
        let layout = Layout::array::<i64>(ucap).map_err(|_| MemError::CapacityOverflow)?;
        let raw = unsafe { alloc_zeroed(layout) as *mut i64 };
        let ptr = NonNull::new(raw).ok_or(MemError::CapacityOverflow)?;
        Ok(Self { ptr, cap: ucap })
    }

    pub fn capacity(&self) -> isize {
        self.cap as isize
    }

    pub fn read_at(&self, idx: isize) -> Result<i64, MemError> {
        if idx < 0 || (idx as usize) >= self.cap {
            return Err(MemError::OutOfBounds);
        }
        unsafe { Ok(*self.ptr.as_ptr().add(idx as usize)) }
    }

    pub fn write_at(&mut self, idx: isize, val: i64) -> Result<i64, MemError> {
        if idx < 0 || (idx as usize) >= self.cap {
            return Err(MemError::OutOfBounds);
        }
        unsafe {
            *self.ptr.as_ptr().add(idx as usize) = val;
        }
        Ok(val)
    }

    pub fn grow(&mut self, min_cap: isize) -> Result<isize, MemError> {
        if min_cap <= 0 || (min_cap as usize) > Self::MAX_CAP {
            return Err(MemError::CapacityOverflow);
        }
        let umin = min_cap as usize;
        if self.cap >= umin {
            return Ok(self.cap as isize);
        }
        let doubled = if self.cap == 0 { 4 } else { self.cap * 2 };
        let target = doubled.max(umin).min(Self::MAX_CAP);
        let new_layout = Layout::array::<i64>(target).map_err(|_| MemError::CapacityOverflow)?;
        let new_raw = unsafe {
            if self.cap == 0 {
                alloc_zeroed(new_layout) as *mut i64
            } else {
                let old_layout = Layout::array::<i64>(self.cap).unwrap();
                let p = realloc(self.ptr.as_ptr() as *mut u8, old_layout, new_layout.size()) as *mut i64;
                if !p.is_null() && target > self.cap {
                    ptr::write_bytes(p.add(self.cap), 0, target - self.cap);
                }
                p
            }
        };
        self.ptr = NonNull::new(new_raw).ok_or(MemError::CapacityOverflow)?;
        self.cap = target;
        Ok(self.cap as isize)
    }

    pub fn copy_within(&mut self, src_off: isize, dst_off: isize, count: isize) -> Result<isize, MemError> {
        if count < 0 || src_off < 0 || dst_off < 0 {
            return Err(MemError::InvalidCopyRange);
        }
        let (usrc, udst, ucnt) = (src_off as usize, dst_off as usize, count as usize);
        if usrc + ucnt > self.cap || udst + ucnt > self.cap {
            return Err(MemError::OutOfBounds);
        }
        unsafe {
            ptr::copy(self.ptr.as_ptr().add(usrc), self.ptr.as_ptr().add(udst), ucnt);
        }
        Ok(count)
    }

    pub fn release(&mut self) -> isize {
        if self.cap > 0 {
            let layout = Layout::array::<i64>(self.cap).unwrap();
            unsafe {
                dealloc(self.ptr.as_ptr() as *mut u8, layout);
            }
            self.ptr = NonNull::dangling();
            self.cap = 0;
        }
        0
    }
}

impl Drop for RawBuf {
    fn drop(&mut self) {
        self.release();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_mem_01_raw_buf_alloc_grow_copy_release() {
        let mut buf = RawBuf::new(4).unwrap();
        assert_eq!(buf.capacity(), 4);
        assert_eq!(buf.write_at(0, 100).unwrap(), 100);
        assert_eq!(buf.write_at(1, 200).unwrap(), 200);
        assert_eq!(buf.read_at(0).unwrap(), 100);
        assert_eq!(buf.read_at(1).unwrap(), 200);
        assert_eq!(buf.grow(7).unwrap(), 8);
        assert_eq!(buf.read_at(0).unwrap(), 100);
        assert_eq!(buf.read_at(1).unwrap(), 200);
        assert_eq!(buf.copy_within(0, 1, 2).unwrap(), 2);
        assert_eq!(buf.read_at(1).unwrap(), 100);
        assert_eq!(buf.read_at(2).unwrap(), 200);
        assert_eq!(buf.release(), 0);
        assert_eq!(buf.capacity(), 0);
    }

    #[test]
    fn ex_std_mem_02_raw_buf_bounds_and_overflow() {
        let mut buf = RawBuf::new(2).unwrap();
        assert_eq!(buf.read_at(2), Err(MemError::OutOfBounds));
        assert_eq!(buf.read_at(-1), Err(MemError::OutOfBounds));
        assert_eq!(buf.write_at(5, 42), Err(MemError::OutOfBounds));
        assert_eq!(buf.copy_within(0, 1, 2), Err(MemError::OutOfBounds));
        assert_eq!(buf.grow(2_000_000), Err(MemError::CapacityOverflow));
        assert_eq!(buf.release(), 0);
    }
}

