use std::error::Error;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedisError {
    CacheMiss,
    SocketClosed,
}

impl fmt::Display for RedisError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Error for RedisError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbError {
    Deadlock,
    ConnReset,
    RecordMissing,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Error for DbError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GatewayBizError {
    InvalidQuantity,
    CreditLimitExceeded,
}

impl fmt::Display for GatewayBizError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Error for GatewayBizError {}

#[derive(Debug)]
pub struct TracedAnyError {
    pub inner: Box<dyn Error>,
    pub trace_depth: usize,
}

#[derive(Debug)]
pub enum ServiceError {
    Biz(GatewayBizError),
    Any(TracedAnyError),
}

impl From<GatewayBizError> for ServiceError {
    fn from(e: GatewayBizError) -> Self {
        ServiceError::Biz(e)
    }
}

impl From<TracedAnyError> for ServiceError {
    fn from(e: TracedAnyError) -> Self {
        ServiceError::Any(
            TracedAnyError {
                inner: e.inner,
                trace_depth: e.trace_depth + 1,
            }
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GatewayReceipt {
    pub user_id: i64,
    pub subtotal: i64,
    pub tax_cents: i64,
    pub total_charged: i64,
}

impl GatewayReceipt {
    pub fn check_invariant(&self) {
        assert!(self.subtotal >= 0);
        assert!(self.tax_cents >= 0);
        assert!(self.total_charged >= self.subtotal);
        assert!(self.total_charged == self.subtotal + self.tax_cents);
    }
}

pub fn cache_get_price(sku_id: i32) -> Result<i64, RedisError> {
    if !(sku_id > 0) {
        return Err(RedisError::CacheMiss);
    }
    if sku_id != 10 {
        return Err(RedisError::CacheMiss);
    }
    let result = 1000;
    assert!(result > 0);
    Ok(result)
}

pub fn db_get_price(sku_id: i32) -> Result<i64, DbError> {
    if !(sku_id > 0) {
        return Err(DbError::RecordMissing);
    }
    if sku_id == 500 {
        return Err(DbError::Deadlock);
    }
    let result = 2000;
    assert!(result > 0);
    Ok(result)
}

pub fn repo_resolve_price(sku_id: i32) -> Result<i64, TracedAnyError> {
    let price = match cache_get_price(sku_id) {
        Ok(p) => p,
        Err(_err) => match db_get_price(sku_id) {
            Ok(p2) => p2,
            Err(db_e) => {
                return Err(TracedAnyError {
                    inner: Box::new(db_e),
                    trace_depth: 2,
                })
            }
        },
    };
    assert!(price > 0);
    Ok(price)
}

pub fn service_settle_checkout(
    user_id: i64,
    sku_id: i32,
    qty: i32,
    tax_bps: i64,
) -> Result<GatewayReceipt, ServiceError> {
    if !(qty > 0) {
        return Err(ServiceError::Biz(GatewayBizError::InvalidQuantity));
    }
    if !(tax_bps >= 0) {
        return Err(ServiceError::Biz(GatewayBizError::InvalidQuantity));
    }
    let unit_price = repo_resolve_price(sku_id)?;
    let sub = unit_price * (qty as i64);
    if !(sub <= 100000) {
        return Err(ServiceError::Biz(GatewayBizError::CreditLimitExceeded));
    }
    let tax = (sub * tax_bps) / 10000;
    let total = sub + tax;
    let result = GatewayReceipt {
        user_id,
        subtotal: sub,
        tax_cents: tax,
        total_charged: total,
    };
    result.check_invariant();
    assert!(result.total_charged >= result.subtotal);
    Ok(result)
}

pub fn controller_handle_checkout(
    user_id: i64,
    sku_id: i32,
    qty: i32,
) -> Result<i64, TracedAnyError> {
    let receipt = match service_settle_checkout(user_id, sku_id, qty, 800) {
        Ok(r) => r,
        Err(ServiceError::Biz(b)) => {
            return Err(TracedAnyError {
                inner: Box::new(b),
                trace_depth: 2,
            })
        }
        Err(ServiceError::Any(a)) => {
            return Err(TracedAnyError {
                inner: a.inner,
                trace_depth: a.trace_depth + 1,
            })
        }
    };
    let result = receipt.total_charged;
    assert!(result > 0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b11_01_normal_checkout_and_fallback() {
        let hit_total = controller_handle_checkout(77, 10, 2).unwrap();
        assert_eq!(hit_total, 2160);

        let fallback_total = controller_handle_checkout(77, 20, 3).unwrap();
        assert_eq!(fallback_total, 6480);
    }

    #[test]
    fn ex_b11_02_downcasting_and_error_handling() {
        let biz_err = service_settle_checkout(77, 10, 500, 800);
        assert!(matches!(
            biz_err,
            Err(ServiceError::Biz(GatewayBizError::CreditLimitExceeded))
        ));

        let infra_err = controller_handle_checkout(77, 500, 1);
        if let Err(traced) = infra_err {
            assert_eq!(traced.inner.downcast_ref::<DbError>(), Some(&DbError::Deadlock));
            assert_eq!(traced.trace_depth, 4);
        } else {
            panic!("Expected DbError::Deadlock");
        }
    }
}
