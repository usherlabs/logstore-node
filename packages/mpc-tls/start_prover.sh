#!/bin/sh
# note:  if the port is not specified, it defaults to 8080

cd prover
cargo run -- --port 8080 -url localhost:7047 --socket "/tmp/test_sockets/test_pub"
cd ..