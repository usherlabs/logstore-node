#!/usr/bin/env bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
NODE_MODULES_DIR="$SCRIPT_DIR/../node_modules/"
BIN_DIR="$NODE_MODULES_DIR/.bin/"
NODE_MODULE_TINYPROXY="$NODE_MODULES_DIR/tinyproxy"



# Check for tinyproxy installation
if command -v tinyproxy >/dev/null 2>&1; then
    echo "tinyproxy is already installed."
    exit 0
elif [ -f "$NODE_MODULE_TINYPROXY" ]; then
		echo "tinyproxy is already installed."
		exit 0
else
    echo "tinyproxy is not installed. Attempting to install..."

		# download from https://github.com/tinyproxy/tinyproxy/releases/download/1.11.1/tinyproxy-1.11.1.tar.gz
    wget https://github.com/tinyproxy/tinyproxy/releases/download/1.11.1/tinyproxy-1.11.1.tar.gz -P /tmp

    mkdir -p /tmp/tinyproxy
    tar -xzf /tmp/tinyproxy-1.11.1.tar.gz -C /tmp/tinyproxy --strip-components=1

    # make and install
    cd /tmp/tinyproxy
    ./configure --enable-reverse --prefix=$NODE_MODULES_DIR --bindir=$BIN_DIR
    make
    make install

    # cleanup
    rm -rf /tmp/tinyproxy
    rm /tmp/tinyproxy-1.11.1.tar.gz
fi
