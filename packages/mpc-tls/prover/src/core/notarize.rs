use crate::core::redact::Redactor;
use crate::core::utils::{build_proof, build_request, setup_notary_connection};
use crate::proxy::{ProxyRequest, ServerConfig};
use crate::proxy::{
    convert_request_body_to_string, convert_response_body_to_string, shadow_clone_response,
};
use futures::AsyncWriteExt;
use hyper::StatusCode;
use tlsn_prover::tls::{Prover, ProverConfig};
use tokio::io::AsyncWriteExt as _;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tracing::debug;

pub struct NotarizeRequestParams {
    pub req_proxy: ProxyRequest,
    pub redacted_parameters: String,
    pub store: String,
    // pub publish: String,
}

pub async fn notarize_request(
    params: NotarizeRequestParams,
    config: &ServerConfig
) -> (hyper::Response<hyper::Body>, String) {
    let NotarizeRequestParams {
        req_proxy,
        redacted_parameters,
        ..
    } = params;
    let (notary_tls_socket, session_id) = setup_notary_connection(config).await;
    debug!(
        "Connection to notary server completed with id:{session_id}; Forminig MPC-TLS connection"
    );
    // Basic default prover config using the session_id returned from /session endpoint just now
    let config = ProverConfig::builder()
        .id(session_id)
        .server_dns(req_proxy.host.clone())
        .build()
        .unwrap();

    // Create a new prover and set up the MPC backend.
    let prover = Prover::new(config)
        .setup(notary_tls_socket.compat())
        .await
        .unwrap();

    let client_socket = tokio::net::TcpStream::connect((req_proxy.host.clone(), 443))
        .await
        .unwrap();

    // Bind the Prover to server connection
    let (tls_connection, prover_fut) = prover.connect(client_socket.compat()).await.unwrap();

    // Spawn the Prover to be run concurrently
    let prover_task = tokio::spawn(prover_fut);

    // Attach the hyper HTTP client to the TLS connection
    let (mut request_sender, connection) = hyper::client::conn::handshake(tls_connection.compat())
        .await
        .unwrap();

    // Spawn the HTTP task to be run concurrently
    let connection_task = tokio::spawn(connection.without_shutdown());
    // Build the HTTP request to fetch the DMs
    let request = build_request(req_proxy.clone());
    let response = request_sender.send_request(request).await.unwrap();

    assert!(
        [StatusCode::OK, StatusCode::CREATED].contains(&response.status()),
        "{}",
        response.status()
    );

    // Close the connection to the server
    let mut client_socket = connection_task.await.unwrap().unwrap().io.into_inner();
    client_socket.close().await.unwrap();

    // The Prover task should be done now, so we can grab it.
    let prover = prover_task.await.unwrap().unwrap();
    let prover = prover.start_notarize();

    // since the Body cannot be cloned, we have to manually generate another pair of similar request and response pair
    // which we will then pass to the method to generate the redactions
    let redact_request = build_request(req_proxy);
    let (redact_response, return_response) = shadow_clone_response(response).await;

    // pass in a list of redacted items in the request and response
    let parsed_redact_request = convert_request_body_to_string(redact_request).await;
    let parsed_redact_response = convert_response_body_to_string(redact_response).await;
    let redactor = Redactor::new(parsed_redact_request, parsed_redact_response);

    // redacted items in the request should be the first parameter
    let (req_redact_items, res_redact_items) = redactor.get_redacted_values(redacted_parameters);

    let proof = build_proof(prover, req_redact_items, res_redact_items).await;
    let stringified_proof = serde_json::to_string_pretty(&proof).unwrap();
    // Dump the proof to a file.
    let mut file = tokio::fs::File::create("proof.json").await.unwrap();
    file.write_all(serde_json::to_string_pretty(&proof).unwrap().as_bytes())
        .await
        .unwrap();

    return (return_response, stringified_proof);
}
