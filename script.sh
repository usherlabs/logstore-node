#!/bin/bash

# install gcompat, because protoc needs a real glibc or compatible layer
apk add gcompat

# install a recent protoc (use a version that fits your needs)
export PB_REL="https://github.com/protocolbuffers/protobuf/releases"
curl -LO $PB_REL/download/v3.20.0/protoc-3.20.0-linux-x86_64.zip
unzip protoc-3.20.0-linux-x86_64.zip -d export PB_REL="https://github.com/protocolbuffers/protobuf/releases"
curl -LO $PB_REL/download/v3.20.0/protoc-3.20.0-linux-x86_64.zip
unzip protoc-3.20.0-linux-x86_64.zip -d /usr/local

ls /usr/local/bin/

export PATH="$PATH:/usr/local/bin/"

cargo build

# yes | curl https://sh.rustup.rs -sSf | sh -s -- -y
# . "$HOME/.cargo/env"
# rustup default stable
# pnpm build