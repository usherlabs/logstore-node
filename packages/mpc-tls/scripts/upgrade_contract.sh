#TODO MAKE THE USERNAME AND deploy environment to be envirnmental variables
#!/bin/bash -e

cd ../src/contract

# build the contracts
soroban contract build

# Capture the current date and time in the desired format
current_datetime=$(date +"%Y-%m-%d %H:%M:%S")

# Deploy the contract and append the result along with date and time to the file
# Capture the output of the CLI call in a variable
new_wasm_hash=$(soroban contract install --wasm ../../target/wasm32-unknown-unknown/release/contract.wasm --source alice --network testnet)

# Print or use the variable as needed
echo "WASM Hash: $new_wasm_hash"

# You can also use the variable in subsequent commands
# Use the variable in the soroban command
soroban contract invoke \
    --source alice \
    --id $(cat .soroban/address) \
    --network testnet \
    -- \
    upgrade \
    --new_wasm_hash "$new_wasm_hash"

echo "$current_datetime | upgrade | wash_hash: $new_wasm_hash" >> .soroban/deploylog

soroban contract invoke \
    --source alice \
    --id $(cat .soroban/address) \
    --network testnet \
    -- \
    upgrade \
    --new_wasm_hash "$new_wasm_hash"


echo "contract upgrade successfull"


# demo command use to confirm that the contract upgrade has been successfull
# to use, simply deploy the contract, change the version number - Then upgrade the contract by calling this script
# calling the version function as below, even while using the old contract address should provide the most recent version

soroban invoke \
    --source alice \
    --id $(cat .soroban/address) \
    --network testnet \
    --fn verify_process \
    --payload '{"object":{"map":[{"key":{"symbol":"age"},"val":{"u32":10}}}]}}'