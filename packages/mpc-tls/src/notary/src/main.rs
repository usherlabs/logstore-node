use std::env;

use crate::utils::get_port;
use clap::{App as ClapApp, Arg};
use eyre::{eyre, Result};
use notary_server::{
    init_tracing, parse_config_file, run_server, NotaryServerError, NotaryServerProperties,
};
use tracing::debug;

pub mod utils;

#[tokio::main]
async fn main() -> Result<(), NotaryServerError> {
    // setup the program to accept CLI parameters
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

    // Load command line arguments which contains the config file location
    let mut config: NotaryServerProperties =
        parse_config_file(modify_base_path("./config/config.yaml".to_string()).as_str())?;

    // manually override the port specified in the config file
    config.server.port = get_port(&matches, config.server.port);
    config.tls_signature.private_key_pem_path =
        modify_base_path(config.tls_signature.private_key_pem_path.clone());
    config.tls_signature.certificate_pem_path =
        modify_base_path(config.tls_signature.certificate_pem_path.clone());
    config.notary_signature.private_key_pem_path =
        modify_base_path(config.notary_signature.private_key_pem_path.clone());
    config.notary_signature.public_key_pem_path =
        modify_base_path(config.notary_signature.public_key_pem_path.clone());

    // modify the paths to reference the tls and notary files
    // we want to go over all the relative paths and make them absolute paths

    // Set up tracing for logging
    init_tracing(&config).map_err(|err| eyre!("Failed to set up tracing: {err}"))?;

    debug!(?config, "Server config loaded");

    // Run the server
    run_server(&config).await?;

    Ok(())
}

fn modify_base_path(path: String) -> String {
    format!("{}/.logstore/notary/{path}", env::var("HOME").unwrap())
}
