#[test_only]
module world::leaf_hash_tests {
    use world::leaf_hash;
    use sui::poseidon;

    /// Helper: Convert u256 to bytes (big-endian) for comparison
    /// Matches Sui's native address::from_u256 convention
    fun u256_to_bytes_be(value: u256): vector<u8> {
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

    /// Test compute_leaf_hash_u64 with known value
    /// For u64, we hash the value directly as a u256 field element using poseidon1
    /// Expected: poseidon1([value]) where value is the u64 cast to u256
    #[test]
    fun test_compute_leaf_hash_u64() {
        // Test with value 42
        let value = 42u64;
        let hash = leaf_hash::compute_leaf_hash_u64(value);
        
        // Manually compute expected hash: poseidon1([42])
        let field_elements = vector[42u256];
        let expected_hash_u256 = poseidon::poseidon_bn254(&field_elements);
        let expected_hash = u256_to_bytes_be(expected_hash_u256);
        
        // Verify hash matches
        assert!(hash == expected_hash, 1);
    }

    /// Test compute_leaf_hash_u64 with zero
    #[test]
    fun test_compute_leaf_hash_u64_zero() {
        let value = 0u64;
        let hash = leaf_hash::compute_leaf_hash_u64(value);
        
        // Expected: poseidon1([0])
        let field_elements = vector[0u256];
        let expected_hash_u256 = poseidon::poseidon_bn254(&field_elements);
        let expected_hash = u256_to_bytes_be(expected_hash_u256);
        
        assert!(hash == expected_hash, 1);
    }

    /// Test compute_leaf_hash_bool with true
    /// Bool true should hash as u256 value 1
    #[test]
    fun test_compute_leaf_hash_bool_true() {
        let value = true;
        let hash = leaf_hash::compute_leaf_hash_bool(value);
        
        // Expected: poseidon1([1])
        let field_elements = vector[1u256];
        let expected_hash_u256 = poseidon::poseidon_bn254(&field_elements);
        let expected_hash = u256_to_bytes_be(expected_hash_u256);
        
        assert!(hash == expected_hash, 1);
    }

    /// Test compute_leaf_hash_bool with false
    /// Bool false should hash as u256 value 0
    #[test]
    fun test_compute_leaf_hash_bool_false() {
        let value = false;
        let hash = leaf_hash::compute_leaf_hash_bool(value);
        
        // Expected: poseidon1([0])
        let field_elements = vector[0u256];
        let expected_hash_u256 = poseidon::poseidon_bn254(&field_elements);
        let expected_hash = u256_to_bytes_be(expected_hash_u256);
        
        assert!(hash == expected_hash, 1);
    }

    /// Test compute_leaf_hash_bytes with short bytes (<= 31 bytes)
    /// Should use poseidon1 (single field element)
    #[test]
    fun test_compute_leaf_hash_bytes_short() {
        // Test with "hello" (5 bytes) - should fit in one field element
        let bytes = b"hello";
        let hash = leaf_hash::compute_leaf_hash_bytes(bytes);
        
        // Manually compute expected hash:
        // 1. Convert bytes to field element (big-endian): "hello" = [0x68, 0x65, 0x6c, 0x6c, 0x6f]
        //    Field element = 0x68656c6c6f (big-endian: first byte is most significant)
        // 2. Hash with poseidon1
        let mut field_value: u256 = 0;
        let len = vector::length(&bytes);
        let mut i = 0;
        while (i < len) {
            let byte_val = *vector::borrow(&bytes, i) as u256;
            field_value = (field_value << 8) + byte_val; // Big-endian: shift left, then add byte
            i = i + 1;
        };
        let field_elements = vector[field_value];
        let expected_hash_u256 = poseidon::poseidon_bn254(&field_elements);
        let expected_hash = u256_to_bytes_be(expected_hash_u256);
        
        assert!(hash == expected_hash, 1);
    }

    /// Test compute_leaf_hash_bytes with exactly 31 bytes
    /// Should use poseidon1 (single field element, max size)
    #[test]
    fun test_compute_leaf_hash_bytes_31_bytes() {
        // Create 31 bytes: [0x01, 0x02, ..., 0x1f]
        let mut bytes = vector::empty<u8>();
        let mut i = 1;
        while (i <= 31) {
            vector::push_back(&mut bytes, i as u8);
            i = i + 1;
        };
        
        let hash = leaf_hash::compute_leaf_hash_bytes(bytes);
        
        // Should hash successfully (no abort means it worked)
        // Verify hash is 32 bytes
        assert!(vector::length(&hash) == 32, 1);
    }

    /// Test compute_leaf_hash_bytes with 32 bytes (requires chunking)
    /// Should use poseidon2 (two field elements)
    #[test]
    fun test_compute_leaf_hash_bytes_32_bytes() {
        // Create 32 bytes: [0x00, 0x01, ..., 0x1f]
        let mut bytes = vector::empty<u8>();
        let mut i = 0;
        while (i < 32) {
            vector::push_back(&mut bytes, i as u8);
            i = i + 1;
        };
        
        let hash = leaf_hash::compute_leaf_hash_bytes(bytes);
        
        // Should hash successfully with poseidon2
        // Verify hash is 32 bytes
        assert!(vector::length(&hash) == 32, 1);
    }

    /// Test compute_leaf_hash_bytes with empty bytes
    /// Note: Empty bytes will cause poseidon to abort since it requires at least one element
    #[test]
    #[expected_failure(abort_code = 1, location = sui::poseidon)]
    fun test_compute_leaf_hash_bytes_empty() {
        let bytes = vector::empty<u8>();
        let _hash = leaf_hash::compute_leaf_hash_bytes(bytes);
        // This should abort because poseidon requires at least one field element
    }

    /// Test compute_leaf_hash_u256
    /// u256 is converted to 32-byte little-endian bytes, then hashed with chunking
    #[test]
    fun test_compute_leaf_hash_u256() {
        // Test with u256 value 1
        let value = 1u256;
        let hash = leaf_hash::compute_leaf_hash_u256(value);
        
        // Expected: convert u256 to 32-byte big-endian bytes, then hash
        // u256 = 1 -> bytes = [0x00, ..., 0x00, 0x01] (32 bytes, big-endian)
        // Then hash those bytes (which will be chunked into field elements)
        let bytes = u256_to_bytes_be(value);
        let expected_hash = leaf_hash::compute_leaf_hash_bytes(bytes);
        
        assert!(hash == expected_hash, 1);
    }

    /// Test compute_leaf_hash_u256 with large value
    #[test]
    fun test_compute_leaf_hash_u256_large() {
        // Test with a larger u256 value
        let value = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefu256;
        let hash = leaf_hash::compute_leaf_hash_u256(value);
        
        // Should hash successfully
        assert!(vector::length(&hash) == 32, 1);
    }

    /// Test compute_leaf_hash_address
    /// Address is converted to 32-byte big-endian bytes, then hashed
    #[test]
    fun test_compute_leaf_hash_address() {
        // Create a test address (using @0x1 as a simple test case)
        let addr = @0x1;
        let hash = leaf_hash::compute_leaf_hash_address(addr);
        
        // Should hash successfully
        // Address conversion uses big-endian, so the hash should be deterministic
        assert!(vector::length(&hash) == 32, 1);
    }

    /// Test compute_leaf_hash_address with different addresses produce different hashes
    #[test]
    fun test_compute_leaf_hash_address_different() {
        let addr1 = @0x1;
        let addr2 = @0x2;
        
        let hash1 = leaf_hash::compute_leaf_hash_address(addr1);
        let hash2 = leaf_hash::compute_leaf_hash_address(addr2);
        
        // Different addresses should produce different hashes
        assert!(hash1 != hash2, 1);
    }

    /// Test that leaf hash functions are deterministic
    /// Same input should always produce same output
    #[test]
    fun test_leaf_hash_deterministic() {
        // Test u64
        let value_u64 = 42u64;
        let hash1 = leaf_hash::compute_leaf_hash_u64(value_u64);
        let hash2 = leaf_hash::compute_leaf_hash_u64(value_u64);
        assert!(hash1 == hash2, 1);
        
        // Test bool
        let hash3 = leaf_hash::compute_leaf_hash_bool(true);
        let hash4 = leaf_hash::compute_leaf_hash_bool(true);
        assert!(hash3 == hash4, 1);
        
        // Test bytes
        let bytes = b"test";
        let hash5 = leaf_hash::compute_leaf_hash_bytes(bytes);
        let hash6 = leaf_hash::compute_leaf_hash_bytes(bytes);
        assert!(hash5 == hash6, 1);
    }
}

