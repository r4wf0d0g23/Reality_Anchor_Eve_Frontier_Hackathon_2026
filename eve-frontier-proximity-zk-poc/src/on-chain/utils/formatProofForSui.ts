import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Formats a snarkjs Groth16 proof object into bytes for Sui verification using Rust serializer.
 * 
 * Uses the Rust proof serializer (which uses arkworks serialize_compressed) to ensure
 * exact format matching with Sui's groth16::proof_points_from_bytes.
 * 
 * The snarkjs proof format is:
 * {
 *   pi_a: [x, y],  // G1 point (strings or BigInts)
 *   pi_b: [[x1, x2], [y1, y2]],  // G2 point
 *   pi_c: [x, y]   // G1 point
 * }
 * 
 * @param proof - The snarkjs proof object
 * @returns Hex string of the serialized proof points (without 0x prefix)
 */
export function formatProofPointsForSui(proof: any): string {
    // Use Rust proof serializer for exact format matching with Sui
    const projectRoot = path.resolve(process.cwd());
    const rustSerializerPath = path.join(projectRoot, 'src/on-chain/tools/rust-vkey-serializer/target/release/proof-serializer');
    
    // Check if binary exists
    try {
        fsSync.accessSync(rustSerializerPath);
    } catch {
        throw new Error(`Rust proof serializer not found at ${rustSerializerPath}. Run 'pnpm rust:vkey-serializer:build' first.`);
    }
    
    // Serialize proof to JSON
    const proofJson = JSON.stringify({
        pi_a: proof.pi_a,
        pi_b: proof.pi_b,
        pi_c: proof.pi_c,
        protocol: proof.protocol || 'groth16',
        curve: proof.curve || 'bn128'
    });
    
    // Call Rust serializer
    const result = spawnSync(rustSerializerPath, [], {
        input: proofJson,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
    });
    
    if (result.error) {
        throw new Error(`Failed to run Rust proof serializer: ${result.error.message}`);
    }
    
    if (result.status !== 0) {
        const stderr = result.stderr?.toString() || 'Unknown error';
        throw new Error(`Rust proof serializer failed with status ${result.status}: ${stderr}`);
    }
    
    return result.stdout.toString().trim();
}

/**
 * Legacy TypeScript implementation (kept for reference, but not used).
 * Use formatProofPointsForSui() which uses Rust serializer instead.
 */
export function formatProofPointsForSuiLegacy(proof: any): string {
    // Helper to convert BigInt/string to 32-byte buffer (big-endian first)
    const toBytes32BE = (value: string | bigint): Buffer => {
        const bigIntValue = typeof value === 'string' ? BigInt(value) : value;
        const hex = bigIntValue.toString(16).padStart(64, '0');
        return Buffer.from(hex, 'hex');
    };
    
    // Helper to convert to little-endian (as arkworks expects)
    const toBytes32LE = (value: string | bigint): Buffer => {
        const buf = toBytes32BE(value);
        return Buffer.from(buf).reverse();
    };
    
    // Helper to serialize G1 point in compressed format (32 bytes)
    // Arkworks compressed G1 format: x coordinate in little-endian, with flags in last byte (byte 31)
    // Bit 6 = infinity flag, bit 7 (MSB) = sign bit (1 if y > (p-1)/2)
    // Match the exact pattern from serializeVKeyForSui for consistency
    const serializeG1Compressed = (point: [string | bigint, string | bigint]): string => {
        const x = BigInt(point[0]);
        const y = BigInt(point[1]);
        
        // Check if point is at infinity (only [0, 1] represents infinity on BN254)
        const isInfinity = x === BigInt(0) && y === BigInt(1);
        
        if (isInfinity) {
            // For infinity point, return all zeros with infinity flag set in last byte (little-endian)
            const result = Buffer.alloc(32, 0);
            result[31] = 0x40; // Set bit 6 (infinity flag)
            return result.toString('hex');
        }
        
        // Get x as 32-byte buffer in little-endian (as arkworks expects)
        const xBytes = toBytes32LE(x);
        
        // For BN254, if y > (p-1)/2, set sign bit in MSB of last byte (byte 31 in little-endian)
        const p = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
        const halfP = p / BigInt(2);
        const ySign = y > halfP ? 1 : 0;
        
        // Set flags in the last byte (byte 31) - most significant byte in little-endian
        // Clear bits 6 and 7, then set them according to flags
        const lastByte = xBytes[31];
        const signBit = ySign === 1 ? 0x80 : 0x00;
        const infinityBit = 0x00; // Not infinity
        xBytes[31] = (lastByte & 0x3F) | infinityBit | signBit; // 0x3F = 00111111 (clear bits 6 and 7)
        
        // Convert back to hex string
        return xBytes.toString('hex');
    };
    
    // Helper to serialize G2 point in compressed format (64 bytes)
    // Arkworks compressed G2 format: x1, x2 coordinates in little-endian, with flags in last bytes
    // Format: [x1 (32 bytes), x2 (32 bytes)] with flags in last bytes (bytes 31 and 63)
    // Bit 6 = infinity flag, bit 7 (MSB) = sign bit for each coordinate
    // Match the exact pattern from serializeVKeyForSui for consistency
    const serializeG2Compressed = (point: [[string | bigint, string | bigint], [string | bigint, string | bigint]]): string => {
        const [x1, x2] = point[0]; // x = [c0, c1] (real, imaginary)
        const [y1, y2] = point[1]; // y = [c0, c1] (real, imaginary)
        
        // Check if point is at infinity (only [[0, 0], [0, 1]] represents infinity on BN254 G2)
        const isInfinity = BigInt(x1) === BigInt(0) && BigInt(x2) === BigInt(0) &&
                          BigInt(y1) === BigInt(0) && BigInt(y2) === BigInt(1);
        
        if (isInfinity) {
            // For infinity point, return all zeros with infinity flags set in last bytes (little-endian)
            const result = Buffer.alloc(64, 0);
            result[31] = 0x40; // Set bit 6 (infinity flag) for x1
            result[63] = 0x40; // Set bit 6 (infinity flag) for x2
            return result.toString('hex');
        }
        
        // Get x1 and x2 as 32-byte buffers in little-endian
        const x1Bytes = toBytes32LE(x1); // c0 (real)
        const x2Bytes = toBytes32LE(x2); // c1 (imaginary)
        
        // Set sign bits for y1 and y2 separately (matching vkey serializer pattern)
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
        
        // Serialize as [x1, x2] (c0, c1) matching vkey serializer pattern
        return Buffer.concat([x1Bytes, x2Bytes]).toString('hex');
    };
    
    // Serialize proof points: pi_a || pi_b || pi_c
    const pi_a = serializeG1Compressed(proof.pi_a);
    const pi_b = serializeG2Compressed(proof.pi_b);
    const pi_c = serializeG1Compressed(proof.pi_c);
    
    return pi_a + pi_b + pi_c;
}

/**
 * Formats public signals (public inputs) for Sui verification.
 * 
 * Converts each public signal to BigInt and serializes as big-endian hex strings.
 * This format is used for Merkle proof parsing (which expects big-endian).
 * For BN254, each field element is 32 bytes.
 * 
 * @param publicSignals - Array of public signal strings (from snarkjs)
 * @returns Concatenated hex string of all serialized signals in big-endian (without 0x prefix)
 */
export function formatPublicInputsForSui(publicSignals: string[]): string {
    // Convert each public signal to BigInt and serialize as big-endian hex strings
    // This format is used for Merkle proof parsing (which expects big-endian)
    // For BN254, each field element is 32 bytes
    
    const serialized: string[] = [];
    
    for (const signal of publicSignals) {
        const value = BigInt(signal);
        // Convert to 32-byte big-endian hex string
        const hex = value.toString(16).padStart(64, '0');
        serialized.push(hex);
    }
    
    // Concatenate all serialized signals
    return serialized.join('');
}

/**
 * Converts public inputs from big-endian to little-endian for Groth16 verification.
 * 
 * Sui's public_proof_inputs_from_bytes expects little-endian format (matching arkworks).
 * This function converts the big-endian format (used for Merkle parsing) to little-endian
 * (used for Groth16 verification).
 * 
 * @param publicInputsHex - Hex string of public inputs in big-endian format (without 0x prefix)
 * @returns Hex string of public inputs in little-endian format (without 0x prefix)
 */
export function convertPublicInputsToLittleEndian(publicInputsHex: string): string {
    // Each field element is 32 bytes (64 hex characters)
    const fieldElementSize = 64;
    const converted: string[] = [];
    
    for (let i = 0; i < publicInputsHex.length; i += fieldElementSize) {
        const fieldElementHex = publicInputsHex.substring(i, i + fieldElementSize);
        // Convert to buffer (big-endian)
        const buffer = Buffer.from(fieldElementHex, 'hex');
        // Reverse to little-endian
        const littleEndianBuffer = Buffer.from(buffer).reverse();
        // Convert back to hex string
        converted.push(littleEndianBuffer.toString('hex'));
    }
    
    return converted.join('');
}

/**
 * Reads a verification key from the artifacts directory.
 * ... (existing implementation)
 */
export async function readCircuitVKey(circuitName: string): Promise<string> {
    const artifactsDir = path.resolve(process.cwd(), 'src', 'on-chain', 'circuits', 'artifacts', circuitName);
    const vkeyPath = path.join(artifactsDir, `${circuitName}_vkey.hex`);
    
    try {
        const vkeyHex = await fs.readFile(vkeyPath, 'utf-8');
        // Remove any whitespace and 0x prefix
        return vkeyHex.trim().replace(/^0x/, '').replace(/\s/g, '');
    } catch (error: any) {
        throw new Error(`Failed to read vkey from ${vkeyPath}: ${error.message}`);
    }
}

/**
 * Formats a complete proof file for on-chain verification.
 * 
 * @param proofFilePath - Path to the proof JSON file
 * @param circuitName - Name of the circuit (e.g., "location-attestation" or "distance-attestation")
 * @returns Object containing formatted proof data for Sui
 *   - publicInputsHex: big-endian format (for Merkle proof parsing)
 *   - publicInputsHexLittleEndian: little-endian format (for Groth16 verification)
 */
export async function formatProofForSui(
    proofFilePath: string,
    circuitName: string
): Promise<{
    vkeyHex: string;
    proofPointsHex: string;
    publicInputsHex: string; // big-endian (for Merkle parsing)
    publicInputsHexLittleEndian: string; // little-endian (for Groth16 verification)
}> {
    // Read proof file
    const proofData = JSON.parse(await fs.readFile(proofFilePath, 'utf-8'));
    
    // Format proof points using Rust serializer (ensures exact format matching with Sui)
    const proofPointsHex = formatProofPointsForSui(proofData.proof);
    
    // Format public inputs in big-endian (for Merkle proof parsing)
    const publicInputsHex = formatPublicInputsForSui(proofData.publicSignals);
    
    // Convert to little-endian for Groth16 verification
    const publicInputsHexLittleEndian = convertPublicInputsToLittleEndian(publicInputsHex);
    
    // Read verification key
    const vkeyHex = await readCircuitVKey(circuitName);
    
    return {
        vkeyHex,
        proofPointsHex,
        publicInputsHex, // big-endian (for Merkle parsing)
        publicInputsHexLittleEndian // little-endian (for Groth16 verification)
    };
}

