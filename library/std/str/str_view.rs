// Rust `core::str` Sub-Slice Window Equivalent Baseline (`std::str::str_view`)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrError {
    InvalidBounds,
    SliceOutOfRange,
    EmptySlice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StrSliceView {
    pub start: isize,
    pub len: isize,
    pub source_cap: isize,
}

impl StrSliceView {
    pub fn from_bounds(start: isize, len: isize, source_cap: isize) -> Result<Self, StrError> {
        if source_cap < 0 || start < 0 || len < 0 {
            return Err(StrError::InvalidBounds);
        }
        if start + len > source_cap {
            return Err(StrError::SliceOutOfRange);
        }
        Ok(Self {
            start,
            len,
            source_cap,
        })
    }

    pub fn len(&self) -> isize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn end_offset(&self) -> isize {
        self.start + self.len
    }

    pub fn advance(&mut self, count: isize) -> Result<isize, StrError> {
        if count < 0 || count > self.len {
            return Err(StrError::SliceOutOfRange);
        }
        self.start += count;
        self.len -= count;
        Ok(self.len)
    }

    pub fn truncate_len(&mut self, new_len: isize) -> Result<isize, StrError> {
        if new_len < 0 || new_len > self.len {
            return Err(StrError::SliceOutOfRange);
        }
        self.len = new_len;
        Ok(self.len)
    }

    pub fn sub_slice(&self, rel_off: isize, sub_len: isize) -> Result<Self, StrError> {
        if rel_off < 0 || sub_len < 0 {
            return Err(StrError::InvalidBounds);
        }
        if rel_off + sub_len > self.len {
            return Err(StrError::SliceOutOfRange);
        }
        Ok(Self {
            start: self.start + rel_off,
            len: sub_len,
            source_cap: self.source_cap,
        })
    }

    pub fn slice_str<'a>(&self, raw: &'a str) -> Result<&'a str, StrError> {
        if (raw.len() as isize) < self.start + self.len {
            return Err(StrError::SliceOutOfRange);
        }
        let s = self.start as usize;
        let e = (self.start + self.len) as usize;
        Ok(&raw[s..e])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_strview_01_sub_slice_advance_truncate() {
        let raw = "0123JennyNativeStrSlice456789";
        let mut view = StrSliceView::from_bounds(4, 19, 29).unwrap();
        assert_eq!(view.len(), 19);
        assert!(!view.is_empty());
        assert_eq!(view.end_offset(), 23);

        let extracted = view.slice_str(raw).unwrap();
        assert_eq!(extracted.len(), 19);
        assert_eq!(extracted.as_bytes()[0], 74);
        assert_eq!(extracted, "JennyNativeStrSlice");

        let sub = view.sub_slice(5, 6).unwrap();
        assert_eq!(sub.start, 9);
        assert_eq!(sub.len, 6);
        assert_eq!(sub.end_offset(), 15);
        let sub_s = sub.slice_str(raw).unwrap();
        assert_eq!(sub_s, "Native");

        assert_eq!(view.advance(5).unwrap(), 14);
        assert_eq!(view.start, 9);
        assert_eq!(view.truncate_len(6).unwrap(), 6);
        assert_eq!(view.end_offset(), 15);
        assert_eq!(view.slice_str(raw).unwrap(), "Native");
    }

    #[test]
    fn ex_std_strview_02_reject_oob() {
        assert_eq!(StrSliceView::from_bounds(50, 20, 64), Err(StrError::SliceOutOfRange));
        assert_eq!(StrSliceView::from_bounds(-1, 10, 64), Err(StrError::InvalidBounds));

        let mut view = StrSliceView::from_bounds(0, 12, 32).unwrap();
        assert_eq!(view.advance(13), Err(StrError::SliceOutOfRange));
        assert_eq!(view.sub_slice(8, 6), Err(StrError::SliceOutOfRange));
        assert_eq!(view.truncate_len(15), Err(StrError::SliceOutOfRange));
    }
}
