#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RingError {
    Full,
    Empty,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RingBuffer {
    pub data: [i32; 8],
    pub head: usize,
    pub tail: usize,
    pub len: usize,
    pub capacity: usize,
}

impl RingBuffer {
    fn check_invariant(&self) {
        assert!(self.capacity == 8);
        assert!(self.len <= self.capacity);
        assert!(self.head < self.capacity);
        assert!(self.tail < self.capacity);
    }

    pub fn new() -> RingBuffer {
        let rb = RingBuffer {
            data: [0; 8],
            head: 0,
            tail: 0,
            len: 0,
            capacity: 8,
        };
        rb.check_invariant();
        assert!(rb.len == 0);
        assert!(rb.capacity == 8);
        rb
    }

    pub fn is_empty(&self) -> bool {
        self.check_invariant();
        let result = self.len == 0;
        assert!(result == (self.len == 0));
        result
    }

    pub fn is_full(&self) -> bool {
        self.check_invariant();
        let result = self.len == self.capacity;
        assert!(result == (self.len == self.capacity));
        result
    }

    pub fn push(&mut self, val: i32) -> Result<(), RingError> {
        self.check_invariant();
        if !(self.len < self.capacity) {
            return Err(RingError::Full);
        }
        let old_len = self.len;
        self.data[self.tail] = val;
        self.tail = (self.tail + 1) % self.capacity;
        self.len += 1;
        self.check_invariant();
        assert!(self.len == old_len + 1);
        Ok(())
    }

    pub fn pop(&mut self) -> Result<i32, RingError> {
        self.check_invariant();
        if !(self.len > 0) {
            return Err(RingError::Empty);
        }
        let old_len = self.len;
        let item = self.data[self.head];
        self.head = (self.head + 1) % self.capacity;
        self.len -= 1;
        self.check_invariant();
        assert!(self.len == old_len - 1);
        Ok(item)
    }

    pub fn peek(&self) -> Result<i32, RingError> {
        self.check_invariant();
        if !(self.len > 0) {
            return Err(RingError::Empty);
        }
        let old_len = self.len;
        let result = self.data[self.head];
        assert!(self.len == old_len);
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b01_01_normal_push_peek_pop() {
        let mut rb = RingBuffer::new();
        assert!(rb.is_empty());

        rb.push(10).unwrap();
        rb.push(20).unwrap();
        rb.push(30).unwrap();
        assert_eq!(rb.len, 3);
        assert_eq!(rb.peek().unwrap(), 10);

        let first = rb.pop().unwrap();
        assert_eq!(first, 10);
        assert_eq!(rb.len, 2);

        let second = rb.pop().unwrap();
        let third = rb.pop().unwrap();
        assert_eq!(second, 20);
        assert_eq!(third, 30);
        assert!(rb.is_empty());
    }

    #[test]
    fn ex_b01_02_boundary_full_and_empty() {
        let mut rb = RingBuffer::new();
        let empty_res = rb.pop();
        assert_eq!(empty_res, Err(RingError::Empty));

        let mut i: i32 = 0;
        while i < 8 {
            rb.push(i * 10).unwrap();
            i += 1;
        }
        assert!(rb.is_full());

        let full_res = rb.push(999);
        assert_eq!(full_res, Err(RingError::Full));
        assert_eq!(rb.len, 8);
    }
}
