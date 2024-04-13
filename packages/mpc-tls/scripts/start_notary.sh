#!/bin/sh
# note:  if the port is not specified, it defaults to 7047

cd ../notary
cargo run -- --port 7047 
cd ..
