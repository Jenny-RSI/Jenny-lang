#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    EmptyInput,
    MissingMethod,
    MissingPath,
    InvalidVersion,
    NegativeLength,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub version: &'a str,
    pub content_length: i64,
    pub keep_alive: bool,
}

impl<'a> HttpRequest<'a> {
    pub fn check_invariant(&self) {
        assert!(!self.method.is_empty());
        assert!(!self.path.is_empty());
        assert!(self.content_length >= 0);
    }
}

pub fn parse_request<'a>(
    raw_method: &'a str,
    raw_path: &'a str,
    version_minor: i32,
    content_length: i64,
) -> Result<HttpRequest<'a>, ParseError> {
    if raw_method.is_empty() {
        return Err(ParseError::EmptyInput);
    }
    if content_length < 0 {
        return Err(ParseError::NegativeLength);
    }
    if raw_path.is_empty() {
        return Err(ParseError::MissingPath);
    }
    if !(version_minor == 0 || version_minor == 1) {
        return Err(ParseError::InvalidVersion);
    }
    let ver_str: &'static str = if version_minor == 1 {
        "HTTP/1.1"
    } else {
        "HTTP/1.0"
    };
    let ka = version_minor == 1;
    let result = HttpRequest {
        method: raw_method,
        path: raw_path,
        version: ver_str,
        content_length,
        keep_alive: ka,
    };
    result.check_invariant();
    assert!(!result.method.is_empty());
    assert!(!result.path.is_empty());
    assert!(result.content_length == content_length);
    Ok(result)
}

pub fn is_post_with_body<'a>(req: &HttpRequest<'a>) -> bool {
    req.check_invariant();
    let result = req.content_length > 0;
    assert!(result == (req.content_length > 0));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ex_b02_01_valid_zero_copy_request() {
        let req = parse_request("POST", "/api/v1/spin", 1, 128).unwrap();
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/api/v1/spin");
        assert_eq!(req.version, "HTTP/1.1");
        assert_eq!(req.content_length, 128);
        assert!(req.keep_alive);
        assert!(is_post_with_body(&req));
    }

    #[test]
    fn ex_b02_02_reject_invalid_requests() {
        let err_empty = parse_request("", "/index.html", 1, 0);
        assert_eq!(err_empty, Err(ParseError::EmptyInput));

        let err_path = parse_request("GET", "", 1, 0);
        assert_eq!(err_path, Err(ParseError::MissingPath));

        let err_ver = parse_request("GET", "/health", 9, 0);
        assert_eq!(err_ver, Err(ParseError::InvalidVersion));

        let err_len = parse_request("POST", "/upload", 1, -5);
        assert_eq!(err_len, Err(ParseError::NegativeLength));
    }
}
