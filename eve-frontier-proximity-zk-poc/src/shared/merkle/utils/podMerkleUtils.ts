import { PODEntries, PODValue } from "@pcd/pod";
import { IMT } from "@zk-kit/imt";
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";
import { bcs } from '@mysten/sui/bcs';
import { MoveType, POD_TO_MOVE_TYPE_MAP, MOVE_TYPE_MAPS_BY_POD_TYPE, isDirectHashIntegerType } from '../../types/moveTypeMap';
import { convertPodValueToMoveValue } from '../../utils/podValueConverters';

export interface PodMerkleTreeResult {
    root: string;
    tree: IMT;
    leafHashes: string[];
    leafMap: Map<string, { hash: string; index: number }>; // Map entry name to leaf hash and index
}

/**
 * Converts BCS bytes to field elements for Poseidon hashing.
 * This conversion must match the logic used on-chain and in-circuit.
 * 
 * IMPORTANT: Chunking is needed to convert bytes → field elements.
 * 
 * BN254 field is ~254 bits = ~31.75 bytes per element.
 * - Small arrays (<= 31 bytes): 1 field element → poseidon1 → 1 u256 output
 * - Larger arrays: chunked into multiple field elements → poseidonN → 1 u256 output
 * 
 * NOTE: This same conversion logic must be used:
 * - Off-chain (here) for tree generation
 * - On-chain in Move: bytes → vector<u256> → poseidon_bn254(vector) → u256
 * - In-circuit in Circom: bytes → field elements → Poseidon → 1 field element output
 * 
 * IMPORTANT: Uses BIG-ENDIAN byte order to match Sui's native address::to_u256 convention:
 * - First byte (index 0) is most significant
 * - Last byte is least significant
 * - This ensures consistency with Sui's native address conversion (big-endian interpretation)
 * 
 * @returns Array of field elements (BigInt) - typically 1 element for small entries
 */
function bytesToFieldElements(bytes: Uint8Array): bigint[] {
    const fieldElements: bigint[] = [];
    const bytesPerElement = 31; // Safe chunk size: 31 bytes (248 bits) guarantees value < BN254 field max (~254.87 bits)
    
    for (let offset = 0; offset < bytes.length; offset += bytesPerElement) {
        const chunk = bytes.slice(offset, Math.min(offset + bytesPerElement, bytes.length));
        let result = 0n;
        // Big-endian: first byte (index 0) is most significant, last byte is least significant
        for (let i = 0; i < chunk.length; i++) {
            result = (result << 8n) | BigInt(chunk[i]);
        }
        fieldElements.push(result);
    }
    
    return fieldElements;
}

/**
 * Poseidon hash function for leaf hashing.
 * Takes BCS-encoded bytes, converts to field elements (same as on-chain/in-circuit), then hashes.
 * 
 * The BCS bytes are the source of truth - conversion happens here, on-chain, and in-circuit
 * using the same logic to ensure consistency.
 *  
 * Chunking is needed for bytes → field elements conversion, because we are hashing field elements not byte strings
 * 
 * Exported for use in proof generation scripts.
 */
export function poseidonHashBytes(bytes: Uint8Array): string {
    // Convert BCS bytes to field elements (same conversion as on-chain/in-circuit)
    const fieldElements = bytesToFieldElements(bytes);
    
    // Hash based on number of field elements
    // poseidon-lite supports poseidon1 through poseidon16
    let hash: bigint;
    if (fieldElements.length === 1) {
        hash = poseidon1([fieldElements[0]]);
    } else if (fieldElements.length === 2) {
        hash = poseidon2([fieldElements[0], fieldElements[1]]);
    } else if (fieldElements.length === 3) {
        hash = poseidon3([fieldElements[0], fieldElements[1], fieldElements[2]]);
    } else {
        // For more than 3 elements, dynamically require the appropriate poseidon function
        // Poseidon supports up to 16 field elements per hash (poseidon1 through poseidon16)
        // Maximum bytes per hash: 16 × 31 = 496 bytes
        // Most entries should be <= 62 bytes (2 field elements), but we support up to 16
        if (fieldElements.length > 16) {
            throw new Error(`Too many field elements: ${fieldElements.length} (max 16 for Poseidon)`);
        }
        // Dynamically import the appropriate poseidon function
        // poseidon-lite exports poseidon1 through poseidon16 as named exports
        const poseidonModule = require(`poseidon-lite/poseidon${fieldElements.length}`);
        // Access the named export (e.g., poseidonModule.poseidon4)
        const poseidonN = poseidonModule[`poseidon${fieldElements.length}`] || poseidonModule.default || poseidonModule;
        if (typeof poseidonN !== 'function') {
            throw new Error(`Failed to load poseidon${fieldElements.length} from poseidon-lite. Module keys: ${Object.keys(poseidonModule).join(', ')}`);
        }
        hash = poseidonN(fieldElements);
    }
    
    // Convert BigInt to 32-byte hex string in BIG-ENDIAN format (to match Sui's native convention)
    // Sui's address::to_u256 interprets addresses as big-endian, so we use big-endian hex
    // This ensures consistency with Sui's native behavior
    const hexStr = hash.toString(16).padStart(64, '0');
    return '0x' + hexStr;
}

/**
 * Poseidon hash function for Merkle tree nodes (parent hashing).
 * Used by @zk-kit/imt for node hashing.
 * Takes array of child hashes (as BigInt) and hashes them together.
 * 
 * For binary trees (arity=2), this receives [left, right] as BigInt values.
 * 
 * @param values Array of BigInt values (typically 2 for binary tree)
 * @returns BigInt hash result
 */
export function poseidonHashForIMT(values: (number | string | bigint)[]): bigint {
    // Convert all values to BigInt
    const bigIntValues = values.map(v => {
        if (typeof v === 'bigint') return v;
        if (typeof v === 'string') {
            return BigInt(v.startsWith('0x') ? v : '0x' + v);
        }
        return BigInt(v);
    });
    
    // For binary tree, we use poseidon2
    if (bigIntValues.length === 2) {
        return poseidon2([bigIntValues[0]!, bigIntValues[1]!]);
    }
    
    // For other arities, dynamically load the appropriate poseidon function
    if (bigIntValues.length > 16) {
        throw new Error(`Too many values for Poseidon: ${bigIntValues.length} (max 16)`);
    }
    
    if (bigIntValues.length === 1) {
        return poseidon1([bigIntValues[0]!]);
    } else if (bigIntValues.length === 3) {
        return poseidon3([bigIntValues[0]!, bigIntValues[1]!, bigIntValues[2]!]);
    } else {
        const poseidonModule = require(`poseidon-lite/poseidon${bigIntValues.length}`);
        const poseidonN = poseidonModule[`poseidon${bigIntValues.length}`] || poseidonModule.default || poseidonModule;
        if (typeof poseidonN !== 'function') {
            throw new Error(`Failed to load poseidon${bigIntValues.length} from poseidon-lite`);
        }
        return poseidonN(bigIntValues);
    }
}

/**
 * Encodes a Move value to BCS bytes based on Move type.
 * This ensures compatibility with Move/Sui on-chain verification.
 * 
 * Exported for use in proof generation scripts.
 */
export function encodeMoveValueToBCS(value: any, moveType: MoveType): Uint8Array {
    switch (moveType) {
        case 'bool':
            return bcs.Bool.serialize(value).toBytes();
        case 'u8':
            return bcs.U8.serialize(value).toBytes();
        case 'u16':
            return bcs.U16.serialize(value).toBytes();
        case 'u32':
            return bcs.U32.serialize(value).toBytes();
        case 'u64':
            return bcs.U64.serialize(value).toBytes();
        case 'u128':
            return bcs.U128.serialize(value).toBytes();
        case 'u256':
            return bcs.U256.serialize(value).toBytes();
        case 'vector<u8>':
            // For vector<u8>, value should be a hex string (0x-prefixed), regular string, or Uint8Array
            if (typeof value === 'string') {
                if (value.startsWith('0x')) {
                    // Hex string: Remove 0x prefix and convert to bytes
                    const hexStr = value.slice(2);
                    const bytes = Buffer.from(hexStr, 'hex');
                    return bcs.vector(bcs.U8).serialize(Array.from(bytes)).toBytes();
                } else {
                    // Regular string: Convert to UTF-8 bytes, then BCS encode
                    const utf8Bytes = Buffer.from(value, 'utf8');
                    return bcs.vector(bcs.U8).serialize(Array.from(utf8Bytes)).toBytes();
                }
            } else if (value instanceof Uint8Array) {
                return bcs.vector(bcs.U8).serialize(Array.from(value)).toBytes();
            } else {
                throw new Error(`vector<u8> value must be string or Uint8Array, got ${typeof value}`);
            }
        case 'address':
            // Sui addresses are 32 bytes, value should be hex string
            if (typeof value === 'string') {
                return bcs.Address.serialize(value).toBytes();
            } else {
                throw new Error(`address value must be hex string, got ${typeof value}`);
            }
        default:
            throw new Error(`Unsupported Move type for BCS encoding: ${moveType}`);
    }
}

/**
 * Calculates leaf hash for a single POD entry using Poseidon and BCS encoding.
 * This is extracted from generatePodMerkleTree for reuse in proof generation.
 * 
 * @param entryName The name of the POD entry
 * @param entryData The POD entry value
 * @param podDataType The POD data type (e.g., 'evefrontier.location_attestation')
 * @returns The Poseidon hash of the BCS-encoded entry name and value
 */
export function calculateLeafHash(
    entryName: string,
    entryData: PODValue,
    podDataType: string
): string {
    const moveTypeMap = MOVE_TYPE_MAPS_BY_POD_TYPE[podDataType] || {};
    
    // Get Move type for this entry
    let moveType: MoveType;
    if (moveTypeMap[entryName]) {
        moveType = moveTypeMap[entryName];
    } else {
        moveType = POD_TO_MOVE_TYPE_MAP[entryData.type] || 'vector<u8>';
    }
    
    // Convert POD value to Move-compatible value
    const moveValue = convertPodValueToMoveValue(entryData, moveType, entryName);
    
    // Hash raw value/bytes directly (no BCS encoding needed for hashing)
    // Field identification comes from leaf index, not from hash content
    // BCS is only needed for serialization/deserialization, not for hashing
    
    if (isDirectHashIntegerType(moveType)) {
        // Integer types that fit in field element: hash value directly
        const valueBigInt = typeof moveValue === 'boolean' 
            ? (moveValue ? BigInt(1) : BigInt(0))
            : BigInt(moveValue);
        return '0x' + poseidon1([valueBigInt]).toString(16).padStart(64, '0');
    } else if (moveType === 'u256') {
        // u256: Convert to bytes (32 bytes, big-endian), then hash with chunking
        // Matches Sui's native address::from_u256 convention which encodes as big-endian
        const valueBigInt = BigInt(moveValue);
        // Convert u256 to 32-byte big-endian bytes
        const hexStr = valueBigInt.toString(16).padStart(64, '0');
        const bytes = Buffer.from(hexStr, 'hex');
        return poseidonHashBytes(bytes);
    } else if (moveType === 'vector<u8>') {
        // Strings or bytes: BCS encode before hashing to match Move's BCS encoding
        // This ensures consistency with on-chain BCS serialization
        // Use encodeMoveValueToBCS which handles strings, hex strings, and Uint8Array
        const bcsBytes = encodeMoveValueToBCS(moveValue, 'vector<u8>');
        return poseidonHashBytes(bcsBytes);
    } else if (moveType === 'address') {
        // Address: 32 bytes, convert hex string to big-endian bytes, then hash
        // Sui's address::to_u256 interprets addresses as big-endian, so we use big-endian bytes
        let bytes: Uint8Array;
        if (typeof moveValue === 'string') {
            const hexStr = moveValue.startsWith('0x') ? moveValue.slice(2) : moveValue;
            // Convert hex string to bytes (big-endian interpretation - matches Sui native)
            bytes = new Uint8Array(Buffer.from(hexStr, 'hex'));
        } else {
            throw new Error(`address value must be hex string, got ${typeof moveValue}`);
        }
        if (bytes.length !== 32) {
            throw new Error(`address must be 32 bytes, got ${bytes.length} bytes`);
        }
        return poseidonHashBytes(bytes);
    } else {
        throw new Error(`Unsupported Move type for hashing: ${moveType}`);
    }
}

/**
 * Generates a Poseidon-based Merkle tree for POD entries.
 * 
 * The merkle root will be stored as 'poseidon_merkle_root' in the POD.
 * This entry itself is excluded from the tree calculation.
 * 
 * Uses BCS encoding for Move/Sui compatibility and Poseidon hashing for circuit efficiency.
 * 
 * @param podEntries The POD entries to build the Merkle tree from
 * @param podDataType The POD data type (e.g., 'evefrontier.location_attestation')
 * @returns An object containing the Merkle root, tree instance, and leaf hashes
 */
export function generatePodMerkleTree(
    podEntries: PODEntries,
    podDataType: string
): PodMerkleTreeResult {
    const leafHashes: string[] = [];
    
    // Get Move type map for this POD type, or use defaults
    const moveTypeMap = MOVE_TYPE_MAPS_BY_POD_TYPE[podDataType] || {};
    
    // Sort entry names for consistent tree generation
    const sortedEntryNames = Object.keys(podEntries).sort();
    
    for (const entryName of sortedEntryNames) {
        // Skip the merkle root entry itself and Ed25519 signature (they're added after tree generation)
        if (entryName === 'poseidon_merkle_root' || entryName === 'ed25519_signature') {
            continue;
        }
        
        const entryData: PODValue = podEntries[entryName];
        
        // Get Move type for this entry (from type map or default from POD type)
        let moveType: MoveType;
        if (moveTypeMap[entryName]) {
            moveType = moveTypeMap[entryName];
        } else {
            // Fall back to default mapping based on POD entry type
            moveType = POD_TO_MOVE_TYPE_MAP[entryData.type] || 'vector<u8>';
        }
        
        // Convert POD value to Move-compatible value
        const moveValue = convertPodValueToMoveValue(entryData, moveType, entryName);
        
        // Encode Move value to bytes using BCS (Binary Canonical Serialization)
        // This ensures compatibility with Move/Sui on-chain verification
        let encodedValueBytes: Uint8Array;
        try {
            encodedValueBytes = encodeMoveValueToBCS(moveValue, moveType);
        } catch (e: any) {
            throw new Error(
                `Error BCS encoding entry '${entryName}' (Move type ${moveType}, value ${String(moveValue)}): ${e.message}`
            );
        }
        
        // Create leaf hash using the shared function
        let leafHash: string;
        try {
            leafHash = calculateLeafHash(entryName, entryData, podDataType);
        } catch (e: any) {
            throw new Error(`Error creating leaf hash for entry '${entryName}': ${e.message}`);
        }
        
        leafHashes.push(leafHash);
    }
    
    if (leafHashes.length === 0) {
        const dataEntryKeys = Object.keys(podEntries).filter(
            k => k !== 'poseidon_merkle_root' && k !== 'ed25519_signature'
        );
        if (dataEntryKeys.length > 0) {
            throw new Error("Cannot generate Merkle tree: No leaf hashes were generated, but data entries exist.");
        } else {
            throw new Error("Cannot generate Merkle tree: No data entries found in podEntries (excluding merkle root entries).");
        }
    }
    
    // Calculate tree depth: depth = ceil(log2(numLeaves))
    // For 8 leaves, depth = 3 (2^3 = 8)
    const numLeaves = leafHashes.length;
    const depth = Math.ceil(Math.log2(numLeaves));
    
    // Convert leaf hashes from hex strings to BigInt for IMT
    // Leaf hashes are stored as big-endian hex strings (from poseidonHashBytes)
    // IMT works with BigInt values, so we convert hex strings directly to BigInt
    // BigInt('0x' + hexStr) interprets hex as big-endian, which matches our big-endian convention
    const leafHashesBigInt = leafHashes.map(hash => {
        const hexStr = hash.startsWith('0x') ? hash.slice(2) : hash;
        // Convert hex string to BigInt (big-endian interpretation - matches our convention)
        return BigInt('0x' + hexStr);
    });
    
    // Create IMT tree with Poseidon hashing
    // Zero value: 0 (IMT uses zero values for empty nodes)
    const zeroValue = 0n;
    const arity = 2; // Binary tree
    
    const tree = new IMT(poseidonHashForIMT, depth, zeroValue, arity, leafHashesBigInt);
    
    // Get root as big-endian hex string (matching Sui's native address::to_u256 convention)
    const rootBigInt = tree.root;
    // Convert BigInt to big-endian hex string (most significant byte first)
    const rootHex = rootBigInt.toString(16).padStart(64, '0');
    const root = '0x' + rootHex;
    
    // Create leaf map: entry name -> { hash, index }
    const leafMap = new Map<string, { hash: string; index: number }>();
    let leafIndex = 0;
    for (const entryName of sortedEntryNames) {
        if (entryName === 'poseidon_merkle_root' || entryName === 'ed25519_signature') {
            continue;
        }
        leafMap.set(entryName, {
            hash: leafHashes[leafIndex]!,
            index: leafIndex
        });
        leafIndex++;
    }
    
    return {
        root,
        tree,
        leafHashes,
        leafMap
    };
}

