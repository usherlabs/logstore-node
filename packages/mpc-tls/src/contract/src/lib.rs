#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};
pub mod verifier;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
}

#[contracttype]
#[derive(Clone)]
pub struct Payload {
    pub age: u32,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn init(e: Env, admin: Address) {
        e.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn version() -> u32 {
        1
    }

    // add in a new function to take in an array of messages, decrypt them and emit an event containing some parameters
    // indicating the processes and the success or failure of the process verification
    pub fn verify_process(e: Env, payload: Payload) -> u32 {
        payload.age
    }

    pub fn upgrade(e: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        e.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}

#[cfg(test)]
mod test;
