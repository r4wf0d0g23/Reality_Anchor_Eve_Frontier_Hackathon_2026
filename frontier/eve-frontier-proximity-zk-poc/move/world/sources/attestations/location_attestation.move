module world::location_attestation {
    use sui::ed25519;
    use sui::bcs;
    use sui::groth16;
    use world::merkle_verify::{Self, MerkleMultiProof};
    use world::leaf_hash;

    /// Error codes
    const E_INVALID_PROOF: u64 = 1;
    const E_INVALID_SIGNATURE: u64 = 2;
    const E_INVALID_POD_DATA_TYPE: u64 = 3;
    const E_INVALID_PUBLIC_INPUTS: u64 = 4;
    const E_INVALID_OBJECT_ID: u64 = 5;

    /// Expected POD data type
    const POD_DATA_TYPE_LOCATION: vector<u8> = b"evefrontier.location_attestation";

    /// Location attestation data structure for ZK proof verification
    public struct LocationAttestationData has copy, drop {
        object_id: address,                 // Object ID to verify merkle inclusion for
        signer_public_key: vector<u8>,     // Ed25519 public key (32 bytes) for signature verification
        ed25519_signature: vector<u8>,     // Ed25519 signature (64 bytes) for merkle root
        merkle_proof: MerkleMultiProof,    // Merkle proof to verify object_id inclusion
        timestamp: u64,                    // Timestamp of the location attestation
    }

    /// Parsed public inputs/outputs from location attestation proof
    public struct LocationAttestationPublicData has copy, drop, store {
        merkle_root: vector<u8>,
        coordinates_hash: vector<u8>,
        signature_and_key_hash: vector<u8>,
    }

    /// Get merkle root from LocationAttestationPublicData
    public fun merkle_root(data: &LocationAttestationPublicData): vector<u8> {
        data.merkle_root
    }

    /// Get coordinates hash from LocationAttestationPublicData
    public fun coordinates_hash(data: &LocationAttestationPublicData): vector<u8> {
        data.coordinates_hash
    }

    /// Get signature and key hash from LocationAttestationPublicData
    public fun signature_and_key_hash(data: &LocationAttestationPublicData): vector<u8> {
        data.signature_and_key_hash
    }

    /// Get object ID from LocationAttestationData
    public fun object_id(data: &LocationAttestationData): address {
        data.object_id
    }

    /// Get timestamp from LocationAttestationData
    public fun timestamp(data: &LocationAttestationData): u64 {
        data.timestamp
    }

    /// Get signer public key from LocationAttestationData
    public fun signer_public_key(data: &LocationAttestationData): vector<u8> {
        data.signer_public_key
    }

    /// Get Ed25519 signature from LocationAttestationData
    public fun ed25519_signature(data: &LocationAttestationData): vector<u8> {
        data.ed25519_signature
    }
    
    /// Get POD data type constant (for testing)
    public fun pod_data_type_location(): vector<u8> {
        POD_DATA_TYPE_LOCATION
    }

    /// Get merkle proof from LocationAttestationData
    public fun merkle_proof(data: &LocationAttestationData): MerkleMultiProof {
        data.merkle_proof
    }

    /// Parse public inputs from bytes
    public fun parse_public_inputs(public_inputs_bytes: vector<u8>): LocationAttestationPublicData {
        let len = vector::length(&public_inputs_bytes);
        assert!(len == 96, E_INVALID_PUBLIC_INPUTS);
        
        let mut i = 0;
        let mut merkle_root = vector::empty<u8>();
        while (i < 32) {
            vector::push_back(&mut merkle_root, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        let mut coordinates_hash = vector::empty<u8>();
        while (i < 64) {
            vector::push_back(&mut coordinates_hash, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        let mut signature_and_key_hash = vector::empty<u8>();
        while (i < 96) {
            vector::push_back(&mut signature_and_key_hash, *vector::borrow(&public_inputs_bytes, i));
            i = i + 1;
        };
        
        LocationAttestationPublicData {
            merkle_root,
            coordinates_hash,
            signature_and_key_hash,
        }
    }

    /// Verify signature and recover key
    fun verify_signature_and_recover_key(
        signature: vector<u8>,
        message: vector<u8>,
        public_key: vector<u8>
    ): bool {
        ed25519::ed25519_verify(&signature, &public_key, &message)
    }

    /// Compute signatureAndKeyHash
    fun compute_signature_and_key_hash(
        signature: vector<u8>,
        public_key: vector<u8>
    ): vector<u8> {
        let mut combined = vector::empty<u8>();
        let mut i = 0;
        let sig_len = vector::length(&signature);
        while (i < sig_len) {
            vector::push_back(&mut combined, *vector::borrow(&signature, i));
            i = i + 1;
        };
        i = 0;
        let pk_len = vector::length(&public_key);
        while (i < pk_len) {
            vector::push_back(&mut combined, *vector::borrow(&public_key, i));
            i = i + 1;
        };
        
        leaf_hash::compute_leaf_hash_bytes(combined)
    }

    /// Verify objectId matches the merkle root
    /// NOTE: merkle_root is in big-endian format (from public_inputs_bytes)
    /// Merkle root and multiproof are now both in little-endian format (matching Move's bytes_to_u256)
    /// No reversal needed since we're using little-endian consistently off-chain
    fun verify_object_id_in_merkle_root(
        object_id: address,
        merkle_root: vector<u8>,
        merkle_proof: &MerkleMultiProof
    ): bool {
        // No reversal needed - merkle_root is already in little-endian format
        if (!merkle_verify::verify_merkle_multiproof(merkle_root, *merkle_proof)) {
            return false
        };
        
        let object_id_leaf = leaf_hash::compute_leaf_hash_address(object_id);
        let proof_leaves = merkle_verify::get_leaves(merkle_proof);
        let num_leaves = vector::length(proof_leaves);
        let mut i = 0;
        while (i < num_leaves) {
            let proof_leaf = *vector::borrow(proof_leaves, i);
            if (proof_leaf == object_id_leaf) {
                return true
            };
            i = i + 1;
        };
        
        false
    }

    /// Verify pod_data_type is in the merkle root
    /// NOTE: merkle_root is in big-endian format (from public_inputs_bytes)
    /// Merkle root and multiproof are now both in little-endian format (matching Move's bytes_to_u256)
    /// No reversal needed since we're using little-endian consistently off-chain
    fun verify_pod_data_type_in_merkle_root(
        merkle_root: vector<u8>,
        merkle_proof: &MerkleMultiProof
    ): bool {
        // No reversal needed - merkle_root is already in little-endian format
        if (!merkle_verify::verify_merkle_multiproof(merkle_root, *merkle_proof)) {
            return false
        };
        
        // BCS encode pod_data_type before hashing to match off-chain BCS encoding
        let pod_data_type = POD_DATA_TYPE_LOCATION;
        let pod_data_type_bcs = bcs::to_bytes(&pod_data_type);
        let pod_data_type_leaf = leaf_hash::compute_leaf_hash_bytes(pod_data_type_bcs);
        let proof_leaves = merkle_verify::get_leaves(merkle_proof);
        let num_leaves = vector::length(proof_leaves);
        let mut i = 0;
        while (i < num_leaves) {
            let proof_leaf = *vector::borrow(proof_leaves, i);
            if (proof_leaf == pod_data_type_leaf) {
                return true
            };
            i = i + 1;
        };
        
        false
    }

    /// Convert public inputs from little-endian (Groth16 format) to big-endian (Merkle parsing format)
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

    /// Verify location attestation (Groth16 proof, Merkle, signature, etc.)
    /// This function performs all verification checks including Groth16 verification
    /// 
    /// Parameters:
    /// - verification_data: Location attestation data (object_id, signatures, merkle proof, etc.)
    /// - vkey_bytes: Verification key bytes (for Groth16 verification)
    /// - proof_points_bytes: Proof points bytes (for Groth16 verification)
    /// - public_inputs_bytes: Public inputs bytes in little-endian format (for Groth16 verification)
    /// 
    /// Returns parsed public data if all checks pass, aborts otherwise
    public fun verify_location_attestation(
        verification_data: &LocationAttestationData,
        vkey_bytes: vector<u8>,
        proof_points_bytes: vector<u8>,
        public_inputs_bytes: vector<u8>
    ): LocationAttestationPublicData {
        // 1. Verify Groth16 proof
        // NOTE: public_inputs_bytes is in little-endian format (for Groth16 verification)
        let pvk = groth16::prepare_verifying_key(&groth16::bn254(), &vkey_bytes);
        let proof_points = groth16::proof_points_from_bytes(proof_points_bytes);
        let public_inputs = groth16::public_proof_inputs_from_bytes(public_inputs_bytes);
        assert!(
            groth16::verify_groth16_proof(&groth16::bn254(), &pvk, &public_inputs, &proof_points),
            E_INVALID_PROOF
        );
        
        // 1.5. Convert public inputs from little-endian (Groth16 format) to big-endian (Merkle parsing format)
        // Each field element is 32 bytes - reverse each one
        let public_inputs_bytes_big_endian = convert_public_inputs_to_big_endian(public_inputs_bytes);
        
        // 2. Parse public inputs (using big-endian format for Merkle parsing)
        let public_data = parse_public_inputs(public_inputs_bytes_big_endian);
        let merkle_root = merkle_root(&public_data);
        let signature_and_key_hash = signature_and_key_hash(&public_data);
        
        // 3. Check that objectId matches via merkle inclusion
        if (!verify_object_id_in_merkle_root(verification_data.object_id, merkle_root, &verification_data.merkle_proof)) {
            abort E_INVALID_OBJECT_ID
        };
        
        // 4. Check pod_data_type is in merkle root
        if (!verify_pod_data_type_in_merkle_root(merkle_root, &verification_data.merkle_proof)) {
            abort E_INVALID_POD_DATA_TYPE
        };
        
        // 5. Check signatureAndKeyHash against provided signature and public key
        // Both signature_and_key_hash from public_inputs_bytes and computed_hash are in big-endian format
        // This matches Sui's native address::to_u256 convention (big-endian interpretation)
        let computed_hash = compute_signature_and_key_hash(verification_data.ed25519_signature, verification_data.signer_public_key);
        if (computed_hash != signature_and_key_hash) {
            abort E_INVALID_SIGNATURE
        };
        
        // 6. Verify signature
        if (!verify_signature_and_recover_key(verification_data.ed25519_signature, merkle_root, verification_data.signer_public_key)) {
            abort E_INVALID_SIGNATURE
        };
        
        public_data
    }

    public fun create_location_attestation_data(
        object_id: address,
        signer_public_key: vector<u8>,
        ed25519_signature: vector<u8>,
        merkle_proof: MerkleMultiProof,
        timestamp: u64
    ): LocationAttestationData {
        LocationAttestationData {
            object_id,
            signer_public_key,
            ed25519_signature,
            merkle_proof,
            timestamp,
        }
    }

    #[test_only]
    public fun create_location_attestation_data_test(
        object_id: address,
        signer_public_key: vector<u8>,
        ed25519_signature: vector<u8>,
        merkle_proof: MerkleMultiProof,
        timestamp: u64
    ): LocationAttestationData {
        create_location_attestation_data(object_id, signer_public_key, ed25519_signature, merkle_proof, timestamp)
    }

    #[test_only]
    public fun create_location_attestation_public_data(
        merkle_root: vector<u8>,
        coordinates_hash: vector<u8>,
        signature_and_key_hash: vector<u8>
    ): LocationAttestationPublicData {
        LocationAttestationPublicData {
            merkle_root,
            coordinates_hash,
            signature_and_key_hash,
        }
    }

}
