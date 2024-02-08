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
        return self
            .headers
            .get(header_name)
            .map(|header_value: &HeaderValue| header_value.to_str().unwrap_or("").to_string());
    }

    pub fn get_body(&self, body_path_option: Option<String>) -> Option<String> {
        match body_path_option {
            Some(body_path) => {
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
            None => Some(self.body.clone().unwrap_or("".to_string())),
        }
    }
}

impl From<Request<String>> for HTTPParts {
    fn from(request: Request<String>) -> Self {
        Self {
            headers: request.headers().clone(),
            body: Some(request.body().clone()).filter(|s| !s.is_empty()),
        }
    }
}

impl From<Response<String>> for HTTPParts {
    fn from(response: Response<String>) -> Self {
        Self {
            headers: response.headers().clone(),
            body: Some(response.body().clone()).filter(|s| !s.is_empty()),
        }
    }
}

#[derive(Debug)]
pub struct Redactor {
    request: HTTPParts,
    response: HTTPParts,
}

impl Redactor {
    pub fn new(request: Request<String>, response: Response<String>) -> Self {
        Self {
            request: HTTPParts::from(request),
            response: HTTPParts::from(response),
        }
    }

    // using a syntax req:header:x-api-key we should be able to get the value of the x-api-key header in the request
    pub fn get_parameter(&self, parameter_path: String) -> Option<String> {
        let parts: Vec<&str> = parameter_path.split(':').collect();

        let response = match parts.as_slice() {
            ["req", "body", ""] => self.request.get_body(None),
            ["res", "body", ""] => self.response.get_body(None),
            ["req", "header", header_name] => self.request.get_header(header_name.to_string()),
            ["res", "header", header_name] => self.response.get_header(header_name.to_string()),
            ["req", "body", property_path] => {
                self.request.get_body(Some(property_path.to_string()))
            }
            ["res", "body", property_path] => {
                self.response.get_body(Some(property_path.to_string()))
            }
            _ => None,
        };

        response
    }

    pub fn get_redacted_values(
        &self,
        comma_seperated_headers: String,
    ) -> (Vec<String>, Vec<String>) {
        let (req_vector, res_vector) =
            Redactor::split_redacted_values(comma_seperated_headers.to_string());

        let redacted_request_values: Vec<String> = req_vector
            .iter()
            .filter_map(|value_path| self.get_parameter(value_path.to_owned()))
            .collect();

        let redacted_response_values: Vec<String> = res_vector
            .iter()
            .filter_map(|value_path| self.get_parameter(value_path.to_owned()))
            .collect();

        (redacted_request_values, redacted_response_values)
    }

    // right now we get all the headers to be redacted as a comma seperated string
    // however when redacting, we need to seperate request redaction from response redactions
    // so this function will take in a string of comma seperated values and return two vectors
    // which contain the redacted parameters for both the request and the response
    pub fn split_redacted_values(comma_seperated_headers: String) -> (Vec<String>, Vec<String>) {
        let mut req_vector = Vec::new();
        let mut res_vector = Vec::new();

        let parts: Vec<&str> = comma_seperated_headers.split(',').collect();

        for part in parts {
            let trimmed_part = part.trim();
            if trimmed_part.starts_with("req") {
                req_vector.push(trimmed_part.to_string());
            } else if trimmed_part.starts_with("res") {
                res_vector.push(trimmed_part.to_string());
            }
        }

        (req_vector, res_vector)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_request_response() -> (Request<String>, Response<String>) {
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

        (request, response)
    }

    #[test]
    fn test_split_redacted_headers() {
        let sample_cs_redacted_headers =
            "req:header:x-api-key,req:body:age, res:header:secret-header, res:body:deep.3.name";
        let (req_vector, res_vector) =
            Redactor::split_redacted_values(sample_cs_redacted_headers.to_string());

        // Assertions for the 'req' vector
        assert_eq!(req_vector.len(), 2);
        assert!(req_vector.contains(&String::from("req:header:x-api-key")));
        assert!(req_vector.contains(&String::from("req:body:age")));

        // Assertions for the 'res' vector
        assert_eq!(res_vector.len(), 2);
        assert!(res_vector.contains(&String::from("res:header:secret-header")));
        assert!(res_vector.contains(&String::from("res:body:deep.3.name")));
    }

    #[test]
    fn test_get_redacted_parameter() {
        // Example Request
        let (request, response) = generate_request_response();
        let redactor = Redactor::new(request, response);

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

    #[test]
    fn test_get_redacted_values() {
        let (request, response) = generate_request_response();
        let redactor = Redactor::new(request, response);

        let sample_cs_redacted_headers =
            "req:header:x-api-key,req:body:age, res:header:secret-header, res:body:deep.3.name";
        let (req_vector, res_vector) =
            redactor.get_redacted_values(sample_cs_redacted_headers.to_string());

        assert_eq!(req_vector.len(), 2);
        assert!(req_vector.contains(&String::from("my-api-key-value")));
        assert!(req_vector.contains(&String::from("30")));

        // Assertions for the 'res' vector
        assert_eq!(res_vector.len(), 2);
        assert!(res_vector.contains(&String::from("my-secret-value")));
        assert!(res_vector.contains(&String::from("alex")));
    }
}
