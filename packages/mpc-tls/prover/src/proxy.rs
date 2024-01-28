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

pub const BLACKLISTED_HEADERS: &[&str] = &[
    "host",
    // "user-agent",
    "postman-token",
    // "accept-encoding",
    // "cache-control",
    "content-length",
    // "accept",
    // "connection",
    "t-proxy-url",
    "t-redacted",
    "t-store",
    "t-publish",
];
