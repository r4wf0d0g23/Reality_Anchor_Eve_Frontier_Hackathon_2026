import path from 'path';
import fs from 'fs/promises';
import { POD } from '@pcd/pod';
import { groth16 } from 'snarkjs';
import { generateLocationAttestationPod } from '../../src/shared/pods/utils/generateLocationAttestationPod';
import { generateDistanceAttestationPod } from '../../src/shared/pods/utils/generateDistanceAttestationPod';
import { generateLocationProof } from '../../src/off-chain/proofs/utils/generateLocationProof';
import { generateDistanceProof } from '../../src/off-chain/proofs/utils/generateDistanceProof';
import { generatePodMerkleTree } from '../../src/shared/merkle/utils/podMerkleUtils';
import { podBytesHash } from '@pcd/pod';
import { LocationAttestationData } from '../../src/shared/types/locationType';
import { DistanceAttestationData } from '../../src/shared/types/distanceType';
import { loadPrivateKey } from '../../src/shared/utils/fsUtils';
import crypto from 'crypto';

// Helper function to generate a random 32-byte salt (hex string)
function generateSalt(): string {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

describe('Proof Generation Tests', () => {
    let testPrivateKey: string | undefined;
    
    // Test data
    const baseTimestamp = BigInt(Date.now());
    const timestamp1 = baseTimestamp;
    const timestamp2 = baseTimestamp + BigInt(2000); // 2 seconds later
    const timestamp3 = timestamp2 + BigInt(1000); // 1 second after timestamp2 (within 3 seconds)

    const locationData1: LocationAttestationData = {
        objectId: '0x' + '1'.repeat(64), // 32-byte Sui object ID
        solarSystem: 987,
        coordinates: {
            x: 1000,
            y: 2000,
            z: 3000
        },
        pod_data_type: 'evefrontier.location_attestation',
        timestamp: timestamp1,
        salt: generateSalt()
    };

    const locationData2: LocationAttestationData = {
        objectId: '0x' + '2'.repeat(64), // 32-byte Sui object ID
        solarSystem: 987,
        coordinates: {
            x: 2000,
            y: 3000,
            z: 4000
        },
        pod_data_type: 'evefrontier.location_attestation',
        timestamp: timestamp2,
        salt: generateSalt()
    };

    // Track generated files for cleanup
    const generatedFiles: string[] = [];
    const generatedDirs: string[] = [];

    beforeAll(() => {
        try {
            testPrivateKey = loadPrivateKey();
            console.log('✓ Loaded private key from .env for testing');
        } catch (error: any) {
            console.warn('⚠ Could not load private key from .env. Tests will be skipped.');
            console.warn(`  Error: ${error.message}`);
        }
    });

    afterEach(async () => {
        // Terminate snarkjs workers after each test to prevent hanging
        // Note: Workers are also terminated in the proof generation functions,
        // but we do it here again to ensure complete cleanup and prevent hanging
        try {
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                await (groth16 as any).thread.terminateAll();
            }
            // Also try to terminate individual workers if they exist
            if (typeof (groth16 as any)?.thread?.terminate === 'function') {
                // Try to terminate any remaining workers
                const workers = (groth16 as any).thread?.workers || [];
                for (const worker of workers) {
                    try {
                        await (groth16 as any).thread.terminate(worker);
                    } catch (e) {
                        // Ignore - worker may already be terminated
                    }
                }
            }
            // Longer delay to ensure all worker cleanup completes
            await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
            // Ignore errors - this is best effort cleanup
            // Workers may already be terminated by the proof generation functions
        }
    });

    afterAll(async () => {
        // Final worker cleanup before file cleanup
        try {
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                await (groth16 as any).thread.terminateAll();
            }
            // Wait for cleanup to complete
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
            // Ignore - best effort
        }
        
        // Clean up all generated files and directories
        console.log('\n=== Cleaning up generated files ===');
        
        // Remove files first
        for (const file of generatedFiles) {
            try {
                // Check if file exists before trying to delete
                await fs.access(file);
                await fs.unlink(file);
                console.log(`  Deleted: ${file}`);
            } catch (error: any) {
                // Only warn if it's not a "file not found" error (ENOENT)
                if (error.code !== 'ENOENT') {
                    console.warn(`  Could not delete ${file}: ${error.message}`);
                }
            }
        }

        // Remove directories (with recursive option to handle non-empty dirs)
        const uniqueDirs = [...new Set(generatedDirs)];
        for (const dir of uniqueDirs) {
            try {
                await fs.rm(dir, { recursive: true, force: true });
                console.log(`  Removed directory: ${dir}`);
            } catch (error: any) {
                // Directory might not exist, that's okay
                if (error.code !== 'ENOENT') {
                    console.warn(`  Could not remove directory ${dir}: ${error.message}`);
                }
            }
        }
    });

    describe('Location Proof Generation', () => {
        it('should generate a valid location proof', async () => {
            if (!testPrivateKey) {
                throw new Error('Cannot run tests without private key. Please set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY in .env');
            }

            // Generate location POD
            const { jsonPod, filePath: podPath } = await generateLocationAttestationPod(locationData1, testPrivateKey);
            generatedFiles.push(podPath);
            generatedDirs.push(path.dirname(podPath));

            const pod = POD.fromJSON(jsonPod);
            expect(pod).toBeDefined();

            // Generate proof with timing
            const proofStartTime = Date.now();
            const proofResult = await generateLocationProof(pod);
            const proofEndTime = Date.now();
            const proofDurationMs = proofEndTime - proofStartTime;
            generatedFiles.push(proofResult.filePath);
            generatedDirs.push(path.dirname(proofResult.filePath));

            // Verify proof structure
            expect(proofResult.proof).toBeDefined();
            expect(proofResult.boundConfig).toBeDefined();
            expect(proofResult.revealedClaims).toBeDefined();
            expect(proofResult.publicSignals).toBeDefined();
            expect(Array.isArray(proofResult.publicSignals)).toBe(true);
            expect(proofResult.publicSignals.length).toBeGreaterThan(0);

            console.log(`  Location proof generated successfully`);
            console.log(`  ⏱️  Test measured duration: ${proofDurationMs}ms (${(proofDurationMs / 1000).toFixed(2)}s)`);
            console.log(`  Public signals count: ${proofResult.publicSignals.length}`);
            console.log(`  Revealed claims keys: ${Object.keys(proofResult.revealedClaims).join(', ')}`);
        });

        it('should generate a second location proof', async () => {
            if (!testPrivateKey) {
                throw new Error('Cannot run tests without private key. Please set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY in .env');
            }

            // Generate location POD
            const { jsonPod, filePath: podPath } = await generateLocationAttestationPod(locationData2, testPrivateKey);
            generatedFiles.push(podPath);
            generatedDirs.push(path.dirname(podPath));

            const pod = POD.fromJSON(jsonPod);
            expect(pod).toBeDefined();

            // Generate proof with timing
            const proofStartTime = Date.now();
            const proofResult = await generateLocationProof(pod);
            const proofEndTime = Date.now();
            const proofDurationMs = proofEndTime - proofStartTime;
            generatedFiles.push(proofResult.filePath);
            generatedDirs.push(path.dirname(proofResult.filePath));

            // Verify proof structure
            expect(proofResult.proof).toBeDefined();
            expect(proofResult.boundConfig).toBeDefined();
            expect(proofResult.revealedClaims).toBeDefined();
            expect(proofResult.publicSignals).toBeDefined();

            console.log(`  Second location proof generated successfully`);
            console.log(`  ⏱️  Test measured duration: ${proofDurationMs}ms (${(proofDurationMs / 1000).toFixed(2)}s)`);
        });
    });

    describe('Distance Proof Generation', () => {
        // Helper function to generate location proofs and prepare data
        async function prepareLocationProofs(locData1: LocationAttestationData, locData2: LocationAttestationData) {
            const { jsonPod: jsonPod1, filePath: podPath1 } = await generateLocationAttestationPod(locData1, testPrivateKey!);
            const { jsonPod: jsonPod2, filePath: podPath2 } = await generateLocationAttestationPod(locData2, testPrivateKey!);
            generatedFiles.push(podPath1, podPath2);
            generatedDirs.push(path.dirname(podPath1), path.dirname(podPath2));

            const pod1 = POD.fromJSON(jsonPod1);
            const pod2 = POD.fromJSON(jsonPod2);

            // Generate location proofs
            const locationProof1 = await generateLocationProof(pod1);
            const locationProof2 = await generateLocationProof(pod2);
            generatedFiles.push(locationProof1.filePath, locationProof2.filePath);
            generatedDirs.push(path.dirname(locationProof1.filePath), path.dirname(locationProof2.filePath));

            return {
                locationProofData1: {
                    proof: locationProof1.proof,
                    boundConfig: locationProof1.boundConfig,
                    revealedClaims: locationProof1.revealedClaims,
                    publicSignals: locationProof1.publicSignals,
                    pod: pod1,
                    podData: locData1,
                    contentID: pod1.contentID.toString()
                },
                locationProofData2: {
                    proof: locationProof2.proof,
                    boundConfig: locationProof2.boundConfig,
                    revealedClaims: locationProof2.revealedClaims,
                    publicSignals: locationProof2.publicSignals,
                    pod: pod2,
                    podData: locData2,
                    contentID: pod2.contentID.toString()
                }
            };
        }

        it('should generate a distance proof from two location proofs (first attempt)', async () => {
            if (!testPrivateKey) {
                throw new Error('Cannot run tests without private key. Please set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY in .env');
            }

            const { locationProofData1, locationProofData2 } = await prepareLocationProofs(locationData1, locationData2);

            // Generate distance proof with timing
            const distanceProofStartTime = Date.now();
            const distanceProofResult = await generateDistanceProof(
                locationProofData1,
                locationProofData2,
                3000 // 3 second threshold
            );
            const distanceProofEndTime = Date.now();
            const distanceProofDurationMs = distanceProofEndTime - distanceProofStartTime;
            generatedFiles.push(distanceProofResult.filePath);
            generatedFiles.push(distanceProofResult.distancePodPath);
            generatedDirs.push(path.dirname(distanceProofResult.filePath));
            generatedDirs.push(path.dirname(distanceProofResult.distancePodPath));

            // Verify proof structure
            expect(distanceProofResult.proof).toBeDefined();
            expect(distanceProofResult.boundConfig).toBeDefined();
            expect(distanceProofResult.revealedClaims).toBeDefined();
            expect(distanceProofResult.publicSignals).toBeDefined();
            expect(distanceProofResult.distancePod).toBeDefined();

            console.log(`  Distance proof #1 generated successfully`);
            console.log(`  ⏱️  Test measured duration: ${distanceProofDurationMs}ms (${(distanceProofDurationMs / 1000).toFixed(2)}s)`);
            console.log(`  Public signals count: ${distanceProofResult.publicSignals.length}`);
            console.log(`  Revealed claims keys: ${Object.keys(distanceProofResult.revealedClaims).join(', ')}`);
        });

    });
});

