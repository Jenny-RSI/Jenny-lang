#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvalError {
    DivisionByZero,
    InvalidOpCode,
    InvalidBounds,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvalResult {
    pub raw_value: i64,
    pub clamped_value: i64,
    pub min_bound: i64,
    pub max_bound: i64,
}

impl EvalResult {
    pub fn check_invariant(&self) {
        assert!(self.min_bound <= self.max_bound);
        assert!(self.clamped_value >= self.min_bound);
        assert!(self.clamped_value <= self.max_bound);
    }
}

pub fn eval_binary(op_code: i32, lhs: i64, rhs: i64) -> Result<i64, EvalError> {
    if !(op_code >= 1 && op_code <= 4) {
        return Err(EvalError::InvalidOpCode);
    }
    if !(op_code != 4 || rhs != 0) {
        return Err(EvalError::DivisionByZero);
    }
    let res1 = if op_code == 1 { lhs + rhs } else { lhs - rhs };
    let res2 = if op_code == 3 { lhs * rhs } else { res1 };
    let final_val = if op_code == 4 { lhs / rhs } else { res2 };
    Ok(final_val)
}

pub fn eval_and_clamp(
    op_code: i32,
    lhs: i64,
    rhs: i64,
    min_bound: i64,
    max_bound: i64,
) -> Result<EvalResult, EvalError> {
    if !(min_bound <= max_bound) {
        return Err(EvalError::InvalidBounds);
    }
    let raw = eval_binary(op_code, lhs, rhs)?;
    let low_clamped = if raw < min_bound { min_bound } else { raw };
    let clamped = if low_clamped > max_bound {
        max_bound
    } else {
        low_clamped
    };
    let result = EvalResult {
        raw_value: raw,
        clamped_value: clamped,
        min_bound,
        max_bound,
    };
    result.check_invariant();
    assert!(result.clamped_value >= min_bound);
    assert!(result.clamped_value <= max_bound);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b03_01_arithmetic_and_clamping() {
        let sum = eval_binary(1, 40, 2).unwrap();
        assert_eq!(sum, 42);

        let quot = eval_binary(4, 100, 5).unwrap();
        assert_eq!(quot, 20);

        let clamped = eval_and_clamp(3, 50, 10, 0, 255).unwrap();
        assert_eq!(clamped.raw_value, 500);
        assert_eq!(clamped.clamped_value, 255);
    }

    #[test]
    fn ex_b03_02_division_by_zero_and_errors() {
        let div_zero = eval_binary(4, 10, 0);
        assert_eq!(div_zero, Err(EvalError::DivisionByZero));

        let bad_op = eval_binary(99, 1, 2);
        assert_eq!(bad_op, Err(EvalError::InvalidOpCode));

        let bad_bounds = eval_and_clamp(1, 10, 20, 100, 50);
        assert_eq!(bad_bounds, Err(EvalError::InvalidBounds));
    }
}
