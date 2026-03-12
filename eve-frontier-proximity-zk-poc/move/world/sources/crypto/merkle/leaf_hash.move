module world::leaf_hash {
    use sui::poseidon;
    use sui::address;

    /// Compute a leaf hash for a POD entry using Poseidon
    /// 
    /// This matches the off-chain computation in podMerkleUtils.ts:
    /// - For integer types (u64, bool, u8, u16, u32, u128): hash value directly as u256
    /// - For vector<u8> (strings, bytes): convert bytes to field elements (big-endian) and hash
    /// - For address: convert to 32-byte big-endian bytes, then to field elements and hash
    /// - For u256: convert to 32-byte big-endian bytes, then to field elements and hash
    /// 
    /// IMPORTANT: Byte-to-field conversion uses BIG-ENDIAN for consistency with Sui:
    /// - Matches Sui's native address::to_u256 convention (big-endian interpretation)
    /// - Ensures consistency with multiproof verification which uses bytes_to_u256 (big-endian)
    /// - Aligns with Sui's native behavior for address conversion
    /// 
    /// Note: Entry name is NOT included in the hash. Field identification comes from leaf index.
    /// BCS encoding is used for vector<u8> types before hashing to match Move's BCS encoding.

    /// Compute leaf hash for integer types (u64, bool, u8, u16, u32, u128) - direct hashing
    /// Hashes the value directly as a u256 field element using poseidon1
    /// This matches: poseidon1([valueBigInt]) in podMerkleUtils.ts
    public fun compute_leaf_hash_u64(value: u64): vector<u8> {
        let field_elements = vector[value as u256];
        let hash_u256 = poseidon::poseidon_bn254(&field_elements);
        u256_to_bytes(hash_u256)
    }

    /// Compute leaf hash for bool - direct hashing
    /// Converts bool to u256 (1 or 0) and hashes directly
    public fun compute_leaf_hash_bool(value: bool): vector<u8> {
        let value_u256 = if (value) { 1u256 } else { 0u256 };
        let field_elements = vector[value_u256];
        let hash_u256 = poseidon::poseidon_bn254(&field_elements);
        u256_to_bytes(hash_u256)
    }

    /// Compute leaf hash for vector<u8> (strings, bytes, address)
    /// Converts bytes to field elements (chunking) and hashes with Poseidon
    /// This matches: poseidonHashBytes(bytes) in podMerkleUtils.ts
    public fun compute_leaf_hash_bytes(bytes: vector<u8>): vector<u8> {
        let field_elements = bytes_to_field_elements(bytes);
        let hash_u256 = poseidon::poseidon_bn254(&field_elements);
        u256_to_bytes(hash_u256)
    }

    /// Compute leaf hash for u256
    /// Converts u256 to 32-byte big-endian bytes, then to field elements and hashes
    /// This matches the u256 handling in podMerkleUtils.ts
    public fun compute_leaf_hash_u256(value: u256): vector<u8> {
        let bytes = u256_to_bytes(value);
        compute_leaf_hash_bytes(bytes)
    }

    /// Compute leaf hash for address (32-byte Sui object ID)
    /// Addresses are converted to raw 32-byte vector in big-endian format
    /// This matches Sui's native address::to_u256 convention (big-endian interpretation)
    public fun compute_leaf_hash_address(addr: address): vector<u8> {
        // Convert address to u256 (Sui native interprets as big-endian), then to bytes (big-endian)
        let addr_u256 = address::to_u256(addr);
        let addr_bytes = u256_to_bytes(addr_u256);
        compute_leaf_hash_bytes(addr_bytes)
    }

    /// Convert bytes to field elements (u256) for Poseidon hashing
    /// Chunks bytes into 31-byte segments (248 bits) to ensure each fits in BN254 field
    /// This matches the off-chain logic in podMerkleUtils.ts::bytesToFieldElements
    /// 
    /// IMPORTANT: Uses BIG-ENDIAN byte order to match Sui's native address::to_u256 convention:
    /// - First byte (index 0) is most significant
    /// - Last byte is least significant
    /// - This ensures consistency with Sui's native address conversion
    fun bytes_to_field_elements(bytes: vector<u8>): vector<u256> {
        let mut field_elements = vector::empty<u256>();
        let bytes_per_element = 31; // Safe chunk size: 31 bytes (248 bits) < BN254 field max (~254 bits)
        let mut offset = 0;
        let len = vector::length(&bytes);
        
        while (offset < len) {
            let chunk_size = if (offset + bytes_per_element <= len) {
                bytes_per_element
            } else {
                len - offset
            };
            
            // Convert chunk to u256 (BIG-ENDIAN to match Sui native convention)
            // First byte (index 0) is most significant, last byte is least significant
            let mut value: u256 = 0;
            let mut i = 0;
            while (i < chunk_size) {
                let byte_val = *vector::borrow(&bytes, offset + i) as u256;
                value = (value << 8) + byte_val; // Big-endian: shift left, then add byte
                i = i + 1;
            };
            
            vector::push_back(&mut field_elements, value);
            offset = offset + bytes_per_element;
        };
        
        field_elements
    }


    /// Convert u256 to 32-byte vector (big-endian)
    /// Matches Sui's native address::from_u256 convention which encodes as big-endian
    /// First byte is most significant, last byte is least significant
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

