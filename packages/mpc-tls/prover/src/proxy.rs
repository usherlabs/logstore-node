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
    // ? should we throw an error when an invalid port is provided
    match matches.value_of("p") {
        Some(x) => x.parse::<u64>().or::<u64>(Ok(DEFAULT_PORT)).unwrap(),
        None => DEFAULT_PORT,
    }
}
