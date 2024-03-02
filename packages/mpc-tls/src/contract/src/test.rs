use crate::{Contract, ContractClient};
use soroban_sdk::Env;

#[test]
fn test_contract_version() {
    let env = Env::default();

    let contract_id = env.register_contract(None, Contract);
    let client = ContractClient::new(&env, &contract_id);

    let current_version = 1;
    let contract_version = client.version();

    assert_eq!(contract_version, current_version);
}
