#!/usr/bin/env bash

# Check for tinyproxy installation
if command -v tinyproxy >/dev/null 2>&1; then
    echo "tinyproxy is already installed."
    exit 0
else
		THIS_DIRECTORY="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
    echo "tinyproxy is not installed. Attempting to install..."

		# download from https://github.com/tinyproxy/tinyproxy/releases/download/1.11.1/tinyproxy-1.11.1.tar.gz
    wget https://github.com/tinyproxy/tinyproxy/releases/download/1.11.1/tinyproxy-1.11.1.tar.gz -P /tmp

    # extract to /tmp/tinyproxy/
    mkdir -p /tmp/tinyproxy
    tar -xzf /tmp/tinyproxy-1.11.1.tar.gz -C /tmp/tinyproxy --strip-components=1

    # make and install
    cd /tmp/tinyproxy
    ./configure --enable-reverse
    make
    make install

    # cleanup
    rm -rf /tmp/tinyproxy
    rm /tmp/tinyproxy-1.11.1.tar.gz
fi

# Verify installation
if command -v tinyproxy >/dev/null 2>&1; then
    echo "Installation of tinyproxy was successful."
else
    echo "Failed to install tinyproxy."
    exit 1
fi
