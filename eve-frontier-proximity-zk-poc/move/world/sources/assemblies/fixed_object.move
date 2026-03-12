module world::fixed_object {
    use sui::{event, derived_object};
    use world::location::{Self, LocationData};
    use world::location_attestation::{Self};
    use world::merkle_verify;
    use world::authority::{Self};
    use world::object_registry::{Self, ObjectRegistry};
    
    /// Fixed object - has a hardcoded LocationType of true (fixed)
    /// Location attestation must be provided during creation
    /// Uses ObjectRegistry (shared registry) for storage - same as DynamicObject
    public struct FixedObject has key {
        id: sui::object::UID,
        item_id: u64, // Game item ID for deterministic object ID generation
    }

    /// Events
    public struct FixedObjectCreatedEvent has copy, drop {
        object_id: sui::object::ID,
    }
    
    /// Create a new fixed object with location attestation
    /// Location data is set during creation and remains fixed for the lifetime of the object
    /// The object is automatically shared and cannot be returned
    /// OwnerCap is automatically transferred to the transaction sender
    /// 
    /// Uses deterministic object ID generation via object_registry::claim_object_id(item_id)
    /// This allows the proof to be generated for a known object ID before creation.
    /// 
    /// Flow:
    /// 0. Claim deterministic object ID from item_id
    /// 1. Verify location attestation (Groth16 proof, Merkle inclusion of object_id/pod_data_type, signature recovery)
    /// 2. Verify object ID matches proof merkle included object ID
    /// 3. Verify authorization (ApprovedSigners)

    /// 5. Store location data in registry
    public fun create(
        registry: &mut ObjectRegistry,
        item_id: u64,
        signer_public_key: vector<u8>,
        ed25519_signature: vector<u8>,
        merkle_leaves: vector<vector<u8>>,
        merkle_proof_bytes: vector<vector<u8>>,
        merkle_proof_flags: vector<bool>,
        timestamp: u64,
        vkey_bytes: vector<u8>,
        proof_points_bytes: vector<u8>,
        public_inputs_bytes: vector<u8>,
        approved_signers: &authority::ApprovedSigners,
        admin_cap: &authority::AdminCap,
        ctx: &mut tx_context::TxContext
    ) {
        // 0. Claim deterministic object ID from item_id
        // This allows us to know the object ID before creation, enabling proof generation
        // Must call derived_object::claim directly (not through a wrapper) for bytecode verifier
        let registry_id = object_registry::borrow_registry_id(registry);
        let object_uid = derived_object::claim(registry_id, item_id);
        let object_id = sui::object::uid_to_inner(&object_uid);
        let object_address = sui::object::id_to_address(&object_id);
        
        // Reconstruct LocationAttestationData from primitives
        let merkle_proof = merkle_verify::create_multiproof(merkle_leaves, merkle_proof_bytes, merkle_proof_flags);
        
        let verification_data = location_attestation::create_location_attestation_data(
            object_address, // Use deterministic object address (proof must be for this address)
            signer_public_key,
            ed25519_signature,
            merkle_proof,
            timestamp
        );
        
        // 1. Verify location attestation (Groth16 proof, Merkle inclusion of object_id/pod_data_type, signature recovery)
        // NOTE: public_inputs_bytes is in little-endian format (for Groth16 verification)
        // The verify_location_attestation function handles Groth16 verification and converts to big-endian for Merkle parsing
        let public_data = location_attestation::verify_location_attestation(
            &verification_data,
            vkey_bytes,
            proof_points_bytes,
            public_inputs_bytes
        );
        
        // 2. Verify object ID matches proof
        // our merkle included object ID is equal to this object's deterministic object address
        let proof_obj_id = location_attestation::object_id(&verification_data);
        assert!(object_address == proof_obj_id, 9); // E_INVALID_OBJECT_ID
        
        let obj = FixedObject {
            id: object_uid,
            item_id,
        };
        
        // 3. Verify authorization (ApprovedSigners)
        // Reconstruct signer address from public key
        let signer_pk = location_attestation::signer_public_key(&verification_data);
        let mut preimage = vector::empty<u8>();
        vector::push_back(&mut preimage, 0x00); // Ed25519 flag
        vector::append(&mut preimage, signer_pk);
        let pk_hash = sui::hash::blake2b256(&preimage);
        let signer_addr = sui::address::from_bytes(pk_hash);
        
        assert!(authority::is_approved_signer(approved_signers, signer_addr), 10); // E_UNAUTHORIZED
        
        // Set location type as fixed (hardcoded)
        let location_type = location::create_location_type(true);
        object_registry::store_location_type(registry, object_address, location_type);
        
        // 4. Store location data
        let ts = location_attestation::timestamp(&verification_data);
        let location_data = location::create_location_data(
            location_attestation::merkle_root(&public_data),
            location_attestation::coordinates_hash(&public_data),
            ts
        );
        object_registry::store_location_data(registry, object_address, location_data);
        
        // Create owner cap using authority module
        let owner_cap = authority::create_owner_cap(admin_cap, object_id, ctx);
        
        // Share the object (consumes obj, so we can't return it)
        transfer::share_object(obj);
        
        // Transfer OwnerCap to transaction sender
        authority::transfer_owner_cap(owner_cap, admin_cap, tx_context::sender(ctx));
        
        event::emit(FixedObjectCreatedEvent {
            object_id,
        });
    }

    /// Get object ID
    public fun id(obj: &FixedObject): sui::object::ID {
        sui::object::uid_to_inner(&obj.id)
    }
    
    /// Get item ID
    public fun item_id(obj: &FixedObject): u64 {
        obj.item_id
    }

    /// Get location data from registry
    public fun location_data(
        obj: &FixedObject,
        registry: &ObjectRegistry
    ): std::option::Option<LocationData> {
        let object_id = sui::object::uid_to_inner(&obj.id);
        let object_address = sui::object::id_to_address(&object_id);
        object_registry::get_location_data(registry, object_address)
    }
    
    /// Check if a fixed object exists for the given item_id
    /// Takes &FixedObject for consistency with location_data
    public fun fixed_object_exists(
        obj: &FixedObject,
        registry: &ObjectRegistry
    ): bool {
        let item_id = obj.item_id;
        object_registry::object_exists(registry, item_id)
    }

    /// Test-only function to create a fixed object with hardcoded location data
    /// Skips all ZK verification - useful for testing distance verification without proof generation
    /// The object is shared and can be retrieved using test_scenario::take_shared after the transaction
    #[test_only]
    public fun create_for_testing(
        registry: &mut ObjectRegistry,
        item_id: u64,
        merkle_root: vector<u8>,
        coordinates_hash: vector<u8>,
        timestamp: u64,
        admin_cap: &authority::AdminCap,
        ctx: &mut tx_context::TxContext
    ) {
        // Claim deterministic object ID from item_id
        let registry_id = object_registry::borrow_registry_id(registry);
        let object_uid = derived_object::claim(registry_id, item_id);
        let object_id = sui::object::uid_to_inner(&object_uid);
        let object_address = sui::object::id_to_address(&object_id);
        
        let obj = FixedObject {
            id: object_uid,
            item_id,
        };
        
        // Set location type as fixed (hardcoded)
        let location_type = location::create_location_type(true);
        object_registry::store_location_type(registry, object_address, location_type);
        
        // Store location data directly (no ZK verification)
        let location_data = location::create_location_data(
            merkle_root,
            coordinates_hash,
            timestamp
        );
        object_registry::store_location_data(registry, object_address, location_data);
        
        // Create owner cap using authority module
        let owner_cap = authority::create_owner_cap(admin_cap, object_id, ctx);
        
        // Share the object (consumes obj, so we can't return it)
        transfer::share_object(obj);
        
        // Transfer OwnerCap to transaction sender
        authority::transfer_owner_cap(owner_cap, admin_cap, tx_context::sender(ctx));
        
        event::emit(FixedObjectCreatedEvent {
            object_id,
        });
    }
}
