use hyper::body::to_bytes;
use hyper::{Body, Request};
use hyper::{Response, StatusCode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Message {
    pub message: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Header {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct ProxyRequest {
    pub url: String,
    pub method: String,
    pub host: String,
    pub headers: Vec<Header>,
    pub body: Option<String>,
}

pub const DEFAULT_PORT: u64 = 8080;

pub const BLACKLISTED_HEADERS: &[&str] = &[
    "host",
    "user-agent",
    "postman-token",
    "accept-encoding",
    "cache-control",
    "content-length",
    "accept",
    "connection",
    "t-proxy-url",
    "t-redacted",
    "t-store",
    "t-publish",
];

pub fn get_port(matches: &clap::ArgMatches<'_>) -> u64 {
    // ? should we throw an error when an invalid port is provided or just return default port
    match matches.value_of("p") {
        Some(x) => x.parse::<u64>().or::<u64>(Ok(DEFAULT_PORT)).unwrap(),
        None => DEFAULT_PORT,
    }
}

pub async fn shadow_clone_response(res: Response<Body>) -> (Response<Body>, Response<Body>) {
    let (parts, body) = res.into_parts();
    let bytes = hyper::body::to_bytes(body).await.unwrap();

    let generate_response = || {
        let mut builder = Response::builder()
            .status(parts.status)
            .version(parts.version);

        // Copy headers
        for (name, value) in parts.headers.iter() {
            builder = builder.header(name, value.clone());
        }

        // Build the response with a new empty body
        builder.body(Body::from(bytes.clone())).unwrap()
    };

    (generate_response(), generate_response())
}

pub async fn convert_request_body_to_string(request: Request<Body>) -> Request<String> {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body).await.unwrap();
    let result = String::from_utf8(bytes.into_iter().collect()).unwrap();

    Request::from_parts(parts, result)
}

pub async fn convert_response_body_to_string(request: Response<Body>) -> Response<String> {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body).await.unwrap();
    let result = String::from_utf8(bytes.into_iter().collect()).unwrap();

    Response::from_parts(parts, result)
}
