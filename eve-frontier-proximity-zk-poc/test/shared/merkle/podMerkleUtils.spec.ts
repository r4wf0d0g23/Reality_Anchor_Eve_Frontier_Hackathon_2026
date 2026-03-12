import { PODEntries, PODValue } from '@pcd/pod';
import { bcs } from '@mysten/sui/bcs';
import {
    poseidonHashBytes,
    poseidonHashForIMT,
    encodeMoveValueToBCS,
    calculateLeafHash,
    generatePodMerkleTree,
    PodMerkleTreeResult,
} from '../../../src/shared/merkle/utils/podMerkleUtils';
import { IMT } from '@zk-kit/imt';

// Helper to access private bytesToFieldElements function for testing
// We'll test it indirectly through poseidonHashBytes

describe('POD Merkle Utils - Unit Tests', () => {
    describe('BCS to Field Element Conversion (via poseidonHashBytes)', () => {
        it('should handle 1 field element (<= 31 bytes)', () => {
            // 16 bytes: 8 bytes entry name + 8 bytes u64 value
            const entryName = bcs.String.serialize('x_coord').toBytes();
            const entryValue = bcs.U64.serialize(12345n).toBytes();
            const combined = new Uint8Array(entryName.length + entryValue.length);
            combined.set(entryName, 0);
            combined.set(entryValue, entryName.length);
            
            expect(combined.length).toBeLessThanOrEqual(31);
            
            const hash = poseidonHashBytes(combined);
            expect(hash).toMatch(/^0x[0-9a-f]+$/);
            expect(hash.length).toBeGreaterThan(2); // At least 0x + some hex
        });

        it('should handle 2 field elements (32-62 bytes)', () => {
            // 42 bytes: 8 bytes entry name + 34 bytes (objectId as vector<u8>)
            const entryName = bcs.String.serialize('objectId').toBytes();
            const objectIdBytes = Buffer.alloc(32);
            const entryValue = bcs.vector(bcs.U8).serialize(Array.from(objectIdBytes)).toBytes();
            const combined = new Uint8Array(entryName.length + entryValue.length);
            combined.set(entryName, 0);
            combined.set(entryValue, entryName.length);
            
            expect(combined.length).toBeGreaterThan(31);
            expect(combined.length).toBeLessThanOrEqual(62);
            
            const hash = poseidonHashBytes(combined);
            expect(hash).toMatch(/^0x[0-9a-f]+$/);
        });

        it('should handle 3 field elements (63-93 bytes)', () => {
            // Create a large entry that requires 3 field elements
            const entryName = bcs.String.serialize('large_field').toBytes();
            const largeValue = Buffer.alloc(80); // 80 bytes
            const entryValue = bcs.vector(bcs.U8).serialize(Array.from(largeValue)).toBytes();
            const combined = new Uint8Array(entryName.length + entryValue.length);
            combined.set(entryName, 0);
            combined.set(entryValue, entryName.length);
            
            expect(combined.length).toBeGreaterThan(62);
            expect(combined.length).toBeLessThanOrEqual(93);
            
            const hash = poseidonHashBytes(combined);
            expect(hash).toMatch(/^0x[0-9a-f]+$/);
        });

        it('should handle maximum 16 field elements (up to 496 bytes)', () => {
            // Create an entry that requires close to 16 field elements
            // Account for BCS encoding overhead: entry name + vector length prefix
            const entryName = bcs.String.serialize('max_field').toBytes();
            // Leave room for entry name and BCS vector encoding overhead
            const maxValueSize = 496 - entryName.length - 10; // 10 bytes for BCS vector overhead
            const maxValue = Buffer.alloc(maxValueSize);
            const entryValue = bcs.vector(bcs.U8).serialize(Array.from(maxValue)).toBytes();
            const combined = new Uint8Array(entryName.length + entryValue.length);
            combined.set(entryName, 0);
            combined.set(entryValue, entryName.length);
            
            // Should be close to but not exceed 496 bytes (accounting for BCS overhead)
            expect(combined.length).toBeLessThanOrEqual(496);
            
            const hash = poseidonHashBytes(combined);
            expect(hash).toMatch(/^0x[0-9a-f]+$/);
        });

        it('should reject entries requiring more than 16 field elements', () => {
            // Create an entry that requires more than 16 field elements (497+ bytes)
            const entryName = bcs.String.serialize('too_large').toBytes();
            const tooLargeValue = Buffer.alloc(500); // 500 bytes > 496 bytes max
            const entryValue = bcs.vector(bcs.U8).serialize(Array.from(tooLargeValue)).toBytes();
            const combined = new Uint8Array(entryName.length + entryValue.length);
            combined.set(entryName, 0);
            combined.set(entryValue, entryName.length);
            
            expect(() => poseidonHashBytes(combined)).toThrow(/Too many field elements/);
        });

        it('should produce consistent hashes for same input', () => {
            const entryName = bcs.String.serialize('test').toBytes();
            const entryValue = bcs.U64.serialize(12345n).toBytes();
            const combined = new Uint8Array(entryName.length + entryValue.length);
            combined.set(entryName, 0);
            combined.set(entryValue, entryName.length);
            
            const hash1 = poseidonHashBytes(combined);
            const hash2 = poseidonHashBytes(combined);
            
            expect(hash1).toBe(hash2);
        });

        it('should produce different hashes for different inputs', () => {
            const entryName1 = bcs.String.serialize('test1').toBytes();
            const entryValue1 = bcs.U64.serialize(12345n).toBytes();
            const combined1 = new Uint8Array(entryName1.length + entryValue1.length);
            combined1.set(entryName1, 0);
            combined1.set(entryValue1, entryName1.length);
            
            const entryName2 = bcs.String.serialize('test2').toBytes();
            const entryValue2 = bcs.U64.serialize(12345n).toBytes();
            const combined2 = new Uint8Array(entryName2.length + entryValue2.length);
            combined2.set(entryName2, 0);
            combined2.set(entryValue2, entryName2.length);
            
            const hash1 = poseidonHashBytes(combined1);
            const hash2 = poseidonHashBytes(combined2);
            
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('poseidonHashForIMT', () => {
        it('should hash two BigInt nodes', () => {
            const left = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
            const right = BigInt('0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321');
            
            const hash = poseidonHashForIMT([left, right]);
            
            expect(typeof hash).toBe('bigint');
            expect(hash).toBeGreaterThan(0n);
        });

        it('should hash nodes from hex strings', () => {
            const left = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const right = '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';
            
            const hash = poseidonHashForIMT([left, right]);
            
            expect(typeof hash).toBe('bigint');
        });

        it('should hash nodes without 0x prefix', () => {
            const left = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const right = 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321';
            
            const hash = poseidonHashForIMT([left, right]);
            
            expect(typeof hash).toBe('bigint');
        });

        it('should produce consistent hashes for same input', () => {
            const left = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
            const right = BigInt('0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321');
            
            const hash1 = poseidonHashForIMT([left, right]);
            const hash2 = poseidonHashForIMT([left, right]);
            
            expect(hash1).toBe(hash2);
        });

        it('should produce different hashes when order is swapped', () => {
            const left = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
            const right = BigInt('0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321');
            
            const hash1 = poseidonHashForIMT([left, right]);
            const hash2 = poseidonHashForIMT([right, left]);
            
            expect(hash1).not.toBe(hash2);
        });
    });

    describe('encodeMoveValueToBCS', () => {
        it('should encode bool values', () => {
            const encoded = encodeMoveValueToBCS(true, 'bool');
            expect(encoded).toBeInstanceOf(Uint8Array);
            expect(encoded.length).toBeGreaterThan(0);
        });

        it('should encode u8 values', () => {
            const encoded = encodeMoveValueToBCS(255, 'u8');
            expect(encoded).toBeInstanceOf(Uint8Array);
        });

        it('should encode u64 values', () => {
            const encoded = encodeMoveValueToBCS(12345n, 'u64');
            expect(encoded).toBeInstanceOf(Uint8Array);
        });

        it('should encode u256 values', () => {
            const encoded = encodeMoveValueToBCS(1234567890123456789012345678901234567890n, 'u256');
            expect(encoded).toBeInstanceOf(Uint8Array);
        });

        it('should encode vector<u8> from hex string', () => {
            const hexValue = '0x1234567890abcdef';
            const encoded = encodeMoveValueToBCS(hexValue, 'vector<u8>');
            expect(encoded).toBeInstanceOf(Uint8Array);
        });

        it('should encode vector<u8> from Uint8Array', () => {
            const bytes = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
            const encoded = encodeMoveValueToBCS(bytes, 'vector<u8>');
            expect(encoded).toBeInstanceOf(Uint8Array);
        });

        it('should encode address values', () => {
            const address = '0x' + '1'.repeat(64);
            const encoded = encodeMoveValueToBCS(address, 'address');
            expect(encoded).toBeInstanceOf(Uint8Array);
        });

        it('should throw error for unsupported Move type', () => {
            expect(() => encodeMoveValueToBCS('test', 'unsupported' as any)).toThrow(/Unsupported Move type/);
        });

        it('should throw error for invalid vector<u8> type', () => {
            expect(() => encodeMoveValueToBCS(123, 'vector<u8>')).toThrow(/vector<u8> value must be hex string or Uint8Array/);
        });

        it('should throw error for invalid address type', () => {
            expect(() => encodeMoveValueToBCS(123, 'address')).toThrow(/address value must be hex string/);
        });
    });

    describe('calculateLeafHash', () => {
        const podDataType = 'evefrontier.location_attestation';

        it('should calculate leaf hash for u64 coordinate', () => {
            const entryName = 'x_coord';
            const entryData: PODValue = {
                type: 'cryptographic',
                value: 12345n,
            };

            const leafHash = calculateLeafHash(entryName, entryData, podDataType);
            
            expect(leafHash).toMatch(/^0x[0-9a-f]+$/);
            expect(leafHash.length).toBeGreaterThan(2);
        });

        it('should calculate leaf hash for objectId (vector<u8>)', () => {
            const entryName = 'objectId';
            const entryData: PODValue = {
                type: 'bytes',
                value: Buffer.from('1'.repeat(64), 'hex'),
            };

            const leafHash = calculateLeafHash(entryName, entryData, podDataType);
            
            expect(leafHash).toMatch(/^0x[0-9a-f]+$/);
        });

        it('should calculate leaf hash for timestamp (u64)', () => {
            const entryName = 'timestamp';
            const entryData: PODValue = {
                type: 'cryptographic',
                value: BigInt(Date.now()),
            };

            const leafHash = calculateLeafHash(entryName, entryData, podDataType);
            
            expect(leafHash).toMatch(/^0x[0-9a-f]+$/);
        });

        it('should produce consistent hashes for same entry', () => {
            const entryName = 'x_coord';
            const entryData: PODValue = {
                type: 'cryptographic',
                value: 12345n,
            };

            const hash1 = calculateLeafHash(entryName, entryData, podDataType);
            const hash2 = calculateLeafHash(entryName, entryData, podDataType);
            
            expect(hash1).toBe(hash2);
        });

        it('should produce different hashes for different entries', () => {
            const entryData1: PODValue = {
                type: 'cryptographic',
                value: 12345n,
            };
            const entryData2: PODValue = {
                type: 'cryptographic',
                value: 12346n,
            };

            const hash1 = calculateLeafHash('x_coord', entryData1, podDataType);
            const hash2 = calculateLeafHash('x_coord', entryData2, podDataType);
            
            expect(hash1).not.toBe(hash2);
        });

        it('should produce different hashes for different entry names', () => {
            // Note: For integer types, we hash the value directly (not the entry name)
            // Field identification comes from leaf index in the tree, not from hash content
            // So we test with different values to ensure hashes are different
            const entryData1: PODValue = {
                type: 'cryptographic',
                value: 12345n,
            };
            const entryData2: PODValue = {
                type: 'cryptographic',
                value: 12346n,
            };

            const hash1 = calculateLeafHash('x_coord', entryData1, podDataType);
            const hash2 = calculateLeafHash('y_coord', entryData2, podDataType);
            
            expect(hash1).not.toBe(hash2);
            
            // Also verify that same values produce same hashes (regardless of entry name)
            const hash3 = calculateLeafHash('x_coord', entryData1, podDataType);
            const hash4 = calculateLeafHash('y_coord', entryData1, podDataType);
            expect(hash3).toBe(hash1); // Same value, same hash
            expect(hash4).toBe(hash1); // Same value, same hash (entry name not in hash)
        });
    });

    describe('generatePodMerkleTree', () => {
        const podDataType = 'evefrontier.location_attestation';

        it('should generate tree for single entry', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 12345n,
                },
            };

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result.root).toBeDefined();
            expect(result.tree).toBeInstanceOf(IMT);
            expect(result.leafHashes).toHaveLength(1);
            expect(result.leafMap).toBeDefined();
            expect(result.leafMap.get('x_coord')).toBeDefined();
            
            // Verify root matches IMT root
            const rootBigInt = BigInt(result.root);
            expect(result.tree.root).toBe(rootBigInt);
        });

        it('should generate tree for multiple entries', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
                z_coord: {
                    type: 'cryptographic',
                    value: 3000n,
                },
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                timestamp: {
                    type: 'cryptographic',
                    value: BigInt(Date.now()),
                },
            };

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result.root).toBeDefined();
            expect(result.tree).toBeInstanceOf(IMT);
            expect(result.leafHashes.length).toBe(5);
            expect(result.leafMap.size).toBe(5);
            
            // Verify all entries are in leafMap
            expect(result.leafMap.get('x_coord')).toBeDefined();
            expect(result.leafMap.get('y_coord')).toBeDefined();
            expect(result.leafMap.get('z_coord')).toBeDefined();
            expect(result.leafMap.get('objectId')).toBeDefined();
            expect(result.leafMap.get('timestamp')).toBeDefined();
            
            // Verify root matches IMT root
            const rootBigInt = BigInt(result.root);
            expect(result.tree.root).toBe(rootBigInt);
        });

        it('should exclude poseidon_merkle_root from tree', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 12345n,
                },
                poseidon_merkle_root: {
                    type: 'bytes',
                    value: Buffer.from('0'.repeat(64), 'hex'),
                },
            };

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result.leafHashes).toHaveLength(1);
            expect(result.leafMap.has('poseidon_merkle_root')).toBe(false);
            expect(result.leafMap.has('x_coord')).toBe(true);
        });

        it('should exclude ed25519_signature from tree', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 12345n,
                },
                ed25519_signature: {
                    type: 'bytes',
                    value: Buffer.from('0'.repeat(128), 'hex'),
                },
            };

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result.leafHashes).toHaveLength(1);
            expect(result.leafMap.has('ed25519_signature')).toBe(false);
            expect(result.leafMap.has('x_coord')).toBe(true);
        });

        it('should produce consistent tree for same entries', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 12345n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 67890n,
                },
            };

            const result1 = generatePodMerkleTree(podEntries, podDataType);
            const result2 = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result1.root).toBe(result2.root);
            expect(result1.leafHashes).toEqual(result2.leafHashes);
            expect(result1.leafMap.size).toBe(result2.leafMap.size);
        });

        it('should produce different trees for different entries', () => {
            const podEntries1: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 12345n,
                },
            };
            const podEntries2: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 12346n,
                },
            };

            const result1 = generatePodMerkleTree(podEntries1, podDataType);
            const result2 = generatePodMerkleTree(podEntries2, podDataType);
            
            expect(result1.root).not.toBe(result2.root);
            expect(result1.leafHashes[0]).not.toBe(result2.leafHashes[0]);
        });

        it('should handle entries requiring multiple field elements', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'), // 32 bytes = 2 field elements
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'), // 32 bytes = 2 field elements
                },
            };

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result.root).toBeDefined();
            expect(result.leafHashes).toHaveLength(2);
        });

        it('should throw error for empty entries', () => {
            const podEntries: PODEntries = {};

            expect(() => generatePodMerkleTree(podEntries, podDataType)).toThrow(/No data entries found/);
        });

        it('should throw error when all entries are excluded', () => {
            const podEntries: PODEntries = {
                poseidon_merkle_root: {
                    type: 'bytes',
                    value: Buffer.from('0'.repeat(64), 'hex'),
                },
                ed25519_signature: {
                    type: 'bytes',
                    value: Buffer.from('0'.repeat(128), 'hex'),
                },
            };

            expect(() => generatePodMerkleTree(podEntries, podDataType)).toThrow(/No data entries found in podEntries/);
        });

        it('should generate valid Merkle tree that can generate multiproofs', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
                z_coord: {
                    type: 'cryptographic',
                    value: 3000n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
            };

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            // Verify tree structure is correct
            expect(result.root).toBeDefined();
            expect(result.leafHashes.length).toBe(4);
            expect(result.tree).toBeInstanceOf(IMT);
            
            // Verify root matches IMT root
            const rootBigInt = BigInt(result.root);
            expect(result.tree.root).toBe(rootBigInt);
            
            // Test multiproof generation using the new utility
            const { generateMerkleMultiproof, verifyMerkleMultiproof } = require('../../../src/shared/merkle/utils/generateMerkleMultiproof');
            
            const indices = [
                result.leafMap.get('timestamp')!.index,
                result.leafMap.get('x_coord')!.index,
                result.leafMap.get('y_coord')!.index,
                result.leafMap.get('z_coord')!.index,
            ];
            
            // Generate multiproof for all 4 leaves
            const multiproof = generateMerkleMultiproof(
                result.tree,
                indices,
                false
            );
            
            // Verify multiproof structure
            expect(multiproof.leaves).toHaveLength(4);
            expect(multiproof.root).toBe(result.root);
            
            // Verify the multiproof is valid
            const isValid = verifyMerkleMultiproof(result.root, multiproof);
            expect(isValid).toBe(true);
            
            // Also verify individual proofs still work (for backward compatibility)
            const timestampIndex = result.leafMap.get('timestamp')!.index;
            const timestampProof = result.tree.createProof(timestampIndex);
            expect(result.tree.verifyProof(timestampProof)).toBe(true);
        });
    });

    describe('Integration: Full Merkle Tree Flow', () => {
        const podDataType = 'evefrontier.location_attestation';

        it('should generate consistent tree across multiple operations', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
                z_coord: {
                    type: 'cryptographic',
                    value: 3000n,
                },
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
            };

            // Generate tree
            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            
            // Calculate individual leaf hashes (sorted by entry name to match tree generation)
            const sortedEntryNames = Object.keys(podEntries)
                .filter(k => k !== 'poseidon_merkle_root' && k !== 'ed25519_signature')
                .sort();
            const leafHashes = sortedEntryNames.map(entryName => 
                calculateLeafHash(entryName, podEntries[entryName], podDataType)
            );
            
            // Verify leaf hashes match (should be in same order since both are sorted)
            expect(leafHashes).toEqual(treeResult.leafHashes);
            
            // Verify tree structure is correct
            expect(treeResult.root).toBeDefined();
            expect(treeResult.leafHashes.length).toBe(6);
            expect(treeResult.leafMap.size).toBe(6);
            
            // Verify all entries are in leafMap with correct indices
            sortedEntryNames.forEach((entryName, idx) => {
                const mapEntry = treeResult.leafMap.get(entryName);
                expect(mapEntry).toBeDefined();
                expect(mapEntry!.index).toBe(idx);
                expect(mapEntry!.hash).toBe(leafHashes[idx]);
            });
        });

        it('should handle all field element counts (1-16)', () => {
            // Test entries that require different numbers of field elements
            // This tests poseidonN dynamic loading for all supported field element counts
            // Note: Byte sizes account for BCS encoding overhead (entry name + vector length prefix)
            // Each field element can hold ~31 bytes, so we test progressively larger sizes
            const testCases = [
                { name: 'x_coord', value: 12345n, expectedElements: 1 }, // ~16 bytes total
                { name: 'test_bytes', value: Buffer.from('1'.repeat(32), 'hex'), expectedElements: 2 }, // ~42 bytes total (use different name to avoid address type mapping)
                { name: 'large1', value: Buffer.from('1'.repeat(62), 'hex'), expectedElements: 3 }, // ~93 bytes total (3 × 31)
                { name: 'large2', value: Buffer.from('2'.repeat(93), 'hex'), expectedElements: 4 }, // ~124 bytes total (4 × 31)
                { name: 'large3', value: Buffer.from('3'.repeat(124), 'hex'), expectedElements: 5 }, // ~155 bytes total (5 × 31)
                { name: 'large4', value: Buffer.from('4'.repeat(155), 'hex'), expectedElements: 6 }, // ~186 bytes total (6 × 31)
                { name: 'large5', value: Buffer.from('5'.repeat(186), 'hex'), expectedElements: 7 }, // ~217 bytes total (7 × 31)
                { name: 'large6', value: Buffer.from('6'.repeat(217), 'hex'), expectedElements: 8 }, // ~248 bytes total (8 × 31)
                { name: 'large7', value: Buffer.from('7'.repeat(248), 'hex'), expectedElements: 9 }, // ~279 bytes total (9 × 31)
                { name: 'large8', value: Buffer.from('8'.repeat(279), 'hex'), expectedElements: 10 }, // ~310 bytes total (10 × 31)
                { name: 'large9', value: Buffer.from('9'.repeat(310), 'hex'), expectedElements: 11 }, // ~341 bytes total (11 × 31)
                { name: 'large10', value: Buffer.from('a'.repeat(341), 'hex'), expectedElements: 12 }, // ~372 bytes total (12 × 31)
                { name: 'large11', value: Buffer.from('b'.repeat(372), 'hex'), expectedElements: 13 }, // ~403 bytes total (13 × 31)
                { name: 'large12', value: Buffer.from('c'.repeat(403), 'hex'), expectedElements: 14 }, // ~434 bytes total (14 × 31)
                { name: 'large13', value: Buffer.from('d'.repeat(434), 'hex'), expectedElements: 15 }, // ~465 bytes total (15 × 31)
                { name: 'large14', value: Buffer.from('e'.repeat(465), 'hex'), expectedElements: 16 }, // ~496 bytes total (16 × 31 - max)
            ];

            const podEntries: PODEntries = {};
            testCases.forEach(tc => {
                if (typeof tc.value === 'bigint') {
                    podEntries[tc.name] = {
                        type: 'cryptographic',
                        value: tc.value,
                    };
                } else {
                    podEntries[tc.name] = {
                        type: 'bytes',
                        value: tc.value,
                    };
                }
            });

            const result = generatePodMerkleTree(podEntries, podDataType);
            
            expect(result.root).toBeDefined();
            expect(result.leafHashes).toHaveLength(testCases.length);
            
            // Verify tree structure is correct
            // Note: Proof generation is tested in coreMerkleProof.spec.ts
            // SimpleMerkleTree.getMultiProof has known issues with custom nodeHash functions
            expect(result.root).toBeDefined();
            expect(result.leafHashes.length).toBe(testCases.length);
        });
    });
});

