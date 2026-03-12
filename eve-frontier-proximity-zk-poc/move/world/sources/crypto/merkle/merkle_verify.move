module world::merkle_verify {
    use sui::poseidon;

    /// Error codes
    const E_INVALID_PROOF: u64 = 1;

    /// BN254 field modulus - maximum value for field elements
    /// All values passed to Poseidon must be < BN254_MAX
    const BN254_MAX: u256 = 21888242871839275222246405745257275088548364400416034343698204186575808495617u256;
    
    /// Maximum iterations for multiproof verification loop
    /// For a tree with N leaves, we need at most log2(N) iterations, so 64 is a safe upper bound
    const MAX_ITERATIONS: u64 = 64;
    
    /// Maximum iterations for field reduction
    /// Worst case: value = u256::max, BN254_MAX ≈ 2^254, so max iterations ≈ 2^2 = 4
    /// But we add a larger safety margin (16) to handle edge cases
    const MAX_REDUCE_ITERATIONS: u64 = 16;

    /// Merkle multiproof data structure
    /// This matches the format from generateMerkleMultiproof.ts
    /// Leaves and proof hashes are 32-byte values (u256 as bytes)
    public struct MerkleMultiProof has copy, drop {
        leaves: vector<vector<u8>>,      // Leaf hashes to verify (32 bytes each, representing u256)
        proof: vector<vector<u8>>,      // Proof hashes (sibling nodes, 32 bytes each)
        proof_flags: vector<bool>,       // Direction flags: false = hash(right, left), true = hash(left, right)
    }

    /// Verify a Merkle multiproof using Poseidon
    /// 
    /// This implements the same algorithm as generateMerkleMultiproof.ts and verifyMerkleMultiproof
    /// but uses Poseidon instead of SHA256
    /// 
    /// The algorithm processes leaves and proof hashes according to the proof flags:
    /// - false flag: hash(right, left) - left is on the right side in tree
    /// - true flag: hash(left, right) - left is on the left side in tree
    /// 
    /// Matches the TypeScript implementation:
    /// - Processes until queue.length > 1 OR proofIndex < proof.length
    /// - This ensures we verify up to the root even for a single leaf in a larger tree
    /// 
    /// # Arguments
    /// * `root` - The expected Merkle root (32 bytes, u256 as bytes)
    /// * `proof` - The multiproof data structure
    /// 
    /// # Returns
    /// Returns true if the proof is valid and matches the root, false otherwise
    public fun verify_merkle_multiproof(
        root: vector<u8>,
        proof: MerkleMultiProof
    ): bool {
        let num_leaves = vector::length(&proof.leaves);
        if (num_leaves == 0) {
            return false
        };

        // Convert root to u256 for comparison
        let expected_root = bytes_to_u256(&root);

        // Algorithm matches TypeScript verifyMerkleMultiproof:
        // 1. Start with all leaves (as u256)
        // 2. Process them level by level, using proof hashes when needed
        // 3. The proof flags indicate the direction of each hash operation
        
        let mut queue = vector::empty<u256>();
        let mut proof_index = 0;
        let mut flag_index = 0;
        
        // Initialize queue with leaves (convert bytes to u256)
        let mut i = 0;
        while (i < num_leaves) {
            let leaf_bytes = *vector::borrow(&proof.leaves, i);
            let leaf_u256 = bytes_to_u256(&leaf_bytes);
            vector::push_back(&mut queue, leaf_u256);
            i = i + 1;
        };
        
        // Process queue until we have a single root OR consume all proof hashes
        // This matches the TypeScript: while (queue.length > 1 || proofIndex < multiproof.proof.length)
        // Add safeguard: maximum iterations to prevent infinite loops
        let mut iteration_count = 0;
        
        while (vector::length(&queue) > 1 || proof_index < vector::length(&proof.proof)) {
            iteration_count = iteration_count + 1;
            if (iteration_count > MAX_ITERATIONS) {
                return false // Prevent infinite loop - too many iterations
            };
            
            let mut next_level = vector::empty<u256>();
            let mut j = 0;
            let queue_len = vector::length(&queue);
            
            // Safeguard: if queue is empty but we still have proof hashes, something is wrong
            if (queue_len == 0 && proof_index < vector::length(&proof.proof)) {
                return false
            };
            
            while (j < queue_len) {
                let left = *vector::borrow(&queue, j);
                
                // Get right sibling (either from queue or proof)
                let mut right: u256;
                if (j + 1 < queue_len) {
                    // Use next item in queue
                    right = *vector::borrow(&queue, j + 1);
                    j = j + 2;
                } else {
                    // Need to use proof hash
                    if (proof_index >= vector::length(&proof.proof)) {
                        return false // Invalid proof - not enough proof hashes
                    };
                    let proof_bytes = *vector::borrow(&proof.proof, proof_index);
                    right = bytes_to_u256(&proof_bytes);
                    proof_index = proof_index + 1;
                    j = j + 1;
                };
                
                // Determine hash order based on flag
                // Flags indicate direction for all hash operations
                let mut hash_result: u256;
                if (flag_index < vector::length(&proof.proof_flags)) {
                    let flag = *vector::borrow(&proof.proof_flags, flag_index);
                    flag_index = flag_index + 1;
                    if (flag) {
                        // Flag true: hash(left, right)
                        hash_result = hash_pair_u256(left, right);
                    } else {
                        // Flag false: hash(right, left)
                        hash_result = hash_pair_u256(right, left);
                    }
                } else {
                    // No flag available: default to hash(left, right)
                    hash_result = hash_pair_u256(left, right);
                };
                
                vector::push_back(&mut next_level, hash_result);
            };
            
            // Safeguard: if queue length doesn't decrease and we're not making progress, abort
            // This prevents infinite loops where queue stays the same size
            let next_level_len = vector::length(&next_level);
            if (queue_len > 1 && next_level_len >= queue_len && proof_index >= vector::length(&proof.proof)) {
                return false // Queue not reducing and no more proof hashes - algorithm not converging
            };
            
            queue = next_level;
        };
        
        // Final root should match
        if (vector::length(&queue) != 1) {
            return false // Queue should have exactly one element (the root) - E_INVALID_PROOF
        };
        
        let computed_root = *vector::borrow(&queue, 0);
        computed_root == expected_root
    }

    /// Hash a pair of nodes using Poseidon (for Merkle tree construction)
    /// Uses Poseidon2: poseidon_bn254([left, right])
    /// Ensures both inputs are < BN254_MAX before hashing
    fun hash_pair_u256(left: u256, right: u256): u256 {
        // Ensure values are in field range (Poseidon requires < BN254_MAX)
        let left_field = reduce_to_field(left);
        let right_field = reduce_to_field(right);
        let inputs = vector[left_field, right_field];
        poseidon::poseidon_bn254(&inputs)
    }

    /// Reduce u256 value to BN254 field range
    /// If value >= BN254_MAX, reduce it modulo BN254_MAX
    /// Note: Move doesn't have native modulo for u256, so we use repeated subtraction
    /// Optimized with iteration limit to prevent infinite loops or excessive gas usage
    fun reduce_to_field(value: u256): u256 {
        if (value < BN254_MAX) {
            value
        } else {
            // Reduce modulo BN254_MAX using repeated subtraction
            // Add safeguard: maximum iterations to prevent excessive gas usage
            let mut result = value;
            let mut iterations = 0;
            while (result >= BN254_MAX) {
                iterations = iterations + 1;
                if (iterations > MAX_REDUCE_ITERATIONS) {
                    // This should never happen in practice, but prevents infinite loops
                    // If we hit this, the input value is malformed or there's a bug
                    abort 2 // E_INVALID_FIELD_VALUE
                };
                result = result - BN254_MAX;
            };
            result
        }
    }

    /// Convert bytes to u256 (big-endian interpretation)
    /// Matches Sui's native address::to_u256 convention which interprets addresses as big-endian
    /// First byte (index 0) is most significant, last byte is least significant
    fun bytes_to_u256(bytes: &vector<u8>): u256 {
        let len = vector::length(bytes);
        if (len > 32) {
            abort 1 // Invalid length
        };
        
        let mut value: u256 = 0;
        let mut i = 0;
        while (i < len) {
            let byte_val = *vector::borrow(bytes, i) as u256;
            let shift_amount = ((len - 1 - i) as u8) * 8; // Big-endian: first byte shifts most
            value = value + (byte_val << shift_amount);
            i = i + 1;
        };
        value
    }

    /// Create a MerkleMultiProof from components
    public fun create_multiproof(
        leaves: vector<vector<u8>>,
        proof: vector<vector<u8>>,
        proof_flags: vector<bool>
    ): MerkleMultiProof {
        MerkleMultiProof {
            leaves,
            proof,
            proof_flags
        }
    }

    /// Get leaves from MerkleMultiProof
    public fun get_leaves(proof: &MerkleMultiProof): &vector<vector<u8>> {
        &proof.leaves
    }

    /// Entry function to verify a Merkle multiproof on-chain
    /// 
    /// This function can be called directly from transactions and from other Move modules.
    /// It accepts the multiproof components as separate arguments for easier integration.
    /// 
    /// # Arguments
    /// * `root` - The expected Merkle root (32 bytes, u256 as bytes)
    /// * `leaves` - Leaf hashes to verify (vector of 32-byte vectors)
    /// * `proof` - Proof hashes (sibling nodes, vector of 32-byte vectors)
    /// * `proof_flags` - Direction flags (vector<bool>): false = hash(right, left), true = hash(left, right)
    /// 
    /// # Aborts
    /// Aborts with E_INVALID_PROOF if the proof is invalid or doesn't match the root
    /// 
    /// # Usage
    /// Can be called from:
    /// - Transactions (as an entry point)
    /// - Other Move modules (e.g., distance_check)
    #[allow(lint(public_entry))]
    public entry fun verify_multiproof(
        root: vector<u8>,
        leaves: vector<vector<u8>>,
        proof: vector<vector<u8>>,
        proof_flags: vector<bool>
    ) {
        let multiproof = MerkleMultiProof {
            leaves,
            proof,
            proof_flags
        };
        
        if (!verify_merkle_multiproof(root, multiproof)) {
            abort E_INVALID_PROOF
        }
    }

    #[test]
    fun test_verify_single_leaf() {
        // Simple test: single leaf should hash to itself (for a tree with one node)
        // For Poseidon, a single leaf in a tree of depth 1 is the root
        let leaf = x"0000000000000000000000000000000000000000000000000000000000000001"; // u256 = 1
        let root = leaf; // For single leaf, root equals leaf
        
        let proof = MerkleMultiProof {
            leaves: vector[leaf],
            proof: vector::empty<vector<u8>>(),
            proof_flags: vector::empty<bool>(),
        };
        
        assert!(verify_merkle_multiproof(root, proof), E_INVALID_PROOF);
    }

    #[test]
    fun test_verify_two_leaves() {
        // Test with two leaves using Poseidon
        // Leaf values as u256: 1 and 2
        let leaf1_bytes = x"0100000000000000000000000000000000000000000000000000000000000000"; // u256 = 1 (little-endian)
        let leaf2_bytes = x"0200000000000000000000000000000000000000000000000000000000000000"; // u256 = 2 (little-endian)
        
        // Convert to u256
        let leaf1 = bytes_to_u256(&leaf1_bytes);
        let leaf2 = bytes_to_u256(&leaf2_bytes);
        
        // Root = Poseidon([leaf1, leaf2])
        let root_u256 = hash_pair_u256(leaf1, leaf2);
        let root = u256_to_bytes(root_u256);
        
        let proof = MerkleMultiProof {
            leaves: vector[leaf1_bytes, leaf2_bytes],
            proof: vector::empty<vector<u8>>(),
            proof_flags: vector[true], // hash(left, right) = hash(leaf1, leaf2)
        };
        
        assert!(verify_merkle_multiproof(root, proof), E_INVALID_PROOF);
    }

    /// Convert u256 to 32-byte vector (big-endian)
    /// Matches Sui's native address::from_u256 convention which encodes as big-endian
    /// First byte is most significant, last byte is least significant
    #[allow(unused_function)]
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
}

