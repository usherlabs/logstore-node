use crate::handlers::proxy::handle_notarization_request;
use actix_web::{App, HttpServer};

pub mod handlers;
pub mod proof;
pub mod proxy;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    // TODO CHANGE THIS TO A CLI OR ENV VAIRABLE
    const PORT: u64 = 8080;
    println!("PROVER SERVER STARTED ON PORT:{PORT}");

    let server_result = HttpServer::new(|| App::new().service(handle_notarization_request))
        .bind(format!("127.0.0.1:{PORT}"))?
        .run()
        .await;

    return server_result;
}
