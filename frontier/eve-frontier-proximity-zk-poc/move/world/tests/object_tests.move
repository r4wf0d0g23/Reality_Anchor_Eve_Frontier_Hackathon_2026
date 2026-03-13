#[test_only]
module world::object_tests {
    use sui::test_scenario;
    use sui::hash;
    use sui::address;
    use world::fixed_object;
    use world::dynamic_object;
    use world::object_registry::{Self, ObjectRegistry};
    use world::authority;
    use world::location;
    use world::location_attestation;
    use world::test_proof_data;
    use world::leaf_hash;
    use world::merkle_verify;

    /// Test creating a fixed object with inline Groth16 verification
    /// 
    /// This test verifies that Groth16 proof verification works correctly with properly formatted
    /// proof data (little-endian for Groth16 verification, big-endian for Merkle parsing).
    #[test]
    fun test_create_fixed_object() {
        let mut scenario_val = test_scenario::begin(@0x1);
        
        // Setup: Create registry, approved signers, and admin cap
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            object_registry::init_for_testing(ctx);
            authority::init_for_testing(ctx);
            authority::create_admin_cap(@0x1, ctx);
        };
        
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let registry = test_scenario::take_shared<ObjectRegistry>(&scenario_val);
        let mut registry_mut = registry;
        let mut approved_signers = test_scenario::take_shared<authority::ApprovedSigners>(&scenario_val);
        let admin_cap = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        
        // Add Ed25519 signer to approved signers list
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let mut preimage = vector::empty<u8>();
            vector::push_back(&mut preimage, 0x00); // Ed25519 flag
            vector::append(&mut preimage, test_proof_data::get_ed25519_public_key());
            let pk_hash = hash::blake2b256(&preimage);
            let signer_addr = address::from_bytes(pk_hash);
            authority::add_approved_signer(&mut approved_signers, signer_addr, &admin_cap, ctx);
        };
        
        // Get proof data from test_proof_data module
        let (vkey_bytes, proof_points_bytes, public_inputs_bytes) = (
            test_proof_data::get_valid_vkey_bytes(),
            test_proof_data::get_valid_proof_points_bytes(),
            test_proof_data::get_valid_public_inputs_bytes()
        );
        let (merkle_leaves, merkle_proof_bytes, merkle_proof_flags) = test_proof_data::get_merkle_proof_components();
        let signer_public_key = test_proof_data::get_ed25519_public_key();
        let ed25519_signature = test_proof_data::get_ed25519_signature();
        let timestamp = test_proof_data::get_timestamp();
        
        // Create fixed object with inline Groth16 verification
        // Use fixed item_id = 0x111111 for deterministic object ID generation
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            fixed_object::create(
                &mut registry_mut,
                0x111111, // item_id (fixed for unit tests)
                signer_public_key,
                ed25519_signature,
                merkle_leaves,
                merkle_proof_bytes,
                merkle_proof_flags,
                timestamp,
                vkey_bytes,
                proof_points_bytes,
                public_inputs_bytes,
                &approved_signers,
                &admin_cap,
                ctx
            );
        };
        
        // Return shared objects
        test_scenario::return_shared(registry_mut);
        test_scenario::return_shared(approved_signers);
        authority::transfer_admin_cap(admin_cap, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test creating a dynamic object
    #[test]
    fun test_create_dynamic_object() {
        let mut scenario_val = test_scenario::begin(@0x1);
        
        // Setup: Create registry and admin cap
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            object_registry::init_for_testing(ctx);
            authority::init_for_testing(ctx);
            authority::create_admin_cap(@0x1, ctx);
        };
        
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let registry = test_scenario::take_shared<ObjectRegistry>(&scenario_val);
        let mut registry_mut = registry;
        let admin_cap = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        
        // Create dynamic object
        // Use fixed item_id = 0x222222 for deterministic object ID generation
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            dynamic_object::create(
                &mut registry_mut,
                0x222222, // item_id (fixed for unit tests)
                &admin_cap,
                ctx
            );
        };
        
        // Return shared objects
        test_scenario::return_shared(registry_mut);
        authority::transfer_admin_cap(admin_cap, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test getting location data from registry for fixed object
    /// 
    /// This test verifies that Groth16 proof verification works correctly with properly formatted
    /// proof data (little-endian for Groth16 verification, big-endian for Merkle parsing).
    #[test]
    fun test_fixed_object_location_data() {
        let mut scenario_val = test_scenario::begin(@0x1);
        
        // Setup
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            object_registry::init_for_testing(ctx);
            authority::init_for_testing(ctx);
            authority::create_admin_cap(@0x1, ctx);
        };
        
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let mut registry = test_scenario::take_shared<ObjectRegistry>(&scenario_val);
        let mut approved_signers = test_scenario::take_shared<authority::ApprovedSigners>(&scenario_val);
        let admin_cap = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        
        // Add Ed25519 signer to approved signers list
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let mut preimage = vector::empty<u8>();
            vector::push_back(&mut preimage, 0x00); // Ed25519 flag
            vector::append(&mut preimage, test_proof_data::get_ed25519_public_key());
            let pk_hash = hash::blake2b256(&preimage);
            let signer_addr = address::from_bytes(pk_hash);
            authority::add_approved_signer(&mut approved_signers, signer_addr, &admin_cap, ctx);
        };
        
        // Get proof data
        let (vkey_bytes, proof_points_bytes, public_inputs_bytes) = (
            test_proof_data::get_valid_vkey_bytes(),
            test_proof_data::get_valid_proof_points_bytes(),
            test_proof_data::get_valid_public_inputs_bytes()
        );
        let (merkle_leaves, merkle_proof_bytes, merkle_proof_flags) = test_proof_data::get_merkle_proof_components();
        let signer_public_key = test_proof_data::get_ed25519_public_key();
        let ed25519_signature = test_proof_data::get_ed25519_signature();
        let timestamp = test_proof_data::get_timestamp();
        
        // Create fixed object with inline Groth16 verification
        // Use fixed item_id = 0x111111 for deterministic object ID generation
        // Use test-only version that skips object ID check (proof data may not match deterministic object ID)
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            fixed_object::create(
                &mut registry,
                0x111111, // item_id (fixed for unit tests)
                signer_public_key,
                ed25519_signature,
                merkle_leaves,
                merkle_proof_bytes,
                merkle_proof_flags,
                timestamp,
                vkey_bytes,
                proof_points_bytes,
                public_inputs_bytes,
                &approved_signers,
                &admin_cap,
                ctx
            );
        };
        
        // Get the shared object
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let obj = test_scenario::take_shared<fixed_object::FixedObject>(&scenario_val);
        
        // Get location data from registry
        let location_data_opt = fixed_object::location_data(&obj, &registry);
        assert!(std::option::is_some(&location_data_opt), 1);
        
        let location_data = *std::option::borrow(&location_data_opt);
        let ts = location::timestamp(&location_data);
        assert!(ts > 0, 2);
        
        // Return objects
        test_scenario::return_shared(obj);
        test_scenario::return_shared(registry);
        test_scenario::return_shared(approved_signers);
        authority::transfer_admin_cap(admin_cap, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test dynamic object set_location with deterministic object ID
    /// Uses item_id = 0x222222 for dynamic objects (separate from fixed objects)
    /// 
    /// This test verifies that Groth16 proof verification works correctly with properly formatted
    /// proof data (little-endian for Groth16 verification, big-endian for Merkle parsing).
    #[test]
    fun test_dynamic_object_set_location() {
        let mut scenario_val = test_scenario::begin(@0x1);
        
        // Setup
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            object_registry::init_for_testing(ctx);
            authority::init_for_testing(ctx);
            authority::create_admin_cap(@0x1, ctx);
        };
        
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let registry = test_scenario::take_shared<object_registry::ObjectRegistry>(&scenario_val);
        let mut registry_mut = registry;
        let mut approved_signers = test_scenario::take_shared<authority::ApprovedSigners>(&scenario_val);
        let admin_cap = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        
        // Add Ed25519 signer to approved signers list
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let mut preimage = vector::empty<u8>();
            vector::push_back(&mut preimage, 0x00); // Ed25519 flag
            vector::append(&mut preimage, test_proof_data::get_ed25519_public_key_3());
            let pk_hash = hash::blake2b256(&preimage);
            let signer_addr = address::from_bytes(pk_hash);
            authority::add_approved_signer(&mut approved_signers, signer_addr, &admin_cap, ctx);
        };
        
        // Create dynamic object with item_id = 0x222222 (separate from fixed objects)
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            dynamic_object::create(
                &mut registry_mut,
                0x222222, // item_id for dynamic objects
                &admin_cap,
                ctx
            );
        };
        
        // Get the shared object
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let mut obj = test_scenario::take_shared<dynamic_object::DynamicObject>(&scenario_val);
        
        // Get proof data (for item_id = 0x222222)
        // NOTE: All proof components must be from the same proof (proofData3)
        let (vkey_bytes, proof_points_bytes, public_inputs_bytes) = (
            test_proof_data::get_valid_vkey_bytes(),
            test_proof_data::get_valid_proof_points_bytes_3(), // Use proof points from proofData3
            test_proof_data::get_valid_public_inputs_bytes_3() // Use public inputs from proofData3
        );
        let (merkle_leaves, merkle_proof_bytes, merkle_proof_flags) = test_proof_data::get_merkle_proof_components_3();
        let signer_public_key = test_proof_data::get_ed25519_public_key_3();
        let ed25519_signature = test_proof_data::get_ed25519_signature_3();
        let timestamp = test_proof_data::get_timestamp_3(); // Use timestamp from proofData3
        
        // Use the proof's object ID (matches the deterministic object ID from item_id = 0x222222)
        let proof_object_id = test_proof_data::get_object_id_3();
        
        {
            dynamic_object::set_location(
                &mut obj,
                proof_object_id,
                signer_public_key,
                ed25519_signature,
                merkle_leaves,
                merkle_proof_bytes,
                merkle_proof_flags,
                timestamp,
                vkey_bytes,
                proof_points_bytes,
                public_inputs_bytes,
                &approved_signers,
                &mut registry_mut
            );
        };
        
        // Get location data and verify it was stored successfully
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let location_data_opt = dynamic_object::location_data(&obj, &registry_mut);
        assert!(std::option::is_some(&location_data_opt), 2);
        
        // Return objects
        test_scenario::return_shared(obj);
        test_scenario::return_shared(registry_mut);
        test_scenario::return_shared(approved_signers);
        authority::transfer_admin_cap(admin_cap, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test that proof data structure is correct
    /// NOTE: Groth16 verification is tested via integration tests only
    /// Unit tests skip ZK verification due to Move test VM limitations
    #[test]
    fun test_proof_data_structure() {
        // Verify that proof data can be loaded and has correct structure
        let vkey_bytes = test_proof_data::get_valid_vkey_bytes();
        let proof_points_bytes = test_proof_data::get_valid_proof_points_bytes();
        let public_inputs_bytes = test_proof_data::get_valid_public_inputs_bytes();
        
        // Verify data is non-empty
        assert!(vector::length(&vkey_bytes) > 0, 1);
        assert!(vector::length(&proof_points_bytes) > 0, 1);
        assert!(vector::length(&public_inputs_bytes) > 0, 1);
        
        // Groth16 verification is tested via integration tests
    }
    
    /// Test Merkle multiproof verification directly
    /// This isolates whether the issue is with multiproof verification or objectId matching
    #[test]
    fun test_merkle_multiproof_verification() {

        // Get merkle root from public inputs (first 32 bytes)
        // Use big-endian format for Merkle verification (Merkle proofs expect big-endian)
        let public_inputs_bytes = test_proof_data::get_valid_public_inputs_bytes_big_endian();
        let mut merkle_root = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut merkle_root, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        // Get multiproof components (in big-endian format for Merkle verification)
        let (merkle_leaves, merkle_proof_bytes, merkle_proof_flags) = test_proof_data::get_merkle_proof_components();
        let multiproof = merkle_verify::create_multiproof(merkle_leaves, merkle_proof_bytes, merkle_proof_flags);
        
        // Verify multiproof directly with root (using big-endian format)
        let verified = merkle_verify::verify_merkle_multiproof(merkle_root, multiproof);
        assert!(verified, 1); // If this fails, the multiproof doesn't verify against the root
    }
    
    /// Test objectId leaf hash computation
    /// This verifies that the objectId leaf hash matches the multiproof leaves
    #[test]
    fun test_object_id_leaf_hash() {
        
        let object_id = test_proof_data::get_object_id();
        let object_id_leaf = leaf_hash::compute_leaf_hash_address(object_id);
        
        // Get multiproof leaves
        let (merkle_leaves, _, _) = test_proof_data::get_merkle_proof_components();
        let multiproof = merkle_verify::create_multiproof(merkle_leaves, vector::empty<vector<u8>>(), vector::empty<bool>());
        let proof_leaves = merkle_verify::get_leaves(&multiproof);
        
        // Check if objectId leaf matches any proof leaf
        let num_leaves = vector::length(proof_leaves);
        let mut found = false;
        let mut i = 0;
        while (i < num_leaves) {
            let proof_leaf = *vector::borrow(proof_leaves, i);
            if (proof_leaf == object_id_leaf) {
                found = true;
                break
            };
            i = i + 1;
        };
        
        assert!(found, 1); // If this fails, objectId leaf doesn't match any multiproof leaf
    }
    
    /// Test pod_data_type leaf hash computation
    /// This verifies that the pod_data_type leaf hash matches the multiproof leaves
    #[test]
    fun test_pod_data_type_leaf_hash() {
        use sui::bcs;
        
        // BCS encode pod_data_type before hashing to match on-chain verification
        let pod_data_type = location_attestation::pod_data_type_location();
        let pod_data_type_bcs = bcs::to_bytes(&pod_data_type);
        let pod_data_type_leaf = leaf_hash::compute_leaf_hash_bytes(pod_data_type_bcs);
        
        // Get multiproof leaves
        let (merkle_leaves, _, _) = test_proof_data::get_merkle_proof_components();
        let multiproof = merkle_verify::create_multiproof(merkle_leaves, vector::empty<vector<u8>>(), vector::empty<bool>());
        let proof_leaves = merkle_verify::get_leaves(&multiproof);
        
        // Check if pod_data_type leaf matches any proof leaf
        let num_leaves = vector::length(proof_leaves);
        let mut found = false;
        let mut i = 0;
        while (i < num_leaves) {
            let proof_leaf = *vector::borrow(proof_leaves, i);
            if (proof_leaf == pod_data_type_leaf) {
                found = true;
                break
            };
            i = i + 1;
        };
        
        assert!(found, 1); // If this fails, pod_data_type leaf doesn't match any multiproof leaf
    }

}
