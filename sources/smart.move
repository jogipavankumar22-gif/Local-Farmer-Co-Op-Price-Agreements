module pavan::FarmerCoOp {
    use std::error;
    use std::signer;
    use std::option::{Self, Option};
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;

    /// On-chain resource: a single price agreement stored under the farmer's account
    struct PriceAgreement has key, store {
        minimum_price: u64,     // price per ton, in octas (1 APT = 100_000_000 octas)
        quantity_tons: u64,     // quantity in tons
        total_value: u64,       // minimum_price * quantity_tons (in octas)
        is_fulfilled: bool,     // has buyer paid?
        buyer_address: address, // the only account allowed to fulfill
    }

    /// Lightweight copyable view for off-chain reads (cannot return a resource in views)
    struct PriceAgreementView has copy, drop, store {
        minimum_price: u64,
        quantity_tons: u64,
        total_value: u64,
        is_fulfilled: bool,
        buyer_address: address,
    }

    /// Error codes
    const E_INSUFFICIENT_PAYMENT: u64 = 1;
    const E_AGREEMENT_ALREADY_FULFILLED: u64 = 2;
    const E_WRONG_BUYER: u64 = 3;
    const E_AGREEMENT_EXISTS: u64 = 4;
    const E_NOT_FOUND: u64 = 5;

    /// (Optional) Register AptosCoin for a fresh account so it can send/receive APT.
    /// Call this once per account (farmer or buyer) on Testnet if needed.
    public entry fun init_coin_store(account: &signer) {
        if (!coin::is_account_registered<AptosCoin>(signer::address_of(account))) {
            coin::register<AptosCoin>(account);
        }
    }

    /// Farmer creates a price agreement (stored under the farmer's account).
    /// Fails if an agreement already exists there.
    public entry fun create_price_agreement(
        farmer: &signer,
        minimum_price: u64,
        quantity_tons: u64,
        buyer_address: address
    ) {
        let farmer_addr = signer::address_of(farmer);
        // Prevent accidental overwrite
        assert!(!exists<PriceAgreement>(farmer_addr), error::invalid_argument(E_AGREEMENT_EXISTS));

        let total_value = minimum_price * quantity_tons;

        move_to(
            farmer,
            PriceAgreement {
                minimum_price,
                quantity_tons,
                total_value,
                is_fulfilled: false,
                buyer_address,
            }
        );
    }

    /// Buyer fulfills by paying >= total_value in APT (octas) to the farmer.
    /// Only the designated buyer address can fulfill.
    public entry fun fulfill_agreement(
        buyer: &signer,
        farmer_address: address,
        payment_amount: u64
    ) acquires PriceAgreement {
        assert!(exists<PriceAgreement>(farmer_address), error::not_found(E_NOT_FOUND));
        let agreement = borrow_global_mut<PriceAgreement>(farmer_address);

        // Not already fulfilled
        assert!(!agreement.is_fulfilled, error::already_exists(E_AGREEMENT_ALREADY_FULFILLED));
        // Correct buyer
        assert!(signer::address_of(buyer) == agreement.buyer_address, error::permission_denied(E_WRONG_BUYER));
        // Enough payment
        assert!(payment_amount >= agreement.total_value, error::invalid_argument(E_INSUFFICIENT_PAYMENT));

        // Transfer APT from buyer -> farmer (farmer must have registered AptosCoin)
        let payment = coin::withdraw<AptosCoin>(buyer, payment_amount);
        coin::deposit<AptosCoin>(farmer_address, payment);

        agreement.is_fulfilled = true;
    }

    /// Read-only helper for frontends.
    /// Returns `some(view)` if a farmer’s agreement exists, else `none`.
    /// NOTE: `#[view]` allows off-chain callers (via RPC) to read without transactions.
    #[view]
    public fun get_agreement(farmer_address: address): Option<PriceAgreementView> acquires PriceAgreement {
        if (!exists<PriceAgreement>(farmer_address)) {
            return option::none<PriceAgreementView>();
        };
        let a = borrow_global<PriceAgreement>(farmer_address);
        option::some(PriceAgreementView {
            minimum_price: a.minimum_price,
            quantity_tons: a.quantity_tons,
            total_value: a.total_value,
            is_fulfilled: a.is_fulfilled,
            buyer_address: a.buyer_address,
        })
    }
}
