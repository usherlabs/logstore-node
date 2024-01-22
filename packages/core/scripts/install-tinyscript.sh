#!/usr/bin/env bash


# Check for tinyproxy installation
if command -v tinyproxy >/dev/null 2>&1; then
    echo "tinyproxy is already installed."
else
    echo "tinyproxy is not installed. Attempting to install..."

    # verify if it's running with root privileges, else error and exit
    if [ "$EUID" -ne 0 ]; then
    		echo "Please run this script as root, or install tinyproxy manually"
    		exit 1
    fi

    # Determine which package manager is available
    if command -v apt-get >/dev/null 2>&1; then
        # Using apt-get (Debian/Ubuntu)
        apt-get update
        apt-get install tinyproxy -y
    elif command -v yum >/dev/null 2>&1; then
        # Using yum (CentOS/RedHat)
        yum install tinyproxy -y
    else
        echo "Neither apt-get nor yum is available. Unable to install tinyproxy."
        exit 1
    fi
fi

# Verify installation
if command -v tinyproxy >/dev/null 2>&1; then
    echo "Installation of tinyproxy was successful."
else
    echo "Failed to install tinyproxy."
fi
