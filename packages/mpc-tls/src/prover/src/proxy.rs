use hyper::body::to_bytes;
use hyper::Response;
use hyper::{Body, Request};
use serde::{Deserialize, Serialize};

use crate::core::utils::{NOTARY_HOST, NOTARY_PORT};
use crate::message::socket::SocketHandlers;

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

// Default paths for the sockets for PUB-SUB and REQUEST-REPLY communications
pub const DEFAULT_PUBLISH_SOCKET: &str = "/tmp/test_sockets/test_pub";
pub const DEFAULT_REQUEST_SOCKET: &str = "/tmp/test_sockets/test_req";
pub const DEFAULT_CERTIFICATE_DOMAIN: &str = "tlsnotaryserver.io";

#[derive(Debug, Deserialize, Clone)]
pub enum Modes {
    Dev,
    Prod,
}

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

pub struct EmptyProverHandlersImpl {}
impl SocketHandlers for EmptyProverHandlersImpl {}

#[derive(Debug, Deserialize, Clone)]
pub struct ServerConfig {
    pub mode: Modes,
    pub publish_socket: String,
    pub request_socket: String,
    pub notary_gateway: String,
    pub notary_host: String,
    pub notary_port: u16,
    pub cert_url: String,
}

impl ServerConfig {
    pub fn default() -> Self {
        Self {
            mode: Modes::Dev,
            publish_socket: DEFAULT_PUBLISH_SOCKET.to_string(),
            request_socket: DEFAULT_REQUEST_SOCKET.to_string(),
            notary_gateway: NOTARY_HOST.to_string(),
            notary_host: NOTARY_HOST.to_string(),
            notary_port: NOTARY_PORT,
            cert_url: DEFAULT_CERTIFICATE_DOMAIN.to_string(),
        }
    }
}

impl From<&clap::ArgMatches<'_>> for ServerConfig {
    fn from(value: &clap::ArgMatches<'_>) -> Self {
        let (notary_url, notary_port, notary_node_gateway_url) = get_notary_details(value);
        let publish_socket_path = get_pub_socket_path(value);
        let notary_mode = get_mode(value);

        if let Modes::Dev = notary_mode {
            Self::default()
        } else {
            Self {
                mode: Modes::Prod,
                publish_socket: publish_socket_path,
                request_socket: DEFAULT_REQUEST_SOCKET.to_string(),
                notary_gateway: notary_node_gateway_url,
                notary_host: notary_url.clone(),
                notary_port: notary_port,
                cert_url: notary_url.clone(),
            }
        }
    }
}

// if the host is localhost, then we return the default certificate value for development
pub fn get_certificate_domain(url: String) -> String {
    if vec!["127.0.0.1", "localhost"].contains(&url.as_str()) {
        DEFAULT_CERTIFICATE_DOMAIN.to_string()
    } else {
        url.to_string()
    }
}

pub fn get_port(matches: &clap::ArgMatches<'_>) -> u64 {
    // ? should we throw an error when an invalid port is provided or just return default port
    match matches.value_of("p") {
        Some(x) => x.parse::<u64>().or::<u64>(Ok(DEFAULT_PORT)).unwrap(),
        None => DEFAULT_PORT,
    }
}

pub fn get_mode(matches: &clap::ArgMatches<'_>) -> Modes {
    // ? should we throw an error when an invalid mode is provided or just return default port
    match matches.value_of("m") {
        Some("dev") => Modes::Dev,
        _ => Modes::Prod,
    }
}

pub fn get_pub_socket_path(matches: &clap::ArgMatches<'_>) -> String {
    // ? should we throw an error when an invalid socket is provided or just return default values
    match matches.value_of("s") {
        Some(x) => x.to_owned(),
        None => DEFAULT_PUBLISH_SOCKET.to_owned(),
    }
}

pub fn get_notary_details(matches: &clap::ArgMatches<'_>) -> (String, u16, String) {
    // ? should we throw an error when an invalid port is provided or just return default values
    match matches.value_of("u") {
        Some(notary_connection_url) => {
            let notary_parts: Vec<&str> = notary_connection_url.split(':').collect();
            let notary_host = notary_parts.get(0).unwrap_or(&NOTARY_HOST).to_string();
            println!(
                "{:?}",
                notary_parts.get(1).unwrap_or(&"").parse::<u16>().unwrap()
            );
            let notary_port = notary_parts
                .get(1)
                .unwrap_or(&"")
                .parse::<u16>()
                .unwrap_or(NOTARY_PORT);
            (
                notary_host.to_string(),
                notary_port,
                notary_connection_url.to_string(),
            )
        }
        None => (
            NOTARY_HOST.to_string(),
            NOTARY_PORT,
            NOTARY_HOST.to_string(),
        ),
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
