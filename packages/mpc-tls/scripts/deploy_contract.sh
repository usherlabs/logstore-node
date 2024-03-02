
#!/bin/bash -e

cd ../src/contract

# build the contracts
soroban contract build

# Capture the current date and time in the desired format
current_datetime=$(date +"%Y-%m-%d %H:%M:%S")

# deploy contract and store hash
deploy_hash=$(soroban contract deploy --wasm ../../target/wasm32-unknown-unknown/release/contract.wasm --source alice --network testnet)

# Deploy the contract and append the result along with date and time to the file
echo "$current_datetime | deploy | contract_address $deploy_hash" >> .soroban/deploylog
echo "$deploy_hash" > .soroban/address

# init the contract ans specify an admin
soroban contract invoke \
    --source alice \
    --id $(cat .soroban/address) \
    --network testnet \
    -- \
    init \
    --admin $(soroban keys address alice)


echo "deploy successfull at: $deploy_hash"