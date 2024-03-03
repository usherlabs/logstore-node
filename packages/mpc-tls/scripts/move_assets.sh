# copy the fixtures to a more central/global location
# refreence this global location in code instead
# rebuild the script
# pass the notary gateway as a parameter when initiating
#!/bin/bash
set -e


################################## move the builds to the logstore repo and binary config to the logstore repo
binary_source="../target/release"
binary_destination="../../core/bin"

if [ ! -d "$binary_source" ]; then
    echo "Binaries have not been built"
    exit 1
fi
cp "$binary_source/notary" "$binary_destination"
cp "$binary_source/prover" "$binary_destination"


cp -r ../src/notary/fixture "$binary_destination"
cp -r ../src/notary/config "$binary_destination"

echo "Notary and prover copied to $binary_destination"
################################## move the builds to the logstore repo and binary config to the logstore repo
