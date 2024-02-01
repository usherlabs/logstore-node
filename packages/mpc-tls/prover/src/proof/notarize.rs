use crate::proof::redact::Redactor;
use crate::proof::utils::{build_proof, build_request, setup_notary_connection};
use crate::proxy::ProxyRequest;
use futures::AsyncWriteExt;
use hyper::StatusCode;
use tlsn_prover::tls::{Prover, ProverConfig};
use tokio::io::AsyncWriteExt as _;
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};
use tracing::debug;

pub async fn notarize_request(req_proxy: ProxyRequest) -> hyper::Response<hyper::Body> {
    let (notary_tls_socket, session_id) = setup_notary_connection().await;
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
    let request = build_request(req_proxy);
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
    // pass in a list of redacted items in the request and response
    // let redactor = Redactor::new(&request, &response);


    // redacted items in the request should be the first parameter
    // go through the request and response
    // let request_redacted = [];
    // let response_Redacted = [];
    // redacted items in the response should be the second parameter
    let proof = build_proof(prover).await;

    // Dump the proof to a file.
    let mut file = tokio::fs::File::create("proof.json").await.unwrap();
    file.write_all(serde_json::to_string_pretty(&proof).unwrap().as_bytes())
        .await
        .unwrap();

    return response;
}
