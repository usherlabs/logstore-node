pub fn get_port(matches: &clap::ArgMatches<'_>, default_port: u16) -> u16 {
    // ? should we throw an error when an invalid port is provided
    match matches.value_of("p") {
        Some(x) => x.parse::<u16>().or::<u16>(Ok(default_port)).unwrap(),
        None => default_port,
    }
}
