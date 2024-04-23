#!/bin/sh
# note:  if the port is not specified, it defaults to 8080

cd ../src/prover
cargo run -- --port 8099 --url localhost:7047 --socket "/tmp/test_sockets/test_pub" --mode dev
cd ..