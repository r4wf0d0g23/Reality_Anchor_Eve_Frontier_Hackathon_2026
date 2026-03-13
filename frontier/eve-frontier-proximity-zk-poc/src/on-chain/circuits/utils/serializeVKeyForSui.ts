/**
 * Serializes Groth16 verification keys for Sui on-chain verification.
 * 
 * This module implements arkworks' canonical compressed serialization format
 * for BN254 (bn128) elliptic curve points, matching the format expected by
 * Sui's `prepare_verifying_key` function.
 * 
 * References:
 * - https://docs.sui.io/guides/developer/cryptography/groth16
 * - https://docs.rs/ark-serialize/latest/ark_serialize/trait.CanonicalSerialize.html
 * - https://github.com/arkworks-rs/algebra/issues/708 (bit encoding details)
 */

/**
 * Serializes a verification key from snarkjs format to arkworks compressed format for Sui.
 * 
 * Sui's prepare_verifying_key expects the verification key in arkworks canonical compressed
 * serialization format. According to arkworks documentation:
 * - Serialization is in little-endian format
 * - For BN254 compressed points:
 *   - G1: 32 bytes (x coordinate in little-endian, with flags in last byte)
 *   - G2: 64 bytes (x1, x2 coordinates in little-endian, with flags in last bytes)
 * - Flags encoding (in last byte):
 *   - Bit 6 = infinity flag
 *   - Bit 7 (MSB) = sign bit (1 if y > (p-1)/2)
 * 
 * Serialization order: vk_alpha_1 || vk_beta_2 || vk_gamma_2 || vk_delta_2 || IC[0] || IC[1] || ... || IC[n]
 * 
 * @param vkeyData - The verification key data from snarkjs (parsed from vkey.json)
 * @returns Hex string of the serialized verification key (without 0x prefix)
 */
export function serializeVKeyForSui(vkeyData: any): string {
    // Validate curve (only BN254/bn128 is currently supported by Sui)
    if (vkeyData.curve !== 'bn128') {
        throw new Error(`Unsupported curve: ${vkeyData.curve}. Sui currently supports BN254 (bn128) only.`);
    }
    
    // Helper to convert BigInt/string to 32-byte buffer
    // Note: Testing both big-endian and little-endian formats
    // Arkworks documentation says "little endian format" but this may refer to multi-byte integers,
    // not necessarily field elements. Field elements in compressed format may use big-endian.
    const toBytes32BE = (value: string | bigint): Buffer => {
        const bigIntValue = typeof value === 'string' ? BigInt(value) : value;
        const hex = bigIntValue.toString(16).padStart(64, '0');
        return Buffer.from(hex, 'hex');
    };
    
    const toBytes32LE = (value: string | bigint): Buffer => {
        const buf = toBytes32BE(value);
        return Buffer.from(buf).reverse();
    };
    
    // Helper to serialize G1 point in compressed format
    // Arkworks compressed G1 format: 32 bytes (x coordinate in little-endian, with flags in last byte)
    // According to arkworks-rs/algebra#708: bit 6 = infinity flag, bit 7 (MSB) = sign bit
    // For BN254, if y > (p-1)/2, the sign bit (bit 7) is set
    // If point is at infinity, bit 6 is set
    const serializeG1Compressed = (point: [string, string, ...any[]]): Buffer => {
        // Check if point is at infinity (only [0, 1] represents infinity on BN254)
        // Note: The third element in snarkjs format is not an infinity indicator
        const x = BigInt(point[0]);
        const y = BigInt(point[1]);
        const isInfinity = x === BigInt(0) && y === BigInt(1);
        
        if (isInfinity) {
            // For infinity point, return all zeros with infinity flag set in last byte (little-endian)
            const result = Buffer.alloc(32, 0);
            result[31] = 0x40; // Set bit 6 (infinity flag)
            return result;
        }
        
        // Get x as 32-byte buffer (little-endian, as per arkworks documentation)
        // According to arkworks docs: "Serializer in little endian format"
        // The sign bit is in the MSB of the most significant byte (byte 31 in little-endian)
        const xBytes = toBytes32LE(x);
        
        // In compressed format:
        // - Bit 7 (MSB) of last byte (most significant in little-endian) = sign of y (1 if y > (p-1)/2)
        // - Bit 6 of last byte = infinity flag (0 for non-infinity points)
        const p = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
        const halfP = p / BigInt(2);
        const ySign = y > halfP ? BigInt(1) : BigInt(0);
        
        // Set flags in the last byte (byte 31) - most significant byte in little-endian
        // Clear bits 6 and 7, then set them according to flags
        const lastByte = xBytes[31];
        const signBit = ySign === BigInt(1) ? 0x80 : 0x00;
        const infinityBit = 0x00; // Not infinity
        xBytes[31] = (lastByte & 0x3F) | infinityBit | signBit; // 0x3F = 00111111 (clear bits 6 and 7)
        
        return xBytes;
    };
    
    // Helper to serialize G2 point in compressed format
    // Arkworks compressed G2 format: 64 bytes (x1, x2 coordinates in little-endian, with flags in last bytes)
    // Format: [x1 (32 bytes), x2 (32 bytes)] with flags in last bytes
    // Bit 6 = infinity flag, bit 7 (MSB) = sign bit for each coordinate
    const serializeG2Compressed = (point: [[string, string], [string, string], ...any[]]): Buffer => {
        const [x1, x2] = point[0];
        const [y1, y2] = point[1];
        
        // Check if point is at infinity (only [[0, 0], [0, 1]] represents infinity on BN254 G2)
        // Note: The third element in snarkjs format is not an infinity indicator
        const isInfinity = BigInt(x1) === BigInt(0) && BigInt(x2) === BigInt(0) &&
                          BigInt(y1) === BigInt(0) && BigInt(y2) === BigInt(1);
        
        if (isInfinity) {
            // For infinity point, return all zeros with infinity flags set in last bytes (little-endian)
            const result = Buffer.alloc(64, 0);
            result[31] = 0x40; // Set bit 6 (infinity flag) for x1
            result[63] = 0x40; // Set bit 6 (infinity flag) for x2
            return result;
        }
        
        const x1Bytes = toBytes32LE(x1);
        const x2Bytes = toBytes32LE(x2);
        
        // Set sign bits for y1 and y2
        const p = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
        const halfP = p / BigInt(2);
        
        const y1Sign = BigInt(y1) > halfP ? BigInt(1) : BigInt(0);
        const y2Sign = BigInt(y2) > halfP ? BigInt(1) : BigInt(0);
        
        // Encode flags in last bytes (most significant in little-endian):
        // - Bit 7 (MSB) = sign bit
        // - Bit 6 = infinity flag (0 for non-infinity)
        // Clear bits 6 and 7, then set sign bit
        if (y1Sign === BigInt(1)) {
            x1Bytes[31] = (x1Bytes[31] & 0x3F) | 0x80; // 0x3F = 00111111 (clear bits 6 and 7)
        } else {
            x1Bytes[31] = x1Bytes[31] & 0x3F; // Clear bits 6 and 7
        }
        if (y2Sign === BigInt(1)) {
            x2Bytes[31] = (x2Bytes[31] & 0x3F) | 0x80;
        } else {
            x2Bytes[31] = x2Bytes[31] & 0x3F;
        }
        
        return Buffer.concat([x1Bytes, x2Bytes]);
    };
    
    const output: Buffer[] = [];
    
    // Serialize vk_alpha_1 (G1 point)
    output.push(serializeG1Compressed(vkeyData.vk_alpha_1));
    
    // Serialize vk_beta_2 (G2 point)
    output.push(serializeG2Compressed(vkeyData.vk_beta_2));
    
    // Serialize vk_gamma_2 (G2 point)
    output.push(serializeG2Compressed(vkeyData.vk_gamma_2));
    
    // Serialize vk_delta_2 (G2 point)
    output.push(serializeG2Compressed(vkeyData.vk_delta_2));
    
    // Serialize IC array (G1 points for public inputs)
    if (Array.isArray(vkeyData.IC)) {
        for (const icPoint of vkeyData.IC) {
            output.push(serializeG1Compressed(icPoint));
        }
    }
    
    // Concatenate all serialized points
    const serialized = Buffer.concat(output);
    
    // Return as hex string (as expected by Sui)
    return serialized.toString('hex');
}

