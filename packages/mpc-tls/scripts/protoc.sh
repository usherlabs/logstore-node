#!/bin/bash

# install gcompat, because protoc needs a real glibc or compatible layer
# gcompat install failing? is it really needed? because protoc builds fine without it
# apt-get install gcompat

# install a recent protoc (use a version that fits your needs)
export PB_REL="https://github.com/protocolbuffers/protobuf/releases"
curl -LO $PB_REL/download/v3.20.0/protoc-3.20.0-linux-x86_64.zip
unzip protoc-3.20.0-linux-x86_64.zip -d export PB_REL="https://github.com/protocolbuffers/protobuf/releases"
curl -LO $PB_REL/download/v3.20.0/protoc-3.20.0-linux-x86_64.zip
unzip protoc-3.20.0-linux-x86_64.zip -d /usr/local

# add to path
export PATH="$PATH:/usr/local/bin/"

# build project for production
cargo build --release --target x86_64-unknown-linux-gnu