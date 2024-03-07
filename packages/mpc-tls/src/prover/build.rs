use std::io::Result;
use protobuf_zmq_rust_generator::ZmqServerGenerator;

// ! assuming protoc is installed and added to path
const PROTOC_PATH: &str = "/usr/local/bin/protoc";

fn main() -> Result<()> {
    std::env::set_var("PROTOC", PROTOC_PATH);
    prost_build::Config::new()
        .out_dir("src/message/")
        .service_generator(Box::new(ZmqServerGenerator {}))
        .compile_protos(&["prover.proto"], &["proto/"])?;

    Ok(())
}