#[test_only]
module world::location_attestation_tests {
    use world::location_attestation;
    use world::merkle_verify;

    /// Test LocationAttestationPublicData getters
    /// Note: parse_public_inputs is now private, so we test the struct directly
    #[test]
    fun test_location_attestation_public_data_getters() {
        // Create LocationAttestationPublicData directly
        let mut merkle_root = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut merkle_root, 0x01);
            i = i + 1;
        };
        
        let mut coordinates_hash = vector::empty<u8>();
        i = 0;
        while (i < 32) {
            vector::push_back(&mut coordinates_hash, 0x02);
            i = i + 1;
        };
        
        let mut signature_and_key_hash = vector::empty<u8>();
        i = 0;
        while (i < 32) {
            vector::push_back(&mut signature_and_key_hash, 0x03);
            i = i + 1;
        };
        
        let public_data = location_attestation::create_location_attestation_public_data(
            merkle_root,
            coordinates_hash,
            signature_and_key_hash
        );
        
        // Verify getters
        let merkle_root_result = location_attestation::merkle_root(&public_data);
        assert!(vector::length(&merkle_root_result) == 32, 1);
        assert!(*vector::borrow(&merkle_root_result, 0) == 0x01, 2);
        
        let coordinates_hash_result = location_attestation::coordinates_hash(&public_data);
        assert!(vector::length(&coordinates_hash_result) == 32, 3);
        assert!(*vector::borrow(&coordinates_hash_result, 0) == 0x02, 4);
        
        let sig_hash_result = location_attestation::signature_and_key_hash(&public_data);
        assert!(vector::length(&sig_hash_result) == 32, 5);
        assert!(*vector::borrow(&sig_hash_result, 0) == 0x03, 6);
    }

    /// Note: parse_public_inputs is now private, so we can't test it directly
    /// Invalid length checking is tested via verify_location_attestation in integration tests

    /// Note: compute_signature_and_key_hash is now private
    /// This functionality is tested via verify_location_attestation in integration tests

    /// Test creating LocationAttestationData struct directly
    #[test]
    fun test_create_location_attestation_data() {
        let object_id = @0x1;
        let mut signer_public_key = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut signer_public_key, i as u8);
            i = i + 1;
        };
        
        let mut ed25519_signature = vector::empty<u8>();
        i = 0;
        while (i < 64) {
            vector::push_back(&mut ed25519_signature, i as u8);
            i = i + 1;
        };
        
        let merkle_proof = merkle_verify::create_multiproof(
            vector::empty<vector<u8>>(),
            vector::empty<vector<u8>>(),
            vector::empty<bool>()
        );
        
        let timestamp = 1234567890u64;
        let data = location_attestation::create_location_attestation_data(
            object_id,
            signer_public_key,
            ed25519_signature,
            merkle_proof,
            timestamp
        );
        
        // Verify getters work
        assert!(location_attestation::object_id(&data) == object_id, 1);
        assert!(location_attestation::timestamp(&data) == timestamp, 2);
        assert!(vector::length(&location_attestation::signer_public_key(&data)) == 32, 3);
        assert!(vector::length(&location_attestation::ed25519_signature(&data)) == 64, 4);
    }
}

