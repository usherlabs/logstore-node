use crate::handlers::proxy::handle_notarization_request;
use crate::proxy::get_port;
use actix_web::{App, HttpServer};
use clap::{App as ClapApp, Arg};

pub mod prover;
pub mod handlers;
pub mod proxy;


#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // initialize the server
    tracing_subscriber::fmt::init();
    let matches: clap::ArgMatches<'_> = ClapApp::new("Prover")
        .version("1.0")
        .about("The Prover Server for notarization")
        .arg(
            Arg::with_name("p")
                .long("port")
                .value_name("Port")
                .help("Sets the port you want this server to run on")
                .takes_value(true),
        )
        .get_matches();

    // get the port provided
    let port: u64 = get_port(&matches);
    println!("PROVER SERVER STARTED ON PORT:{port}");

    // start the server on the specified port
    let server_result = HttpServer::new(|| App::new().service(handle_notarization_request))
        .bind(format!("127.0.0.1:{port}"))?
        .run()
        .await;

    return server_result;
}
