// Rust `std::path::PathBuf` Normalized Component Stack Equivalent Baseline (`std::io::path_buf`)

use crate::mem::raw_buf::{MemError, RawBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathError {
    EmptyPath,
    InvalidSegment,
    TraversalEscape,
    CapacityOverflow,
}

impl From<MemError> for PathError {
    fn from(_: MemError) -> Self {
        PathError::CapacityOverflow
    }
}

pub struct PathBuf {
    buf: RawBuf,
    pub depth: isize,
    pub is_abs: i64,
}

impl PathBuf {
    pub fn new(is_abs: i64) -> Result<Self, PathError> {
        if is_abs != 0 && is_abs != 1 {
            return Err(PathError::InvalidSegment);
        }
        Ok(Self {
            buf: RawBuf::new(0).unwrap(),
            depth: 0,
            is_abs,
        })
    }

    pub fn depth(&self) -> isize {
        self.depth
    }

    pub fn push_segment(&mut self, seg_id: i64) -> Result<isize, PathError> {
        if seg_id <= 0 {
            return Err(PathError::InvalidSegment);
        }
        if self.depth >= 65_536 {
            return Err(PathError::CapacityOverflow);
        }
        if self.depth == self.buf.capacity() {
            self.buf.grow(self.depth + 1)?;
        }
        self.buf.write_at(self.depth, seg_id)?;
        self.depth += 1;
        Ok(self.depth)
    }

    pub fn pop_segment(&mut self) -> Result<i64, PathError> {
        if self.depth <= 0 {
            return Err(PathError::EmptyPath);
        }
        self.depth -= 1;
        Ok(self.buf.read_at(self.depth)?)
    }

    pub fn normalize_parent(&mut self) -> Result<isize, PathError> {
        if self.depth <= 0 {
            return Err(PathError::TraversalEscape);
        }
        self.depth -= 1;
        Ok(self.depth)
    }

    pub fn leaf_segment(&self) -> Result<i64, PathError> {
        if self.depth <= 0 {
            return Err(PathError::EmptyPath);
        }
        Ok(self.buf.read_at(self.depth - 1)?)
    }

    pub fn drop_path(&mut self) -> isize {
        self.buf.release();
        self.depth = 0;
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_std_path_01_push_leaf_normalize_pop_drop() {
        let mut p = PathBuf::new(1).unwrap();
        assert_eq!(p.depth(), 0);
        assert_eq!(p.push_segment(10).unwrap(), 1);
        assert_eq!(p.push_segment(20).unwrap(), 2);
        assert_eq!(p.push_segment(30).unwrap(), 3);
        assert_eq!(p.leaf_segment().unwrap(), 30);
        assert_eq!(p.normalize_parent().unwrap(), 2);
        assert_eq!(p.leaf_segment().unwrap(), 20);
        assert_eq!(p.pop_segment().unwrap(), 20);
        assert_eq!(p.depth(), 1);
        assert_eq!(p.drop_path(), 0);
    }

    #[test]
    fn ex_std_path_02_block_traversal_escape_and_invalid() {
        let mut p = PathBuf::new(0).unwrap();
        assert_eq!(p.normalize_parent(), Err(PathError::TraversalEscape));
        assert_eq!(p.pop_segment(), Err(PathError::EmptyPath));
        assert_eq!(p.push_segment(0), Err(PathError::InvalidSegment));
        assert_eq!(p.push_segment(-5), Err(PathError::InvalidSegment));
        assert_eq!(p.drop_path(), 0);
    }
}
