# copy the fixtures to a more central/global location
# refreence this global location in code instead
# rebuild the script
# pass the notary gateway as a parameter when initiating
#!/bin/bash
set -e


################################## move the builds to the logstore repo
binary_source="../target/release"
binary_destination="../../core/bin"

if [ ! -d "$binary_source" ]; then
    echo "Binaries have not been built"
    exit 1
fi
cp "$binary_source/notary" "$binary_destination"
cp "$binary_source/prover" "$binary_destination"


echo "Notary and prover copied to $binary_destination"
################################## move the builds to the logstore repo


################################## move the fixtures to a global directory so they can be accessed at runtime
# Set source and destination paths
root_folder="$HOME/.logstore"
source_folder="../src/notary/fixture"
destination_folder="$root_folder/fixture"

# Create the destination folder if it doesn't exist
mkdir -p "$destination_folder"

# Copy the contents of the source folder to the destination folder
cp -r ../src/notary/fixture "$HOME/.logstore"


echo "Fixtures copied to path:'$destination_folder' successfully!"
################################## move the fixtures to a global directory so they can be accessed at runtime