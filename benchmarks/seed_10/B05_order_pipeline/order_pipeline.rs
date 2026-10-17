use std::error::Error;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbError {
    ConnectionTimeout,
    RecordNotFound,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Error for DbError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderBizError {
    InvalidQuantity,
    OutOfStock,
    CouponExceedsGross,
}

impl fmt::Display for OrderBizError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Error for OrderBizError {}

#[derive(Debug)]
pub enum OrderDomainError {
    Biz(OrderBizError),
    Any(Box<dyn Error>),
}

impl From<OrderBizError> for OrderDomainError {
    fn from(e: OrderBizError) -> Self {
        OrderDomainError::Biz(e)
    }
}

impl From<DbError> for OrderDomainError {
    fn from(e: DbError) -> Self {
        OrderDomainError::Any(Box::new(e))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderReceipt {
    pub order_id: i64,
    pub gross_cents: i64,
    pub discount_cents: i64,
    pub final_cents: i64,
}

impl OrderReceipt {
    pub fn check_invariant(&self) {
        assert!(self.gross_cents >= 0);
        assert!(self.discount_cents >= 0);
        assert!(self.final_cents >= 0);
        assert!(self.final_cents == self.gross_cents - self.discount_cents);
    }
}

pub fn query_stock(sku_id: i32) -> Result<i32, DbError> {
    if !(sku_id > 0) {
        return Err(DbError::RecordNotFound);
    }
    if sku_id == 999 {
        return Err(DbError::ConnectionTimeout);
    }
    let result = 10;
    assert!(result >= 0);
    Ok(result)
}

pub fn settle_order(
    order_id: i64,
    sku_id: i32,
    quantity: i32,
    unit_cents: i64,
    discount_cents: i64,
) -> Result<OrderReceipt, OrderDomainError> {
    if !(quantity > 0) {
        return Err(OrderDomainError::Biz(OrderBizError::InvalidQuantity));
    }
    if !(unit_cents >= 0) {
        return Err(OrderDomainError::Biz(OrderBizError::InvalidQuantity));
    }
    if !(discount_cents >= 0) {
        return Err(OrderDomainError::Biz(OrderBizError::CouponExceedsGross));
    }
    let available = query_stock(sku_id)?;
    if !(quantity <= available) {
        return Err(OrderDomainError::Biz(OrderBizError::OutOfStock));
    }
    let gross = (quantity as i64) * unit_cents;
    if !(discount_cents <= gross) {
        return Err(OrderDomainError::Biz(OrderBizError::CouponExceedsGross));
    }
    let final_amt = gross - discount_cents;
    let result = OrderReceipt {
        order_id,
        gross_cents: gross,
        discount_cents,
        final_cents: final_amt,
    };
    result.check_invariant();
    assert!(result.final_cents >= 0);
    assert!(result.final_cents <= result.gross_cents);
    Ok(result)
}

pub fn checkout_endpoint(
    order_id: i64,
    sku_id: i32,
    quantity: i32,
) -> Result<i64, Box<dyn Error>> {
    let receipt = match settle_order(order_id, sku_id, quantity, 2000, 200) {
        Ok(r) => r,
        Err(OrderDomainError::Biz(b)) => return Err(Box::new(b)),
        Err(OrderDomainError::Any(a)) => return Err(a),
    };
    let result = receipt.final_cents;
    assert!(result >= 0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b05_01_error_truncation_and_settlement() {
        let receipt = settle_order(1001, 42, 3, 2000, 500).unwrap();
        assert_eq!(receipt.gross_cents, 6000);
        assert_eq!(receipt.discount_cents, 500);
        assert_eq!(receipt.final_cents, 5500);

        let paid = checkout_endpoint(1002, 42, 2).unwrap();
        assert_eq!(paid, 3800);

        let stock_err = settle_order(1003, 42, 99, 2000, 0);
        assert!(matches!(
            stock_err,
            Err(OrderDomainError::Biz(OrderBizError::OutOfStock))
        ));

        let db_err = settle_order(1004, 999, 1, 2000, 0);
        if let Err(OrderDomainError::Any(any_err)) = db_err {
            assert_eq!(any_err.downcast_ref::<DbError>(), Some(&DbError::ConnectionTimeout));
        } else {
            panic!("Expected DbError::ConnectionTimeout");
        }
    }
}
