#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpError {
    EmptyMethod,
    EmptyPath,
    NegativeContentLen,
    InvalidHost,
}

#[derive(Debug, Clone, Copy)]
pub struct HttpRequestView<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub host: &'a str,
    pub content_len: i64,
}

impl<'a> HttpRequestView<'a> {
    pub fn check_invariant(&self) {
        assert!(self.content_len >= 0);
        assert!(!self.method.is_empty());
        assert!(!self.path.is_empty());
    }

    pub fn is_post_upload(&self) -> bool {
        self.check_invariant();
        self.method == "POST" && self.content_len > 0
    }

    pub fn route_score(&self) -> i64 {
        self.check_invariant();
        let method_weight = if self.method == "POST" {
            200
        } else if self.method == "GET" {
            100
        } else {
            50
        };
        let path_bonus = (self.path.len() as i64) * 10;
        let result = method_weight + path_bonus + self.content_len;
        assert!(result >= 0);
        result
    }
}

pub fn build_request_view<'a>(
    method: &'a str,
    path: &'a str,
    host: &'a str,
    content_len: i64,
) -> Result<HttpRequestView<'a>, HttpError> {
    if method.is_empty() {
        return Err(HttpError::EmptyMethod);
    }
    if path.is_empty() {
        return Err(HttpError::EmptyPath);
    }
    if host.is_empty() {
        return Err(HttpError::InvalidHost);
    }
    if content_len < 0 {
        return Err(HttpError::NegativeContentLen);
    }
    let view = HttpRequestView {
        method,
        path,
        host,
        content_len,
    };
    view.check_invariant();
    Ok(view)
}

pub fn inspect_and_route<'a>(
    method: &'a str,
    path: &'a str,
    host: &'a str,
    content_len: i64,
) -> Result<i64, HttpError> {
    let view = build_request_view(method, path, host, content_len)?;
    let base = view.route_score();
    let result = if view.is_post_upload() {
        base + 1000
    } else {
        base
    };
    assert!(result >= 0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b14_01_zero_copy_request_view_routing() {
        let v = build_request_view("POST", "/v1/ingest", "api.jenny.dev", 256).unwrap();
        assert!(v.is_post_upload());
        assert_eq!(v.route_score(), 556);

        let routed = inspect_and_route("POST", "/v1/ingest", "api.jenny.dev", 256).unwrap();
        assert_eq!(routed, 1556);

        let get_routed = inspect_and_route("GET", "/health", "api.jenny.dev", 0).unwrap();
        assert_eq!(get_routed, 170);
    }

    #[test]
    fn ex_b14_02_reject_invalid_fields() {
        assert_eq!(
            inspect_and_route("GET", "/health", "", 0),
            Err(HttpError::InvalidHost)
        );
        assert_eq!(
            inspect_and_route("POST", "/v1/ingest", "api.jenny.dev", -5),
            Err(HttpError::NegativeContentLen)
        );
    }
}
