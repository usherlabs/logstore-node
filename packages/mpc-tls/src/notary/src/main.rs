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
    let mut config: NotaryServerProperties = parse_config_file("./config/config.yaml")?;

    // manually override the port specified in the config file
    config.server.port = get_port(&matches, config.server.port);

    // Set up tracing for logging
    init_tracing(&config).map_err(|err| eyre!("Failed to set up tracing: {err}"))?;

    debug!(?config, "Server config loaded");

    // Run the server
    run_server(&config).await?;

    Ok(())
}
