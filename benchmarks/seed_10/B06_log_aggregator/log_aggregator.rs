#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogError {
    InvalidLevel,
    NegativeLatency,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogAggregator {
    pub total_logs: usize,
    pub warn_count: usize,
    pub error_count: usize,
    pub total_latency_ms: i64,
    pub max_latency_ms: i64,
}

impl LogAggregator {
    pub fn check_invariant(&self) {
        assert!(self.error_count <= self.total_logs);
        assert!(self.warn_count <= self.total_logs);
        assert!(self.total_latency_ms >= 0);
        assert!(self.max_latency_ms >= 0);
    }

    pub fn new() -> LogAggregator {
        let result = LogAggregator {
            total_logs: 0,
            warn_count: 0,
            error_count: 0,
            total_latency_ms: 0,
            max_latency_ms: 0,
        };
        result.check_invariant();
        assert!(result.total_logs == 0);
        assert!(result.max_latency_ms == 0);
        result
    }

    pub fn ingest(&mut self, level: i32, latency_ms: i64) -> Result<(), LogError> {
        self.check_invariant();
        if !(level >= 1 && level <= 3) {
            return Err(LogError::InvalidLevel);
        }
        if !(latency_ms >= 0) {
            return Err(LogError::NegativeLatency);
        }
        let old_total = self.total_logs;
        self.total_logs += 1;
        let warn_inc: usize = if level == 2 { 1 } else { 0 };
        let err_inc: usize = if level == 3 { 1 } else { 0 };
        self.warn_count += warn_inc;
        self.error_count += err_inc;
        self.total_latency_ms += latency_ms;
        let next_max = if latency_ms > self.max_latency_ms {
            latency_ms
        } else {
            self.max_latency_ms
        };
        self.max_latency_ms = next_max;
        self.check_invariant();
        assert!(self.total_logs == old_total + 1);
        assert!(self.max_latency_ms >= latency_ms);
        Ok(())
    }

    pub fn is_unhealthy(&self, max_allowed_errors: usize) -> bool {
        self.check_invariant();
        let result = self.error_count > max_allowed_errors;
        assert!(result == (self.error_count > max_allowed_errors));
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b06_01_streaming_log_ingestion() {
        let mut agg = LogAggregator::new();
        agg.ingest(1, 25).unwrap();
        agg.ingest(2, 120).unwrap();
        agg.ingest(3, 85).unwrap();
        assert_eq!(agg.total_logs, 3);
        assert_eq!(agg.warn_count, 1);
        assert_eq!(agg.error_count, 1);
        assert_eq!(agg.total_latency_ms, 230);
        assert_eq!(agg.max_latency_ms, 120);
        assert!(!agg.is_unhealthy(2));
    }

    #[test]
    fn ex_b06_02_reject_invalid_logs() {
        let mut agg = LogAggregator::new();
        assert_eq!(agg.ingest(9, 10), Err(LogError::InvalidLevel));
        assert_eq!(agg.ingest(1, -5), Err(LogError::NegativeLatency));
    }
}
