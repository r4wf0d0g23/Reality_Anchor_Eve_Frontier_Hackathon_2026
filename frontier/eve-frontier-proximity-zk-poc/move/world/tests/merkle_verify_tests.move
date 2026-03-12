#[test_only]
module world::merkle_verify_tests {
    use world::merkle_verify;
    use sui::poseidon;

    /// Helper: Convert u256 to 32-byte vector (big-endian)
    /// Matches Sui's native address::from_u256 convention
    fun u256_to_bytes(value: u256): vector<u8> {
        let mut bytes = vector::empty<u8>();
        let mut i = 0;
        // Extract bytes from most significant to least significant (big-endian)
        while (i < 32) {
            let shift_amount = (31 - i) * 8; // Most significant byte first
            let byte_val = ((value >> shift_amount) & 255u256) as u8;
            vector::push_back(&mut bytes, byte_val);
            i = i + 1;
        };
        bytes
    }

    /// Helper: Hash pair using Poseidon
    fun hash_pair_u256(left: u256, right: u256): u256 {
        let inputs = vector[left, right];
        poseidon::poseidon_bn254(&inputs)
    }

    /// Test single leaf verification (edge case)
    #[test]
    fun test_single_leaf_verification() {
        // Use small value < BN254_MAX
        let leaf_value = 1u256;
        let leaf = u256_to_bytes(leaf_value);
        let root = leaf; // For single leaf, root equals leaf
        
        let proof = merkle_verify::create_multiproof(
            vector[leaf],
            vector::empty<vector<u8>>(),
            vector::empty<bool>()
        );
        
        assert!(merkle_verify::verify_merkle_multiproof(root, proof), 1);
    }

    /// Test two leaves verification
    #[test]
    fun test_two_leaves_verification() {
        // Use small values < BN254_MAX
        let leaf1_value = 1u256;
        let leaf2_value = 2u256;
        let leaf1 = u256_to_bytes(leaf1_value);
        let leaf2 = u256_to_bytes(leaf2_value);
        
        // Root = Poseidon([leaf1, leaf2])
        let root_u256 = hash_pair_u256(leaf1_value, leaf2_value);
        let root = u256_to_bytes(root_u256);
        
        let proof = merkle_verify::create_multiproof(
            vector[leaf1, leaf2],
            vector::empty<vector<u8>>(),
            vector[true] // hash(left, right) = hash(leaf1, leaf2)
        );
        
        assert!(merkle_verify::verify_merkle_multiproof(root, proof), 1);
    }

    /// Test three leaves verification (proving all 3 leaves in a 3-leaf tree)
    /// 
    /// For a tree with exactly 3 leaves total (IMT uses zero values for empty nodes):
    /// Tree structure:
    ///        root
    ///       /    \
    ///    left    right
    ///   /    \   /    \
    /// leaf0 leaf1 leaf2 zero
    /// 
    /// IMT (Incremental Merkle Tree) uses zero values (0) for empty nodes.
    /// When proving all 3 leaves [leaf0, leaf1, leaf2]:
    /// - Iteration 1: 
    ///   - Pair leaf0 + leaf1 -> left_parent (flag: true)
    ///   - leaf2 is left alone, needs proof hash (zero value for missing sibling)
    ///   - hash(leaf2, zero) -> right_parent (flag: true)
    ///   - Queue becomes: [left_parent, right_parent]
    /// - Iteration 2:
    ///   - hash(left_parent, right_parent) -> root (flag: true)
    ///   - Queue becomes: [root]
    /// 
    /// This matches standard Merkle tree methodology where odd numbers at a level
    /// use zero values or duplicate the last node for padding.
    #[test]
    fun test_three_leaves_verification() {
        // Use small values < BN254_MAX
        let leaf0_value = 1u256;
        let leaf1_value = 2u256;
        let leaf2_value = 3u256;
        let zero_value = 0u256; // IMT uses zero values for empty nodes
        
        let leaf0 = u256_to_bytes(leaf0_value);
        let leaf1 = u256_to_bytes(leaf1_value);
        let leaf2 = u256_to_bytes(leaf2_value);
        let zero = u256_to_bytes(zero_value);
        
        // Build tree manually for a 3-leaf tree (IMT pads with zeros):
        // Level 0: [leaf0, leaf1, leaf2, zero]
        // Level 1: [hash(leaf0, leaf1), hash(leaf2, zero)]
        let left_parent = hash_pair_u256(leaf0_value, leaf1_value);
        let right_parent = hash_pair_u256(leaf2_value, zero_value);
        // Level 2 (root): hash(left_parent, right_parent)
        let root_u256 = hash_pair_u256(left_parent, right_parent);
        let root = u256_to_bytes(root_u256);
        
        // Create multiproof proving all 3 leaves [leaf0, leaf1, leaf2]
        // We need zero as a proof hash (the missing sibling, since IMT uses zero for empty nodes)
        // Flags: all true (hash(left, right)) since we process sequentially
        let proof = merkle_verify::create_multiproof(
            vector[leaf0, leaf1, leaf2], // All 3 leaves we're proving
            vector[zero],                 // Proof hash: zero value (IMT uses 0 for empty nodes)
            vector[true, true, true]      // Flags: all hash(left, right)
        );
        
        // Verify the multiproof
        let result = merkle_verify::verify_merkle_multiproof(root, proof);
        assert!(result, 1);
    }

    /// Test invalid proof (wrong root)
    #[test]
    fun test_invalid_proof_wrong_root() {
        // Use small values < BN254_MAX
        let leaf1_value = 1u256;
        let leaf2_value = 2u256;
        let leaf1 = u256_to_bytes(leaf1_value);
        let leaf2 = u256_to_bytes(leaf2_value);
        
        // Compute correct root
        let correct_root_u256 = hash_pair_u256(leaf1_value, leaf2_value);
        let correct_root = u256_to_bytes(correct_root_u256);
        
        // Use wrong root (different value)
        let wrong_root_value = 999u256;
        let wrong_root = u256_to_bytes(wrong_root_value);
        
        let proof = merkle_verify::create_multiproof(
            vector[leaf1, leaf2],
            vector::empty<vector<u8>>(),
            vector[true] // hash(left, right)
        );
        
        // Should return false (not abort) for wrong root
        assert!(!merkle_verify::verify_merkle_multiproof(wrong_root, proof), 1);
        // Correct root should verify
        assert!(merkle_verify::verify_merkle_multiproof(correct_root, proof), 1);
    }

    /// Test invalid proof (empty leaves)
    #[test]
    fun test_invalid_proof_empty_leaves() {
        // Use small value < BN254_MAX
        let root_value = 1u256;
        let root = u256_to_bytes(root_value);
        
        let proof = merkle_verify::create_multiproof(
            vector::empty<vector<u8>>(),
            vector::empty<vector<u8>>(),
            vector::empty<bool>()
        );
        
        // Should return false, not abort
        assert!(!merkle_verify::verify_merkle_multiproof(root, proof), 1);
    }

    /// Test verify_multiproof entry function with single leaf
    #[test]
    fun test_verify_multiproof_single_leaf() {
        // Use small value < BN254_MAX
        let leaf_value = 1u256;
        let leaf = u256_to_bytes(leaf_value);
        let root = leaf; // For single leaf, root equals leaf
        
        // Call entry function directly with components
        merkle_verify::verify_multiproof(
            root,
            vector[leaf],
            vector::empty<vector<u8>>(),
            vector::empty<bool>()
        );
        
        // If we get here, verification passed (no abort)
    }

    /// Test verify_multiproof entry function with two leaves
    #[test]
    fun test_verify_multiproof_two_leaves() {
        // Use small values < BN254_MAX
        let leaf1_value = 1u256;
        let leaf2_value = 2u256;
        let leaf1 = u256_to_bytes(leaf1_value);
        let leaf2 = u256_to_bytes(leaf2_value);
        
        // Root = Poseidon([leaf1, leaf2])
        let root_u256 = hash_pair_u256(leaf1_value, leaf2_value);
        let root = u256_to_bytes(root_u256);
        
        // Call entry function directly with components
        merkle_verify::verify_multiproof(
            root,
            vector[leaf1, leaf2],
            vector::empty<vector<u8>>(),
            vector[true] // hash(left, right) = hash(leaf1, leaf2)
        );
        
        // If we get here, verification passed (no abort)
    }

    /// Test verify_multiproof entry function with invalid proof (should abort)
    #[test]
    #[expected_failure(abort_code = 1, location = world::merkle_verify)]
    fun test_verify_multiproof_invalid_root() {
        // Use small values < BN254_MAX
        let leaf1_value = 1u256;
        let leaf2_value = 2u256;
        let leaf1 = u256_to_bytes(leaf1_value);
        let leaf2 = u256_to_bytes(leaf2_value);
        
        // Use wrong root (different value)
        let wrong_root_value = 999u256;
        let wrong_root = u256_to_bytes(wrong_root_value);
        
        // This should abort with E_INVALID_PROOF
        merkle_verify::verify_multiproof(
            wrong_root,
            vector[leaf1, leaf2],
            vector::empty<vector<u8>>(),
            vector[true]
        );
    }

    /// Test verify_multiproof entry function with empty leaves (should abort)
    #[test]
    #[expected_failure(abort_code = 1, location = world::merkle_verify)]
    fun test_verify_multiproof_empty_leaves() {
        // Use small value < BN254_MAX
        let root_value = 1u256;
        let root = u256_to_bytes(root_value);
        
        // This should abort with E_INVALID_PROOF (empty leaves)
        merkle_verify::verify_multiproof(
            root,
            vector::empty<vector<u8>>(),
            vector::empty<vector<u8>>(),
            vector::empty<bool>()
        );
    }
}

