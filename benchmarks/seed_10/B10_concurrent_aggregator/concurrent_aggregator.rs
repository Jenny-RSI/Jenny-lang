#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AggError {
    InvalidTimeout,
    NegativeLatency,
    AllReplicasTimedOut,
    SourceTimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RaceOutcome {
    pub winner_id: i32,
    pub selected_latency_ms: i64,
    pub timeout_ms: i64,
}

impl RaceOutcome {
    pub fn check_invariant(&self) {
        assert!(self.winner_id == 1 || self.winner_id == 2);
        assert!(self.selected_latency_ms >= 0);
        assert!(self.selected_latency_ms <= self.timeout_ms);
    }
}

pub fn select_fastest_replica(
    primary_latency_ms: i64,
    secondary_latency_ms: i64,
    timeout_ms: i64,
) -> Result<RaceOutcome, AggError> {
    if !(timeout_ms > 0) {
        return Err(AggError::InvalidTimeout);
    }
    if !(primary_latency_ms >= 0 && secondary_latency_ms >= 0) {
        return Err(AggError::NegativeLatency);
    }
    let best_lat = if primary_latency_ms <= secondary_latency_ms {
        primary_latency_ms
    } else {
        secondary_latency_ms
    };
    let best_id: i32 = if primary_latency_ms <= secondary_latency_ms {
        1
    } else {
        2
    };
    if !(best_lat <= timeout_ms) {
        return Err(AggError::AllReplicasTimedOut);
    }
    let result = RaceOutcome {
        winner_id: best_id,
        selected_latency_ms: best_lat,
        timeout_ms,
    };
    result.check_invariant();
    assert!(result.selected_latency_ms <= timeout_ms);
    Ok(result)
}

pub fn aggregate_both_sources(
    val_a: i64,
    lat_a_ms: i64,
    val_b: i64,
    lat_b_ms: i64,
    timeout_ms: i64,
) -> Result<i64, AggError> {
    if !(timeout_ms > 0) {
        return Err(AggError::InvalidTimeout);
    }
    if !(lat_a_ms >= 0 && lat_b_ms >= 0) {
        return Err(AggError::NegativeLatency);
    }
    if !(lat_a_ms <= timeout_ms && lat_b_ms <= timeout_ms) {
        return Err(AggError::SourceTimedOut);
    }
    Ok(val_a + val_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b10_01_replica_race_and_aggregation() {
        let race1 = select_fastest_replica(85, 32, 100).unwrap();
        assert_eq!(race1.winner_id, 2);
        assert_eq!(race1.selected_latency_ms, 32);

        let race2 = select_fastest_replica(45, 250, 100).unwrap();
        assert_eq!(race2.winner_id, 1);
        assert_eq!(race2.selected_latency_ms, 45);

        let combined = aggregate_both_sources(100, 40, 250, 75, 100).unwrap();
        assert_eq!(combined, 350);
    }

    #[test]
    fn ex_b10_02_sla_timeout_circuit_breaking() {
        assert_eq!(
            select_fastest_replica(150, 220, 100),
            Err(AggError::AllReplicasTimedOut)
        );
        assert_eq!(
            aggregate_both_sources(100, 40, 250, 120, 100),
            Err(AggError::SourceTimedOut)
        );
    }
}
