use hyper::{
    header::HeaderValue,
    http::{Request, Response},
    HeaderMap,
};
use serde_json::{from_str, Value};

#[derive(Debug)]
pub struct HTTPParts {
    pub headers: HeaderMap<HeaderValue>,
    pub body: Option<String>,
}

impl HTTPParts {
    pub fn get_header(&self, header_name: String) -> Option<String> {
        println!("header-name: {}", header_name);
        return self
            .headers
            .get(header_name)
            .map(|header_value: &HeaderValue| header_value.to_str().unwrap_or("").to_string());
    }

    pub fn get_body(&self, body_path: String) -> Option<String> {
        let json_str = self.body.clone().unwrap_or(r#"{}"#.to_string());
        // Parse the JSON string
        let json_value: Value = from_str(json_str.as_str()).ok()?;
        let result = body_path.split('.').try_fold(&json_value, |current, part| {
            if let Some(index) = part.parse::<usize>().ok() {
                current.get(index)
            } else {
                current.get(part)
            }
        });

        result
            .cloned()
            .map(|x| x.to_string().trim_matches('"').to_string())
    }
}

impl From<&Request<String>> for HTTPParts {
    fn from(request: &Request<String>) -> Self {
        Self {
            headers: request.headers().clone(),
            body: Some(request.body().clone()).filter(|s| !s.is_empty()),
        }
    }
}

impl From<&Response<String>> for HTTPParts {
    fn from(response: &Response<String>) -> Self {
        Self {
            headers: response.headers().clone(),
            body: Some(response.body().clone()).filter(|s| !s.is_empty()),
        }
    }
}

#[derive(Debug)]
struct Redactor {
    request: HTTPParts,
    response: HTTPParts,
}

impl Redactor {
    pub fn new(request: &Request<String>, response: &Response<String>) -> Self {
        Self {
            request: HTTPParts::from(request),
            response: HTTPParts::from(response),
        }
    }

    pub fn get_parameter(&self, parameter_path: String) -> Option<String> {
        let parts: Vec<&str> = parameter_path.split(':').collect();

        let response = match parts.as_slice() {
            ["res", "header", header_name] => self.response.get_header(header_name.to_string()),
            ["res", "body", property_path] => self.response.get_body(property_path.to_string()),
            ["req", "header", header_name] => self.request.get_header(header_name.to_string()),
            ["req", "body", property_path] => self.request.get_body(property_path.to_string()),
            _ => None,
        };

        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_redacted_parameter() {
        // Example Request
        let dummy_request: Request<&str> = Request::builder()
            .header("x-api-key", "my-api-key-value")
            .body(r#"{"name": "John", "age": 30}"#)
            .unwrap();

        // Example Response
        let dummy_response: Response<&str> = Response::builder()
            .header("secret-header", "my-secret-value")
            .body(
                r#"
                {
                    "name": "John",
                    "age": 30,
                    "deep": [0,1,2, {"name":"alex"}]
                }
            "#,
            )
            .unwrap();

        let request = dummy_request.map(|body| body.to_string());
        let response = dummy_response.map(|body| body.to_string());
        let redactor = Redactor::new(&request, &response);

        // test for all four success cases
        let req_header_path_found = redactor.get_parameter("req:header:x-api-key".to_string());
        assert_eq!(req_header_path_found, Some("my-api-key-value".to_string()));

        let req_body_path_found = redactor.get_parameter("req:body:age".to_string());
        assert_eq!(req_body_path_found, Some("30".to_string()));

        let res_header_path_found = redactor.get_parameter("res:header:secret-header".to_string());
        assert_eq!(res_header_path_found, Some("my-secret-value".to_string()));

        let res_body_path_found = redactor.get_parameter("res:body:deep.3.name".to_string());
        assert_eq!(res_body_path_found, Some("alex".to_string()));
    }
}
