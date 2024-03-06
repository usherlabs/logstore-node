use crate::handlers::proxy::handle_notarization_request;
use crate::proxy::{get_port, ServerConfig};
use actix_web::{web, App, HttpServer};
use clap::{App as ClapApp, Arg};

pub mod core;
pub mod handlers;
pub mod message;
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
        .arg(
            Arg::with_name("u")
                .long("url")
                .value_name("notaryURL")
                .help("Sets full url of the notary server")
                .takes_value(true),
        )
        .arg(
            Arg::with_name("s")
                .long("socket")
                .value_name("socketPath")
                .help("Sets full path of the path to use for the socket")
                .takes_value(true),
        )
        .arg(
            Arg::with_name("m")
                .long("mode")
                .value_name("mode")
                .help("Set if you want the prover to run in dev mode"),
        )
        .get_matches();

    // get the port provided
    let port: u64 = get_port(&matches);
    let config: ServerConfig = (&matches).into();

    println!("{:?}", config);
    println!(
        "PROVER SERVER STARTED ON PORT:{port} WITH CONFIG:{:?}",
        config
    );

    // start the server on the specified port
    let server_result = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(config.clone()))
            .service(handle_notarization_request)
    })
    .bind(format!("127.0.0.1:{port}"))?
    .run()
    .await;

    return server_result;
}
