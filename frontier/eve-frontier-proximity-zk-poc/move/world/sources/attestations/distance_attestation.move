module world::distance_attestation {
    use sui::groth16;
    use world::distance;
    use world::location;
    use world::object_registry::{Self, ObjectRegistry};

    /// Error codes
    const E_INVALID_PROOF: u64 = 1;
    const E_INVALID_PUBLIC_INPUTS: u64 = 2;
    const E_LOCATION_DATA_MISMATCH: u64 = 3;
    const E_MISSING_LOCATION_DATA: u64 = 4;
    const E_TIMESTAMP_MISMATCH: u64 = 5;
    const E_MISSING_LOCATION_TYPE: u64 = 6;
    
    /// Parsed public inputs/outputs from distance attestation proof
    public struct DistanceAttestationPublicData has copy, drop, store {
        max_timestamp: u64,
        merkle_root_1: vector<u8>,
        merkle_root_2: vector<u8>,
        coordinates_hash_1: vector<u8>,
        coordinates_hash_2: vector<u8>,
        distance_squared_meters: u64,
    }


    /// Parse public inputs/outputs from bytes for distance attestation
    public fun parse_distance_public_inputs(public_inputs_bytes: vector<u8>): DistanceAttestationPublicData {
        let len = vector::length(&public_inputs_bytes);
        assert!(len == 192, E_INVALID_PUBLIC_INPUTS);
        
        let mut i = 0;
        
        // Extract max_timestamp from first 32 bytes (big-endian field element)
        // The timestamp is a u64, which is stored in the least significant 8 bytes (bytes 24-31)
        // We need to read bytes 24-31 as big-endian (most significant byte first)
        let mut max_timestamp_bytes = vector::empty<u8>();
        while (i < 32) {
            vector::push_back(&mut max_timestamp_bytes, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        // Read last 8 bytes (bytes 24-31) as big-endian u64
        // byte24 is most significant, byte31 is least significant
        let mut max_timestamp: u64 = 0;
        let mut j = 24; // Start from byte 24 (most significant byte of u64)
        while (j < 32) {
            let byte_val = *vector::borrow(&max_timestamp_bytes, j) as u64;
            let mut multiplier: u64 = 1;
            let mut k = 0;
            let power = 31 - j; // Power of 256: 7 for byte24, 6 for byte25, ..., 0 for byte31
            while (k < power) {
                multiplier = multiplier * 256;
                k = k + 1;
            };
            max_timestamp = max_timestamp + (byte_val * multiplier);
            j = j + 1;
        };
        
        let mut merkle_root_1 = vector::empty<u8>();
        while (i < 64) {
            vector::push_back(&mut merkle_root_1, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        let mut merkle_root_2 = vector::empty<u8>();
        while (i < 96) {
            vector::push_back(&mut merkle_root_2, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        let mut coordinates_hash_1 = vector::empty<u8>();
        while (i < 128) {
            vector::push_back(&mut coordinates_hash_1, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        let mut coordinates_hash_2 = vector::empty<u8>();
        while (i < 160) {
            vector::push_back(&mut coordinates_hash_2, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        let mut distance_bytes = vector::empty<u8>();
        while (i < 192) {
            vector::push_back(&mut distance_bytes, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        // Read last 8 bytes (bytes 24-31) as big-endian u64
        // byte24 is most significant, byte31 is least significant
        let mut distance_squared_meters: u64 = 0;
        j = 24; // Start from byte 24 (most significant byte of u64)
        while (j < 32) {
            let byte_val = *vector::borrow(&distance_bytes, j) as u64;
            let mut multiplier: u64 = 1;
            let mut k = 0;
            let power = 31 - j; // Power of 256: 7 for byte24, 6 for byte25, ..., 0 for byte31
            while (k < power) {
                multiplier = multiplier * 256;
                k = k + 1;
            };
            distance_squared_meters = distance_squared_meters + (byte_val * multiplier);
            j = j + 1;
        };
        
        DistanceAttestationPublicData {
            max_timestamp,
            merkle_root_1,
            merkle_root_2,
            coordinates_hash_1,
            coordinates_hash_2,
            distance_squared_meters,
        }
    }

    /// Convert public inputs from little-endian (Groth16 format) to big-endian (parsing format)
    /// Each field element is 32 bytes - reverse each one
    fun convert_public_inputs_to_big_endian(little_endian: vector<u8>): vector<u8> {
        let len = vector::length(&little_endian);
        assert!(len % 32 == 0, E_INVALID_PUBLIC_INPUTS); // must be multiple of 32 bytes
        let mut big_endian = vector::empty<u8>();
        let mut i = 0;
        while (i < len) {
            // Reverse the 32-byte field element (read from end to start)
            let mut j = 31;
            loop {
                vector::push_back(&mut big_endian, *vector::borrow(&little_endian, i + j));
                if (j == 0) break;
                j = j - 1;
            };
            i = i + 32;
        };
        big_endian
    }

    /// Verify distance attestation (Groth16 proof, location data matching, etc.)
    /// This function performs all verification checks including Groth16 verification
    /// 
    /// Parameters:
    /// - object_id1: First object ID for distance verification
    /// - object_id2: Second object ID for distance verification
    /// - vkey_bytes: Verification key bytes (for Groth16 verification)
    /// - proof_points_bytes: Proof points bytes (for Groth16 verification)
    /// - public_inputs_bytes: Public inputs bytes in little-endian format (for Groth16 verification)
    /// - registry: Object registry for location data storage and retrieval
    /// 
    /// Verifies that the public inputs match stored location data for both objects
    /// and stores distance data if both objects are fixed location
    public fun verify_distance_attestation(
        object_id1: address,
        object_id2: address,
        vkey_bytes: vector<u8>,
        proof_points_bytes: vector<u8>,
        public_inputs_bytes: vector<u8>,
        registry: &mut ObjectRegistry
    ) {
        // 1. Verify Groth16 proof FIRST (before any other operations, matching sui-zk-airdrop pattern)
        // NOTE: public_inputs_bytes is in little-endian format (for Groth16 verification)
        let pvk = groth16::prepare_verifying_key(&groth16::bn254(), &vkey_bytes);
        let proof_points = groth16::proof_points_from_bytes(proof_points_bytes);
        let public_inputs = groth16::public_proof_inputs_from_bytes(public_inputs_bytes);
        assert!(
            groth16::verify_groth16_proof(&groth16::bn254(), &pvk, &public_inputs, &proof_points),
            E_INVALID_PROOF
        );
        
        // 1.5. Convert public inputs from little-endian (Groth16 format) to big-endian (parsing format)
        // Each field element is 32 bytes - reverse each one
        let public_inputs_bytes_big_endian = convert_public_inputs_to_big_endian(public_inputs_bytes);
        
        // 2. Parse public inputs (using big-endian format for parsing)
        let public_data = parse_distance_public_inputs(public_inputs_bytes_big_endian);
        
        // 3. Get location types from registry
        let location_type_1_opt = object_registry::get_location_type(registry, object_id1);
        let location_type_2_opt = object_registry::get_location_type(registry, object_id2);
        assert!(std::option::is_some(&location_type_1_opt), E_MISSING_LOCATION_TYPE);
        assert!(std::option::is_some(&location_type_2_opt), E_MISSING_LOCATION_TYPE);
        let location_type_1 = *std::option::borrow(&location_type_1_opt);
        let location_type_2 = *std::option::borrow(&location_type_2_opt);
        
        // 4. Get location data from registry
        let location_data_1_opt = object_registry::get_location_data(registry, object_id1);
        let location_data_2_opt = object_registry::get_location_data(registry, object_id2);
        assert!(std::option::is_some(&location_data_1_opt), E_MISSING_LOCATION_DATA);
        assert!(std::option::is_some(&location_data_2_opt), E_MISSING_LOCATION_DATA);
        let location_data_1 = *std::option::borrow(&location_data_1_opt);
        let location_data_2 = *std::option::borrow(&location_data_2_opt);
        
        // 5. Extract stored values
        let stored_merkle_root_1 = location::merkle_root(&location_data_1);
        let stored_merkle_root_2 = location::merkle_root(&location_data_2);
        let stored_coords_hash_1 = location::coordinates_hash(&location_data_1);
        let stored_coords_hash_2 = location::coordinates_hash(&location_data_2);
        let ts1 = location::timestamp(&location_data_1);
        let ts2 = location::timestamp(&location_data_2);
        
        // 6. Verify timestamps match the public output
        let expected_max_ts = if (ts1 > ts2) { ts1 } else { ts2 };
        if (public_data.max_timestamp != expected_max_ts) {
            abort E_TIMESTAMP_MISMATCH
        };
        
        // 7. Verify merkle roots match
        if (stored_merkle_root_1 != public_data.merkle_root_1) {
            abort E_LOCATION_DATA_MISMATCH
        };
        if (stored_merkle_root_2 != public_data.merkle_root_2) {
            abort E_LOCATION_DATA_MISMATCH
        };
        
        // 8. Verify coordinates hashes match
        if (stored_coords_hash_1 != public_data.coordinates_hash_1) {
            abort E_LOCATION_DATA_MISMATCH
        };
        if (stored_coords_hash_2 != public_data.coordinates_hash_2) {
            abort E_LOCATION_DATA_MISMATCH
        };
        
        // 9. If both objects are fixed location, store distance data
        let is_fixed_1 = location::is_fixed(&location_type_1);
        let is_fixed_2 = location::is_fixed(&location_type_2);
        if (is_fixed_1 && is_fixed_2) {
            let distance_data = distance::create_distance_data(
                public_data.max_timestamp,
                public_data.distance_squared_meters
            );
            distance::store_distance_data(
                registry,
                object_id1,
                object_id2,
                distance_data
            );
        };
    }

    /// Get max timestamp from public data
    #[test_only]
    public fun max_timestamp(data: &DistanceAttestationPublicData): u64 {
        data.max_timestamp
    }

    /// Get merkle root 1 from public data
    #[test_only]
    public fun merkle_root_1(data: &DistanceAttestationPublicData): &vector<u8> {
        &data.merkle_root_1
    }

    /// Get merkle root 2 from public data
    #[test_only]
    public fun merkle_root_2(data: &DistanceAttestationPublicData): &vector<u8> {
        &data.merkle_root_2
    }

    /// Get coordinates hash 1 from public data
    #[test_only]
    public fun coordinates_hash_1(data: &DistanceAttestationPublicData): &vector<u8> {
        &data.coordinates_hash_1
    }

    /// Get coordinates hash 2 from public data
    #[test_only]
    public fun coordinates_hash_2(data: &DistanceAttestationPublicData): &vector<u8> {
        &data.coordinates_hash_2
    }

    /// Get distance squared meters from public data
    #[test_only]
    public fun distance_squared_meters(data: &DistanceAttestationPublicData): u64 {
        data.distance_squared_meters
    }

    /// Test-only constructor for DistanceAttestationPublicData
    #[test_only]
    public fun create_distance_attestation_public_data(
        max_timestamp: u64,
        merkle_root_1: vector<u8>,
        merkle_root_2: vector<u8>,
        coordinates_hash_1: vector<u8>,
        coordinates_hash_2: vector<u8>,
        distance_squared_meters: u64
    ): DistanceAttestationPublicData {
        DistanceAttestationPublicData {
            max_timestamp,
            merkle_root_1,
            merkle_root_2,
            coordinates_hash_1,
            coordinates_hash_2,
            distance_squared_meters,
        }
    }
}
