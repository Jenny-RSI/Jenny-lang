// Rust 2021 Safe Idiomatic Baseline — B21: Declarative CRUD Service (spin_crud_service)
// Notice the repetitive audit_seq bookkeeping, invariant checks, cache counters,
// and error guards across every CRUD method that `@apply(crud::service)` synthesizes.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceError {
    NotFound,
    DuplicateKey,
    InvalidBalance,
    QuotaExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountService {
    pub active_count: i64,
    pub total_balance: i64,
    pub cache_hits: i64,
    pub audit_seq: i64,
}

impl AccountService {
    pub const TABLE_NAME: &'static str = "accounts";
    pub const CACHE_TTL_SECS: i64 = 300;
    pub const MAX_RETRIES: i64 = 3;
    pub const MAX_ACCOUNTS_QUOTA: i64 = 1000;

    #[inline]
    fn assert_invariants(&self) {
        debug_assert!(self.active_count >= 0 && self.active_count <= Self::MAX_ACCOUNTS_QUOTA);
        debug_assert!(self.total_balance >= 0 && self.audit_seq >= 0);
    }

    pub fn new() -> Self {
        let svc = Self {
            active_count: 0,
            total_balance: 0,
            cache_hits: 0,
            audit_seq: 0,
        };
        svc.assert_invariants();
        debug_assert!(svc.active_count == 0 && svc.total_balance == 0);
        svc
    }

    pub fn create_account(&mut self, initial_balance: i64) -> Result<i64, ServiceError> {
        self.assert_invariants();
        if initial_balance < 0 {
            return Err(ServiceError::InvalidBalance);
        }
        if self.active_count >= Self::MAX_ACCOUNTS_QUOTA {
            return Err(ServiceError::QuotaExceeded);
        }
        let old_count = self.active_count;
        let old_audit = self.audit_seq;
        self.active_count += 1;
        self.total_balance += initial_balance;
        self.audit_seq += 1;
        self.assert_invariants();
        debug_assert!(self.active_count == old_count + 1);
        debug_assert!(self.audit_seq == old_audit + 1);
        Ok(self.active_count)
    }

    pub fn deposit(&mut self, amount: i64) -> Result<i64, ServiceError> {
        self.assert_invariants();
        if self.active_count <= 0 {
            return Err(ServiceError::NotFound);
        }
        if amount <= 0 {
            return Err(ServiceError::InvalidBalance);
        }
        let old_bal = self.total_balance;
        let old_audit = self.audit_seq;
        self.total_balance += amount;
        self.audit_seq += 1;
        self.assert_invariants();
        debug_assert!(self.total_balance == old_bal + amount);
        debug_assert!(self.audit_seq == old_audit + 1);
        Ok(self.total_balance)
    }

    pub fn query_summary(&mut self) -> i64 {
        self.assert_invariants();
        let old_hits = self.cache_hits;
        self.cache_hits += 1;
        self.assert_invariants();
        debug_assert!(self.cache_hits == old_hits + 1);
        self.total_balance * 100 + self.active_count * 10 + self.cache_hits
    }

    pub fn delete_account(&mut self, balance_to_remove: i64) -> Result<i64, ServiceError> {
        self.assert_invariants();
        if self.active_count <= 0 {
            return Err(ServiceError::NotFound);
        }
        if balance_to_remove < 0 || balance_to_remove > self.total_balance {
            return Err(ServiceError::InvalidBalance);
        }
        let old_count = self.active_count;
        let old_audit = self.audit_seq;
        self.active_count -= 1;
        self.total_balance -= balance_to_remove;
        self.audit_seq += 1;
        self.assert_invariants();
        debug_assert!(self.active_count == old_count - 1);
        debug_assert!(self.audit_seq == old_audit + 1);
        Ok(self.active_count)
    }
}

pub fn execute_account_batch(init_a: i64, init_b: i64, topup: i64) -> Result<i64, ServiceError> {
    if init_a < 0 || init_b < 0 || topup <= 0 {
        return Err(ServiceError::InvalidBalance);
    }
    let mut svc = AccountService::new();
    svc.create_account(init_a)?;
    svc.create_account(init_b)?;
    svc.deposit(topup)?;
    svc.delete_account(init_a)?;
    let result = svc.query_summary();
    debug_assert!(result > 0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b21_01_crud_service_operations_and_audit() {
        let summary = execute_account_batch(100, 200, 50).unwrap();
        assert_eq!(summary, 25011);

        let mut svc = AccountService::new();
        svc.create_account(500).unwrap();
        assert_eq!(svc.query_summary(), 50011);
        assert_eq!(svc.audit_seq, 1);
        assert_eq!(svc.cache_hits, 1);
    }

    #[test]
    fn ex_b21_02_crud_service_error_guards() {
        let mut svc = AccountService::new();
        assert_eq!(svc.deposit(100), Err(ServiceError::NotFound));
        assert_eq!(svc.create_account(-10), Err(ServiceError::InvalidBalance));
    }
}
