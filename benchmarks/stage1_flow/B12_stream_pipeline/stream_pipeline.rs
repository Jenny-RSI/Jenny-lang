#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipelineError {
    NegativeScale,
    RawOutOfRange,
}

pub fn scale_raw(val: i64, factor: i64) -> i64 {
    let result = val * factor;
    assert!(result == val * factor);
    result
}

pub fn apply_bias(val: i64, bias: i64) -> i64 {
    let result = val + bias;
    assert!(result == val + bias);
    result
}

pub fn clamp_score(val: i64, low: i64, high: i64) -> i64 {
    let c_low = if val < low { low } else { val };
    let result = if c_low > high { high } else { c_low };
    assert!(result >= low && result <= high);
    result
}

pub fn execute_pipeline(
    raw_val: i64,
    scale_factor: i64,
    custom_bias: Option<i64>,
) -> Result<i64, PipelineError> {
    if !(raw_val >= -10000 && raw_val <= 10000) {
        return Err(PipelineError::RawOutOfRange);
    }
    if !(scale_factor >= 0) {
        return Err(PipelineError::NegativeScale);
    }
    let bias = match custom_bias {
        Some(b) => b,
        None => 50,
    };
    let scaled = scale_raw(raw_val, scale_factor);
    let biased = apply_bias(scaled, bias);
    let result = clamp_score(biased, 0, 1000);
    assert!(result >= 0 && result <= 1000);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b12_01_pipe_and_optional_coalesce() {
        let res_default = execute_pipeline(40, 10, None).unwrap();
        assert_eq!(res_default, 450);

        let res_custom = execute_pipeline(40, 10, Some(120)).unwrap();
        assert_eq!(res_custom, 520);

        let res_clamped = execute_pipeline(200, 10, None).unwrap();
        assert_eq!(res_clamped, 1000);
    }

    #[test]
    fn ex_b12_02_reject_invalid_inputs() {
        assert_eq!(
            execute_pipeline(10, -2, None),
            Err(PipelineError::NegativeScale)
        );
        assert_eq!(
            execute_pipeline(99999, 1, None),
            Err(PipelineError::RawOutOfRange)
        );
    }
}
