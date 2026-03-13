import { PODValue } from '@pcd/pod';
// Helper function to convert bytes/Uint8Array to hex string (replaces viem's toHex)
function toHex(bytes: Uint8Array | number[]): string {
    const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
    return '0x' + arr.map(b => b.toString(16).padStart(2, '0')).join('');
}
import { MoveType, POD_TO_MOVE_TYPE_MAP } from '../types/moveTypeMap';

// Note: This function is no longer needed - we use BCS encoding directly
// Kept for backward compatibility but should be removed if not used elsewhere

/**
 * Converts POD value to JavaScript value suitable for encoding based on Move type.
 * This is the single source of truth for POD value to Move value conversion.
 */
export function convertPodValueToMoveValue(
    entryData: PODValue,
    moveType: MoveType,
    entryName: string
): any {
    if (entryData.type === 'date') {
        if (!(entryData.value instanceof Date)) {
            throw new Error(`Entry '${entryName}' with POD type 'date' expects a Date object.`);
        }
        if (moveType !== 'u64') {
            throw new Error(`Entry '${entryName}' with POD type 'date' should map to Move type 'u64', not '${moveType}'.`);
        }
        return BigInt(entryData.value.getTime());
    } else if (entryData.type === 'null') {
        // Default values for null based on Move type
        if (moveType === 'bool') return false;
        if (moveType.startsWith('u')) return 0n;
        if (moveType === 'vector<u8>') return '0x';
        if (moveType === 'address') return '0x' + '0'.repeat(64); // Sui address: 32 bytes (64 hex chars)
        throw new Error(`Cannot map POD type 'null' for entry '${entryName}' to Move type '${moveType}'.`);
    } else if (entryData.type === 'bytes') {
        if (!(entryData.value instanceof Uint8Array)) {
            throw new Error(`Entry '${entryName}' has POD type 'bytes' but value is not Uint8Array.`);
        }
        if (moveType === 'address') {
            // POD bytes type for Sui object IDs (32 bytes) - convert to hex string for encoding
            const hexValue = toHex(entryData.value);
            if (entryData.value.length !== 32) {
                throw new Error(`Entry '${entryName}' is a Sui address (Move type 'address') but POD bytes value is not 32 bytes. Got ${entryData.value.length} bytes.`);
            }
            return hexValue;
        } else if (moveType === 'vector<u8>') {
            return toHex(entryData.value);
        } else {
            throw new Error(`Entry '${entryName}' of POD type 'bytes' should map to Move type 'vector<u8>' or 'address', not '${moveType}'.`);
        }
    } else if (entryData.type === 'string' && moveType === 'vector<u8>') {
        // Convert string to hex-encoded bytes
        return '0x' + Buffer.from(entryData.value as string, 'utf8').toString('hex');
    } else if (entryData.type === 'cryptographic' && moveType === 'u256') {
        // Cryptographic values are already BigInt
        return entryData.value as bigint;
    } else if (entryData.type === 'cryptographic' && moveType === 'vector<u8>') {
        // Convert cryptographic BigInt to hex string for vector<u8> encoding
        // This is used for contentIDs and similar values stored as cryptographic but needed as bytes
        const value = entryData.value as bigint;
        // Convert to hex string (0x-prefixed, padded to even length)
        const hexStr = value.toString(16);
        return '0x' + (hexStr.length % 2 === 0 ? hexStr : '0' + hexStr);
    } else if (entryData.type === 'int' && moveType.startsWith('u')) {
        // Convert int to BigInt for numeric Move types
        const value = entryData.value;
        if (typeof value === 'bigint') {
            return value;
        } else if (typeof value === 'number') {
            return BigInt(value);
        } else {
            return BigInt(String(value));
        }
    // Note: cryptographic type should NOT be used for Sui object IDs (address type)
    // because 32-byte object IDs can exceed BN254 field modulus. Use POD 'bytes' type instead.
    } else {
        // For other types, use the value directly
        return entryData.value;
    }
}

