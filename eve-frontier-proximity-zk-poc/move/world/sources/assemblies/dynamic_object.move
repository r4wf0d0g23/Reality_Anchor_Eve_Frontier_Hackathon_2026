module world::dynamic_object {
    use sui::{event, derived_object};
    
    use world::location::{Self, LocationData};
    use world::location_attestation::{Self};
    use world::merkle_verify;
    use world::authority::{Self};
    use world::object_registry::{Self, ObjectRegistry};

    /// Dynamic object - has a hardcoded LocationType of false (dynamic)
    /// Location can be updated after creation using set_location
    /// Uses deterministic object ID generation via item_id
    public struct DynamicObject has key {
        id: UID,
        item_id: u64, // Game item ID for deterministic object ID generation
    }

    /// Events
    public struct DynamicObjectCreatedEvent has copy, drop {
        object_id: ID,
    }

    public struct LocationUpdatedEvent has copy, drop {
        object_id: ID,
    }

    /// Create a new dynamic object
    /// Location data can be set later using set_location
    /// The object is automatically shared and cannot be returned
    /// OwnerCap is automatically transferred to the transaction sender
    /// 
    /// Uses deterministic object ID generation via object_registry::claim_object_id(item_id)
    /// This allows the proof to be generated for a known object ID before creation.
    public fun create(
        registry: &mut ObjectRegistry,
        item_id: u64,
        admin_cap: &authority::AdminCap,
        ctx: &mut tx_context::TxContext
    ) {
        // Claim deterministic object ID from item_id
        // Must call derived_object::claim directly (not through a wrapper) for bytecode verifier
        let registry_id = object_registry::borrow_registry_id(registry);
        let object_uid = derived_object::claim(registry_id, item_id);
        let object_id = object::uid_to_inner(&object_uid);
        let object_address = object::id_to_address(&object_id);
        
        let obj = DynamicObject {
            id: object_uid,
            item_id,
        };
        
        // Set location type as dynamic
        let location_type = location::create_location_type(false);
        object_registry::store_location_type(registry, object_address, location_type);
        
        // Create owner cap using authority module
        let owner_cap = authority::create_owner_cap(admin_cap, object_id, ctx);
        
        // Share the object (consumes obj, so we can't return it)
        transfer::share_object(obj);
        
        // Transfer OwnerCap to transaction sender
        authority::transfer_owner_cap(owner_cap, admin_cap, tx_context::sender(ctx));
        
        event::emit(DynamicObjectCreatedEvent {
            object_id,
        });
    }

    /// Set location for a dynamic object
    /// 
    /// Flow:
    /// 0. Reconstruct LocationAttestationData from primitives
    /// 1. Verify location attestation (Groth16 proof, Merkle inclusion of object_id/pod_data_type, signature recovery)
    /// 2. Verify object ID matches proof merkle included object ID
    /// 3. Verify authorization (ApprovedSigners)
    /// 4. Store location data in registry

    /// 5. Store location data in registry
    public fun set_location(
        obj: &mut DynamicObject,
        proof_object_id: address,
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
        registry: &mut ObjectRegistry
    ) {
        // 0. Reconstruct LocationAttestationData from primitives
        let merkle_proof = merkle_verify::create_multiproof(merkle_leaves, merkle_proof_bytes, merkle_proof_flags);
        
        let verification_data = location_attestation::create_location_attestation_data(
            proof_object_id,
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
        let obj_id = object::uid_to_inner(&obj.id);
        let obj_addr = object::id_to_address(&obj_id);
        let proof_obj_id = location_attestation::object_id(&verification_data);
        assert!(obj_addr == proof_obj_id, 9); // E_INVALID_OBJECT_ID
        
        // 3. Verify authorization (ApprovedSigners)
        // Reconstruct signer address from public key
        let signer_pk = location_attestation::signer_public_key(&verification_data);
        let mut preimage = vector::empty<u8>();
        vector::push_back(&mut preimage, 0x00); // Ed25519 flag
        vector::append(&mut preimage, signer_pk);
        let pk_hash = sui::hash::blake2b256(&preimage);
        let signer_addr = sui::address::from_bytes(pk_hash);
        
        assert!(authority::is_approved_signer(approved_signers, signer_addr), 10); // E_UNAUTHORIZED
        
        // 4. Store location data
        let ts = location_attestation::timestamp(&verification_data);
        let location_data = location::create_location_data(
            location_attestation::merkle_root(&public_data),
            location_attestation::coordinates_hash(&public_data),
            ts
        );
        
        object_registry::store_location_data(registry, obj_addr, location_data);
        
        event::emit(LocationUpdatedEvent {
            object_id: obj_id,
        });
    }

    /// Get object ID
    public fun id(obj: &DynamicObject): ID {
        object::uid_to_inner(&obj.id)
    }
    
    /// Get item ID
    public fun item_id(obj: &DynamicObject): u64 {
        obj.item_id
    }

    /// Get location data from registry
    public fun location_data(
        obj: &DynamicObject,
        registry: &ObjectRegistry
    ): std::option::Option<LocationData> {
        let object_id = object::uid_to_inner(&obj.id);
        let object_address = object::id_to_address(&object_id);
        object_registry::get_location_data(registry, object_address)
    }
    
    /// Check if a dynamic object exists for the given item_id
    /// Takes &DynamicObject for consistency with location_data
    public fun dynamic_object_exists(
        obj: &DynamicObject,
        registry: &ObjectRegistry
    ): bool {
        let item_id = obj.item_id;
        object_registry::object_exists(registry, item_id)
    }
}
