use crate::{
    core::{
        notarize::{notarize_request, NotarizeRequestParams},
        utils::compute_sha256_hash,
    },
    message::socket::{SocketServer, TlsProof},
    proxy::{EmptyProverHandlersImpl, Header, ProxyRequest, ServerConfig, BLACKLISTED_HEADERS},
};
use actix_web::{
    route,
    web::{self},
    HttpRequest, HttpResponseBuilder, Responder,
};
use hyper::body;
use std::sync::Arc;
use tracing::debug;
use url::Url;

#[route(
    "/proxy",
    method = "GET",
    method = "POST",
    method = "PUT",
    method = "PATCH",
    method = "DELETE",
)]
// recieve the parameter for the publisher as well
pub async fn handle_notarization_request(
    payload: web::Payload,
    req: HttpRequest,
    data: web::Data<ServerConfig>,
) -> impl Responder {
    let config = data.get_ref();
    let reply_handlers = Arc::new(EmptyProverHandlersImpl {});
    let mut prover_socket = SocketServer::new(
        config.publish_socket.clone(),
        config.request_socket.clone(),
        reply_handlers,
    );

    let t_proxy_url = req
        .headers()
        .get("T-PROXY-URL")
        .expect("incomplete headers provided")
        .to_str()
        .unwrap();
    let t_store = req
        .headers()
        .get("T-STORE")
        .expect("incomplete headers provided")
        .to_str()
        .unwrap();
    let t_redacted_parameters = req
        .headers()
        .get("T-REDACTED")
        .map_or("", |value| value.to_str().unwrap_or_default()); //optional;
    // let t_should_publish = req
    //     .headers()
    //     .get("T-PUBLISH")
    //     .expect("incomplete headers provided")
    //     .to_str()
    //     .unwrap();

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

    let notarization_params = NotarizeRequestParams {
        req_proxy,
        redacted_parameters: t_redacted_parameters.to_string(),
        store: t_store.to_string(),
        // publish: t_should_publish.to_string(),
    };
    let (http_response, string_proof) = notarize_request(notarization_params, config).await;
    let mut response = HttpResponseBuilder::new(http_response.status());

    for val in http_response.headers().iter() {
        response.insert_header(val);
    }
    let bytes = body::to_bytes(http_response.into_body()).await.unwrap();
    let proof_id = compute_sha256_hash(string_proof.clone()).unwrap();

    prover_socket
        .publish_to_proofs(TlsProof {
            id: proof_id,
            data: string_proof.clone(),
            stream: t_store.to_string(),
            // publish: t_should_publish.to_lowercase() == "true"
        })
        .expect("Failed to publish");

    response.body(bytes)
}
