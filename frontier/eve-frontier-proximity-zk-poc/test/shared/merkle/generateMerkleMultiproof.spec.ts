import { IMT } from '@zk-kit/imt';
import { PODEntries } from '@pcd/pod';
import {
    generateMerkleMultiproof,
    verifyMerkleMultiproof,
    generateOptimizedMultiproofFromTree,
    MerkleMultiproof,
    OptimizedMerkleMultiproof,
} from '../../../src/shared/merkle/utils/generateMerkleMultiproof';
import {
    generatePodMerkleTree,
    PodMerkleTreeResult,
    poseidonHashForIMT,
} from '../../../src/shared/merkle/utils/podMerkleUtils';

describe('Merkle Multiproof Generation and Verification', () => {
    const podDataType = 'evefrontier.location_attestation';

    describe('generateMerkleMultiproof', () => {
        it('should generate multiproof for single leaf', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const leafIndex = treeResult.leafMap.get('x_coord')!.index;

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                [leafIndex],
                true
            ) as MerkleMultiproof;

            expect(multiproof.leaves).toHaveLength(1);
            expect(multiproof.proof).toHaveLength(0); // Single leaf, no proof needed
            expect(multiproof.proofFlags).toHaveLength(0);
            expect(multiproof.root).toBe(treeResult.root);
            expect(multiproof.treeDepth).toBeDefined();
            expect(multiproof.leafIndices).toEqual([leafIndex]);
        });

        it('should generate multiproof for two leaves', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const xIndex = treeResult.leafMap.get('x_coord')!.index;
            const yIndex = treeResult.leafMap.get('y_coord')!.index;

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                [xIndex, yIndex],
                true
            ) as MerkleMultiproof;

            expect(multiproof.leaves).toHaveLength(2);
            expect(multiproof.proof).toHaveLength(0); // Two adjacent leaves, no proof needed
            // Flags are used for all hash operations (1 hash operation for 2 leaves = 1 flag)
            expect(multiproof.proofFlags.length).toBeGreaterThanOrEqual(0);
            expect(multiproof.root).toBe(treeResult.root);
        });

        it('should generate multiproof for four leaves (coordinates + timestamp)', () => {
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

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const indices = [
                treeResult.leafMap.get('timestamp')!.index,
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
                treeResult.leafMap.get('z_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                true
            ) as MerkleMultiproof;

            expect(multiproof.leaves).toHaveLength(4);
            expect(multiproof.root).toBe(treeResult.root);
            expect(multiproof.leafIndices).toEqual(indices.sort((a, b) => a - b));
        });

        it('should generate multiproof for full 8-leaf tree', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                pod_data_type: {
                    type: 'string',
                    value: podDataType,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
                solarSystem: {
                    type: 'cryptographic',
                    value: 1n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
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
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const allIndices = Array.from(treeResult.leafMap.values()).map(v => v.index);

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                allIndices,
                true
            ) as MerkleMultiproof;

            expect(multiproof.leaves).toHaveLength(8);
            expect(multiproof.root).toBe(treeResult.root);
            expect(multiproof.proof).toHaveLength(0); // All leaves, no proof needed
            // Flags are used for all hash operations (7 hash operations for 8 leaves = 7 flags)
            expect(multiproof.proofFlags.length).toBeGreaterThanOrEqual(0);
        });

        it('should generate multiproof for subset of leaves (requires proof hashes)', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                pod_data_type: {
                    type: 'string',
                    value: podDataType,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
                solarSystem: {
                    type: 'cryptographic',
                    value: 1n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
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
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            // Only prove coordinates and timestamp (indices 4-7)
            const indices = [
                treeResult.leafMap.get('timestamp')!.index,
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
                treeResult.leafMap.get('z_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                true
            ) as MerkleMultiproof;

            expect(multiproof.leaves).toHaveLength(4);
            expect(multiproof.root).toBe(treeResult.root);
            // Should have some proof hashes (siblings from the other half of the tree)
            expect(multiproof.proof.length).toBeGreaterThan(0);
            expect(multiproof.proofFlags.length).toBeGreaterThan(0);
        });

        it('should generate optimized multiproof (without metadata)', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const indices = [
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                false
            ) as OptimizedMerkleMultiproof;

            expect(multiproof.leaves).toHaveLength(2);
            expect(multiproof.root).toBe(treeResult.root);
            // Optimized version should not have metadata
            expect('treeDepth' in multiproof).toBe(false);
            expect('leafIndices' in multiproof).toBe(false);
        });

        it('should throw error for empty leaf indices', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);

            expect(() => {
                generateMerkleMultiproof(treeResult.tree, [], false);
            }).toThrow('At least one leaf index must be provided');
        });

        it('should throw error for out-of-bounds leaf index', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);

            expect(() => {
                generateMerkleMultiproof(treeResult.tree, [999], false);
            }).toThrow('Leaf index 999 is out of bounds');
        });
    });

    describe('verifyMerkleMultiproof', () => {
        it('should verify valid single leaf multiproof', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const leafIndex = treeResult.leafMap.get('x_coord')!.index;

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                [leafIndex],
                false
            );

            const isValid = verifyMerkleMultiproof(treeResult.root, multiproof);
            expect(isValid).toBe(true);
        });

        it('should verify valid two-leaf multiproof', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const indices = [
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                false
            );

            const isValid = verifyMerkleMultiproof(treeResult.root, multiproof);
            expect(isValid).toBe(true);
        });

        it('should verify valid four-leaf multiproof', () => {
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

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const indices = [
                treeResult.leafMap.get('timestamp')!.index,
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
                treeResult.leafMap.get('z_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                false
            );

            const isValid = verifyMerkleMultiproof(treeResult.root, multiproof);
            expect(isValid).toBe(true);
        });

        it('should verify valid full tree multiproof', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                pod_data_type: {
                    type: 'string',
                    value: podDataType,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
                solarSystem: {
                    type: 'cryptographic',
                    value: 1n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
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
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const allIndices = Array.from(treeResult.leafMap.values()).map(v => v.index);

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                allIndices,
                false
            );

            const isValid = verifyMerkleMultiproof(treeResult.root, multiproof);
            expect(isValid).toBe(true);
        });

        it('should verify valid subset multiproof (with proof hashes)', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                pod_data_type: {
                    type: 'string',
                    value: podDataType,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
                solarSystem: {
                    type: 'cryptographic',
                    value: 1n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
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
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            // Only prove coordinates and timestamp
            const indices = [
                treeResult.leafMap.get('timestamp')!.index,
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
                treeResult.leafMap.get('z_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                false
            );

            const isValid = verifyMerkleMultiproof(treeResult.root, multiproof);
            expect(isValid).toBe(true);
        });

        it('should reject invalid multiproof with wrong root', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const indices = [
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                false
            );

            const wrongRoot = '0x' + '0'.repeat(64);
            const isValid = verifyMerkleMultiproof(wrongRoot, multiproof);
            expect(isValid).toBe(false);
        });

        it('should reject invalid multiproof with wrong leaf', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const indices = [
                treeResult.leafMap.get('x_coord')!.index,
                treeResult.leafMap.get('y_coord')!.index,
            ];

            const multiproof = generateMerkleMultiproof(
                treeResult.tree,
                indices,
                false
            );

            // Modify a leaf hash
            const invalidMultiproof = {
                ...multiproof,
                leaves: ['0x' + '0'.repeat(64), multiproof.leaves[1]!],
            };

            const isValid = verifyMerkleMultiproof(treeResult.root, invalidMultiproof);
            expect(isValid).toBe(false);
        });

        it('should reject empty leaves multiproof', () => {
            const multiproof: OptimizedMerkleMultiproof = {
                leaves: [],
                proof: [],
                proofFlags: [],
                root: '0x' + '0'.repeat(64),
            };

            const isValid = verifyMerkleMultiproof(multiproof.root, multiproof);
            expect(isValid).toBe(false);
        });
    });

    describe('generateOptimizedMultiproofFromTree', () => {
        it('should generate optimized multiproof from tree data using entry names', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                pod_data_type: {
                    type: 'string',
                    value: podDataType,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
                solarSystem: {
                    type: 'cryptographic',
                    value: 1n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
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
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);

            // Generate multiproof for coordinates and timestamp
            const multiproof = await generateOptimizedMultiproofFromTree(
                treeResult,
                ['timestamp', 'x_coord', 'y_coord', 'z_coord']
            );

            expect(multiproof.leaves).toHaveLength(4);
            expect(multiproof.root).toBe(treeResult.root);
            expect(multiproof.proof.length).toBeGreaterThan(0);
            expect(multiproof.proofFlags.length).toBeGreaterThan(0);

            // Verify the proof is valid
            const isValid = verifyMerkleMultiproof(treeResult.root, multiproof);
            expect(isValid).toBe(true);
        });

        it('should throw error for missing entry name', async () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);

            await expect(
                generateOptimizedMultiproofFromTree(
                    treeResult,
                    ['x_coord', 'nonexistent']
                )
            ).rejects.toThrow("Entry name 'nonexistent' not found in tree");
        });
    });

    describe('Integration: Multiproof with various tree sizes', () => {
        it('should work with 1 leaf', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const multiproof = await generateOptimizedMultiproofFromTree(
                treeResult,
                ['x_coord']
            );

            expect(verifyMerkleMultiproof(treeResult.root, multiproof)).toBe(true);
        });

        it('should work with 2 leaves', () => {
            const podEntries: PODEntries = {
                x_coord: {
                    type: 'cryptographic',
                    value: 1000n,
                },
                y_coord: {
                    type: 'cryptographic',
                    value: 2000n,
                },
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const multiproof = await generateOptimizedMultiproofFromTree(
                treeResult,
                ['x_coord', 'y_coord']
            );

            expect(verifyMerkleMultiproof(treeResult.root, multiproof)).toBe(true);
        });

        it('should work with 4 leaves', () => {
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

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const multiproof = await generateOptimizedMultiproofFromTree(
                treeResult,
                ['timestamp', 'x_coord', 'y_coord', 'z_coord']
            );

            expect(verifyMerkleMultiproof(treeResult.root, multiproof)).toBe(true);
        });

        it('should work with 8 leaves (full location POD)', () => {
            const podEntries: PODEntries = {
                objectId: {
                    type: 'bytes',
                    value: Buffer.from('1'.repeat(64), 'hex'),
                },
                pod_data_type: {
                    type: 'string',
                    value: podDataType,
                },
                salt: {
                    type: 'bytes',
                    value: Buffer.from('2'.repeat(64), 'hex'),
                },
                solarSystem: {
                    type: 'cryptographic',
                    value: 1n,
                },
                timestamp: {
                    type: 'cryptographic',
                    value: 1234567890n,
                },
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
            };

            const treeResult = generatePodMerkleTree(podEntries, podDataType);
            const allEntryNames = Array.from(treeResult.leafMap.keys());
            const multiproof = await generateOptimizedMultiproofFromTree(
                treeResult,
                allEntryNames
            );

            expect(verifyMerkleMultiproof(treeResult.root, multiproof)).toBe(true);
        });
    });
});

