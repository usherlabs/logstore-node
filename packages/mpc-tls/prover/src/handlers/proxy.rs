use crate::{
    proof::notarize::notarize_request,
    proxy::{Header, ProxyRequest, BLACKLISTED_HEADERS},
};
use actix_web::{route, web, HttpRequest, HttpResponseBuilder, Responder};
use hyper::body;
use tracing::debug;
use url::Url;

#[route(
    "/proxy",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "PATCH"
)]
pub async fn handle_notarization_request(payload: web::Payload, req: HttpRequest) -> impl Responder {
    let t_proxy_url = req
        .headers()
        .get("T-PROXY-URL")
        .expect("incomplete headers provided")
        .to_str()
        .unwrap();

    let _t_store = req
        .headers()
        .get("T-STORE")
        .map_or("", |value| value.to_str().unwrap_or_default());

    let _t_redacted_parameters = req
        .headers()
        .get("T-REDACTED")
        .map_or("", |value| value.to_str().unwrap_or_default());

    let _t_should_publish = req
        .headers()
        .get("T-PUBLISH")
        .map_or("", |value| value.to_str().unwrap_or_default());

    debug!("received notarization request for {t_proxy_url}");

    let url = Url::parse(t_proxy_url).unwrap();
    let host_url = url.host_str().unwrap();
    let method = req.method().to_string();

    let forwarded_headers: Vec<Header> = req
        .headers()
        .into_iter()
        .filter(|(header_key, _)| !BLACKLISTED_HEADERS.contains(&&header_key.to_string()[..]))
        .map(|(header_key, header_value)| Header {
            key: header_key.to_string(),
            value: header_value.to_str().unwrap().to_string(),
        })
        .collect();

    let body_bytes = web::Bytes::from(payload.to_bytes().await.unwrap_or_default());
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    let req_proxy = ProxyRequest {
        url: t_proxy_url.to_string(),
        method: method,
        host: host_url.to_string(),
        headers: forwarded_headers,
        body: Some(body_str).filter(|s| !s.is_empty()),
    };

    let http_response = notarize_request(req_proxy).await;
    let mut response = HttpResponseBuilder::new(http_response.status());
    for val in http_response.headers().iter() {
        response.insert_header(val);
    }

    let bytes = body::to_bytes(http_response.into_body()).await.unwrap();
    response.body(bytes)
}
