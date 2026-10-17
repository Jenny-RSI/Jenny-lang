#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AstError {
    DivisionByZero,
    UnknownTag,
}

#[derive(Debug, Clone, Copy)]
pub struct AstNode {
    pub tag: i64,
    pub literal_val: i64,
    pub lhs_val: i64,
    pub rhs_val: i64,
}

impl AstNode {
    pub fn check_invariant(&self) {
        assert!(self.tag >= 0 && self.tag <= 3);
    }
}

pub struct BumpArena {
    pub buf: Vec<AstNode>,
}

impl BumpArena {
    pub fn with_capacity(cap: usize) -> Self {
        Self {
            buf: Vec::with_capacity(cap),
        }
    }

    pub fn alloc(&mut self, node: AstNode) -> &mut AstNode {
        node.check_invariant();
        self.buf.push(node);
        self.buf.last_mut().unwrap()
    }

    pub fn alloc_count(&self) -> usize {
        self.buf.len()
    }

    pub fn reset(&mut self) {
        self.buf.clear();
    }
}

pub fn eval_node(node: &AstNode) -> Result<i64, AstError> {
    node.check_invariant();
    if node.tag == 0 {
        return Ok(node.literal_val);
    }
    if node.tag == 1 {
        return Ok(node.lhs_val + node.rhs_val);
    }
    if node.tag == 2 {
        return Ok(node.lhs_val * node.rhs_val);
    }
    if node.tag == 3 {
        if node.rhs_val == 0 {
            return Err(AstError::DivisionByZero);
        }
        return Ok(node.lhs_val / node.rhs_val);
    }
    Err(AstError::UnknownTag)
}

pub fn alloc_literal<'a>(arena: &'a mut BumpArena, val: i64) -> &'a mut AstNode {
    let old_count = arena.alloc_count();
    let res = arena.alloc(AstNode {
        tag: 0,
        literal_val: val,
        lhs_val: 0,
        rhs_val: 0,
    });
    assert!(arena.alloc_count() == old_count + 1);
    res
}

pub fn alloc_binary<'a>(
    arena: &'a mut BumpArena,
    tag: i64,
    lhs_val: i64,
    rhs_val: i64,
) -> Result<&'a mut AstNode, AstError> {
    let old_count = arena.alloc_count();
    if tag < 1 || tag > 3 {
        return Err(AstError::UnknownTag);
    }
    let res = arena.alloc(AstNode {
        tag,
        literal_val: 0,
        lhs_val,
        rhs_val,
    });
    assert!(arena.alloc_count() == old_count + 1);
    Ok(res)
}

pub fn eval_formula_in_arena(a: i64, b: i64, c: i64) -> Result<i64, AstError> {
    let mut arena = BumpArena::with_capacity(64);
    let va = {
        let na = alloc_literal(&mut arena, a);
        eval_node(na)?
    };
    let vb = {
        let nb = alloc_literal(&mut arena, b);
        eval_node(nb)?
    };
    let vc = {
        let nc = alloc_literal(&mut arena, c);
        eval_node(nc)?
    };
    let v_add = {
        let n_add = alloc_binary(&mut arena, 1, va, vb)?;
        eval_node(n_add)?
    };
    let v_mul = {
        let n_mul = alloc_binary(&mut arena, 2, v_add, vc)?;
        eval_node(n_mul)?
    };
    arena.reset();
    Ok(v_mul)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b15_01_arena_ast_construction_and_batch_release() {
        let mut arena = BumpArena::with_capacity(64);
        assert_eq!(arena.alloc_count(), 0);

        let v1 = {
            let n1 = alloc_literal(&mut arena, 15);
            eval_node(n1).unwrap()
        };
        let v2 = {
            let n2 = alloc_literal(&mut arena, 25);
            eval_node(n2).unwrap()
        };
        assert_eq!(arena.alloc_count(), 2);

        let sum = {
            let add_node = alloc_binary(&mut arena, 1, v1, v2).unwrap();
            eval_node(add_node).unwrap()
        };
        assert_eq!(sum, 40);
        assert_eq!(arena.alloc_count(), 3);

        arena.reset();
        assert_eq!(arena.alloc_count(), 0);
    }

    #[test]
    fn ex_b15_02_eval_nested_formula() {
        assert_eq!(eval_formula_in_arena(12, 8, 5).unwrap(), 100);
        assert_eq!(eval_formula_in_arena(-5, 15, 3).unwrap(), 30);
    }
}
