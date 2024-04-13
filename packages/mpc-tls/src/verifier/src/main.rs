use std::env;

use crate::utils::verify_proof;

mod utils;
// take in cli args of the proof and the keys
// and return the request res pair by logging it to the console
// CLI tool to verify the content of a tls proof or throw an error
fn main() {
    // read in the cli args
    let args: Vec<String> = env::args().collect();

    // three because the first arg is a default and we expect two
    assert!(
        args.len() == 3,
        "Please provide the proof and the public key"
    );

    // run the verifier and extract the paramters
    let public_key = args.get(1).unwrap();
    let proof = args.get(2).unwrap();

    let response = verify_proof(proof, public_key).unwrap();
    println!("{response}");
}
