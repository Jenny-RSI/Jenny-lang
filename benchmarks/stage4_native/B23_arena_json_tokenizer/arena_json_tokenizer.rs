#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonScanError {
    EmptyPayload,
    UnbalancedBraces,
    MissingColon,
    ContractViolation(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JsonStats {
    pub pair_count: i64,
    pub colon_count: i64,
    pub byte_len: i64,
}

impl JsonStats {
    pub fn check_invariant(&self) -> Result<(), JsonScanError> {
        if self.pair_count < 0 {
            return Err(JsonScanError::ContractViolation("invariant self.pair_count >= 0"));
        }
        if self.colon_count < 0 {
            return Err(JsonScanError::ContractViolation("invariant self.colon_count >= 0"));
        }
        if self.byte_len < 0 {
            return Err(JsonScanError::ContractViolation("invariant self.byte_len >= 0"));
        }
        Ok(())
    }
}

pub struct Arena {
    storage: Vec<JsonStats>,
}

impl Arena {
    pub fn new(capacity: usize) -> Self {
        Self {
            storage: Vec::with_capacity(capacity),
        }
    }

    pub fn alloc(&mut self, item: JsonStats) -> &JsonStats {
        self.storage.push(item);
        self.storage.last().unwrap()
    }
}

pub fn scan_json_object<'a>(
    payload: &str,
    arena: &'a mut Arena,
) -> Result<&'a JsonStats, JsonScanError> {
    if payload.len() < 2 {
        return Err(JsonScanError::EmptyPayload);
    }
    let bytes = payload.as_bytes();
    let n = bytes.len();
    if bytes[0] != b'{' || bytes[n - 1] != b'}' {
        return Err(JsonScanError::UnbalancedBraces);
    }
    let mut colons: i64 = 0;
    let mut commas: i64 = 0;
    let mut idx: usize = 1;
    while idx < n - 1 {
        let b = bytes[idx];
        if b == b':' {
            colons += 1;
        }
        if b == b',' {
            commas += 1;
        }
        idx += 1;
    }
    if n > 2 && colons != commas + 1 {
        return Err(JsonScanError::MissingColon);
    }
    let item = JsonStats {
        pair_count: colons,
        colon_count: colons,
        byte_len: n as i64,
    };
    item.check_invariant()?;
    let stats = arena.alloc(item);
    if stats.byte_len != payload.len() as i64 {
        return Err(JsonScanError::ContractViolation("ensures result.byte_len == payload.len()"));
    }
    if stats.pair_count != stats.colon_count {
        return Err(JsonScanError::ContractViolation("ensures result.pair_count == result.colon_count"));
    }
    Ok(stats)
}

pub fn validate_and_count_keys(payload: &str) -> Result<i64, JsonScanError> {
    if payload.len() < 2 {
        return Err(JsonScanError::EmptyPayload);
    }
    let mut arena = Arena::new(256);
    let stats = scan_json_object(payload, &mut arena)?;
    let result = stats.pair_count;
    if result < 0 {
        return Err(JsonScanError::ContractViolation("ensures result >= 0"));
    }
    Ok(result)
}
