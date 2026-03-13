/**
 * Move type mappings for POD entry types.
 * 
 * These mappings define how POD types should be encoded for Merkle tree generation
 * and Move/Sui on-chain verification.
 * 
 * References:
 * - Move primitive types: https://move-book.com/move-basics/primitive-types
 * - Move strings: https://move-book.com/move-basics/string
 */

export type MoveType = 
    | 'bool'
    | 'u8' | 'u16' | 'u32' | 'u64' | 'u128' | 'u256'
    | 'vector<u8>'  // For strings and bytes
    | 'address';    // For object IDs (cryptographic type used as address)

/**
 * Maps POD entry types to Move types for encoding.
 * 
 * POD boolean -> bool
 * POD int -> u64
 * POD string -> vector<u8> (bytes)
 * POD bytes -> vector<u8>
 * POD cryptographic -> u256 (constrained to BN254 field modulus ~2^254, not full 2^256)
 *                      Can be overridden to 'address' for Sui object IDs
 * POD date -> u64 (timestamp in milliseconds)
 * POD null -> handled case by case
 * 
 * Note: POD cryptographic values are constrained by BN254 field modulus:
 *       21888242871839275222246405745257275088548364400416034343698204186575808495616
 *       This is approximately 2^254.5, so values are limited to ~254 bits, not full 256 bits.
 */
export const POD_TO_MOVE_TYPE_MAP: Record<string, MoveType> = {
    'boolean': 'bool',
    'int': 'u64',
    'string': 'vector<u8>',
    'bytes': 'vector<u8>',
    'cryptographic': 'u256',  // Constrained to BN254 field modulus (~2^254), not full 2^256
    'date': 'u64',
    'eddsa_pubkey': 'vector<u8>',  // EdDSA public keys as bytes
};

/**
 * Type maps for specific POD data types.
 * These allow overriding the default POD type mappings for specific entry names.
 */
export interface PodMoveTypeMap {
    [entryName: string]: MoveType;
}

/**
 * Helper to check if a Move type is an integer that fits in a single field element.
 * These types can be hashed directly without chunking.
 * 
 * Note: We don't use BCS for hashing - we hash raw values/bytes directly.
 * BCS is only needed for serialization/deserialization, not for hashing.
 * Field identification comes from leaf index, not from hash content.
 */
export function isDirectHashIntegerType(moveType: MoveType): boolean {
    return ['bool', 'u8', 'u16', 'u32', 'u64', 'u128'].includes(moveType);
}

/**
 * Type maps organized by POD data type.
 * Allows different POD types to have different Move type mappings for the same entry names.
 */
export const MOVE_TYPE_MAPS_BY_POD_TYPE: Record<string, PodMoveTypeMap> = {
    'evefrontier.location_attestation': {
        // Note: objectId should be stored as POD 'bytes' type (not 'cryptographic') 
        // because Sui object IDs are 32 bytes (256 bits) which can exceed BN254 field modulus
        objectId: 'address',  // Sui object ID (32 bytes) - stored as POD bytes, encoded as Move address
        solarSystem: 'u64',
        x_coord: 'u64',
        y_coord: 'u64',
        z_coord: 'u64',
        timestamp: 'u64',
        pod_data_type: 'vector<u8>',
    },
    'evefrontier.distance_attestation': {
        // Note: objectId1/2 should be stored as POD 'bytes' type (not 'cryptographic')
        // because Sui object IDs are 32 bytes (256 bits) which can exceed BN254 field modulus
        objectId1: 'address',  // Sui object ID - stored as POD bytes, encoded as Move address
        objectId2: 'address',  // Sui object ID - stored as POD bytes, encoded as Move address
        objectLocation1: 'vector<u8>',  // sha256_merkle_root as bytes32
        objectLocation2: 'vector<u8>',  // sha256_merkle_root as bytes32
        distanceSquaredMeters: 'u64',
        timeThreshold: 'u64',
        timestamp: 'u64',
        pod_data_type: 'vector<u8>',
    },
};

