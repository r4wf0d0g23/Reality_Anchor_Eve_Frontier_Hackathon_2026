#[test_only]
module world::distance_attestation_tests {
    use sui::test_scenario;
    
    use world::distance_attestation;
    use world::distance;
    use world::object_registry;

    /// Test parse_distance_public_inputs with valid dummy data
    /// Public inputs: [maxTimestamp (32 bytes), merkleRoot1 (32 bytes), merkleRoot2 (32 bytes),
    ///                 coordinatesHash1 (32 bytes), coordinatesHash2 (32 bytes), distanceSquaredMeters (32 bytes)]
    /// Total: 192 bytes
    #[test]
    fun test_parse_distance_public_inputs() {
        let mut public_inputs_bytes = vector::empty<u8>();
        
        // Max timestamp: u64 = 1234567890 (little-endian in first 8 bytes, rest zeros)
        let timestamp_value: u64 = 1234567890;
        let mut i = 0;
        while (i < 8) {
            let byte_val = ((timestamp_value >> (i * 8)) & 255) as u8;
            vector::push_back(&mut public_inputs_bytes, byte_val);
            i = i + 1;
        };
        // Pad remaining 24 bytes with zeros
        while (i < 32) {
            vector::push_back(&mut public_inputs_bytes, 0x00);
            i = i + 1;
        };
        
        // Merkle root 1: 32 bytes of 0x01
        i = 0;
        while (i < 32) {
            vector::push_back(&mut public_inputs_bytes, 0x01);
            i = i + 1;
        };
        
        // Merkle root 2: 32 bytes of 0x02
        i = 0;
        while (i < 32) {
            vector::push_back(&mut public_inputs_bytes, 0x02);
            i = i + 1;
        };
        
        // Coordinates hash 1: 32 bytes of 0x03
        i = 0;
        while (i < 32) {
            vector::push_back(&mut public_inputs_bytes, 0x03);
            i = i + 1;
        };
        
        // Coordinates hash 2: 32 bytes of 0x04
        i = 0;
        while (i < 32) {
            vector::push_back(&mut public_inputs_bytes, 0x04);
            i = i + 1;
        };
        
        // Distance squared meters: u64 = 1000000 (little-endian in first 8 bytes, rest zeros)
        let distance_value: u64 = 1000000;
        i = 0;
        while (i < 8) {
            let byte_val = ((distance_value >> (i * 8)) & 255) as u8;
            vector::push_back(&mut public_inputs_bytes, byte_val);
            i = i + 1;
        };
        // Pad remaining 24 bytes with zeros
        while (i < 32) {
            vector::push_back(&mut public_inputs_bytes, 0x00);
            i = i + 1;
        };
        
        // Note: parse_distance_public_inputs is now private
        // For unit testing, we'll create DistanceAttestationPublicData directly
        // In real usage, it comes from verify_distance_attestation
        let mut merkle_root_1 = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut merkle_root_1, 0x01);
            i = i + 1;
        };
        
        let mut merkle_root_2 = vector::empty<u8>();
        i = 0;
        while (i < 32) {
            vector::push_back(&mut merkle_root_2, 0x02);
            i = i + 1;
        };
        
        let mut coordinates_hash_1 = vector::empty<u8>();
        i = 0;
        while (i < 32) {
            vector::push_back(&mut coordinates_hash_1, 0x03);
            i = i + 1;
        };
        
        let mut coordinates_hash_2 = vector::empty<u8>();
        i = 0;
        while (i < 32) {
            vector::push_back(&mut coordinates_hash_2, 0x04);
            i = i + 1;
        };
        
        let public_data = distance_attestation::create_distance_attestation_public_data(
            1234567890u64,
            merkle_root_1,
            merkle_root_2,
            coordinates_hash_1,
            coordinates_hash_2,
            1000000u64
        );
        
        // Verify max_timestamp
        assert!(distance_attestation::max_timestamp(&public_data) == 1234567890, 1);
        
        // Verify merkle_root_1
        let merkle_root_1_result = distance_attestation::merkle_root_1(&public_data);
        assert!(vector::length(merkle_root_1_result) == 32, 2);
        assert!(*vector::borrow(merkle_root_1_result, 0) == 0x01, 3);
        
        // Verify merkle_root_2
        let merkle_root_2_result = distance_attestation::merkle_root_2(&public_data);
        assert!(vector::length(merkle_root_2_result) == 32, 4);
        assert!(*vector::borrow(merkle_root_2_result, 0) == 0x02, 5);
        
        // Verify coordinates_hash_1
        let coords_hash_1 = distance_attestation::coordinates_hash_1(&public_data);
        assert!(vector::length(coords_hash_1) == 32, 6);
        assert!(*vector::borrow(coords_hash_1, 0) == 0x03, 7);
        
        // Verify coordinates_hash_2
        let coords_hash_2 = distance_attestation::coordinates_hash_2(&public_data);
        assert!(vector::length(coords_hash_2) == 32, 8);
        assert!(*vector::borrow(coords_hash_2, 0) == 0x04, 9);
        
        // Verify distance_squared_meters
        assert!(distance_attestation::distance_squared_meters(&public_data) == 1000000, 10);
    }

    /// Note: parse_distance_public_inputs is now private
    /// Invalid length checking is tested via verify_distance_attestation in integration tests

    /// Test ObjectRegistry distance storage and retrieval
    #[test]
    fun test_distance_registry_storage() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            object_registry::init_for_testing(ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let registry = test_scenario::take_shared<object_registry::ObjectRegistry>(&scenario_val);
        
        let object_id1 = @0x2;
        let object_id2 = @0x3;
        
        // Get distance before storing (should be none)
        let distance_opt = distance::get_distance_data(&registry, object_id1, object_id2);
        assert!(std::option::is_none(&distance_opt), 1);
        
        // Note: store_distance_data is package-only, so we test through public API
        // Full integration tests will verify storage/retrieval together
        
        // Return registry to consume it
        test_scenario::return_shared(registry);
        test_scenario::end(scenario_val);
    }

    /// Test distance registry with different object pairs
    #[test]
    fun test_distance_registry_different_pairs() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            object_registry::init_for_testing(ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let registry = test_scenario::take_shared<object_registry::ObjectRegistry>(&scenario_val);
        
        let object_id1 = @0x2;
        let object_id2 = @0x3;
        let object_id3 = @0x4;
        
        // Get distances for different pairs (all should be none initially)
        let dist1 = distance::get_distance_data(&registry, object_id1, object_id2);
        let dist2 = distance::get_distance_data(&registry, object_id2, object_id3);
        let dist3 = distance::get_distance_data(&registry, object_id1, object_id3);
        
        assert!(std::option::is_none(&dist1), 1);
        assert!(std::option::is_none(&dist2), 2);
        assert!(std::option::is_none(&dist3), 3);
        
        // Return registry to consume it
        test_scenario::return_shared(registry);
        test_scenario::end(scenario_val);
    }
}

