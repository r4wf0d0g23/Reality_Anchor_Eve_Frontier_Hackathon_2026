import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { POD } from '@pcd/pod';
import { groth16 } from 'snarkjs';
import { generateLocationAttestationPod } from '../../../src/shared/pods/utils/generateLocationAttestationPod';
import { generateLocationProof } from '../../../src/on-chain/proofs/utils/generateLocationProof';
import { generateDistanceProof } from '../../../src/on-chain/proofs/utils/generateDistanceProof';
import { poseidon4 } from 'poseidon-lite';
import { LocationAttestationData } from '../../../src/shared/types/locationType';
import { DistanceAttestationData } from '../../../src/shared/types/distanceType';
import { loadPrivateKey } from '../../../src/shared/utils/fsUtils';
import crypto from 'crypto';

// Helper function to generate a random 32-byte salt (hex string)
function generateSalt(): string {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

// BN254 field modulus
const BN254_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

function hexToFieldElement(hexString: string): bigint {
    const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
    const value = BigInt('0x' + hex);
    return value % BN254_FIELD_MODULUS;
}

describe('On-Chain Proof Generation Tests', () => {
    let testPrivateKey: string | undefined;
    
    // Expected proof directories
    const locationProofsDir = path.resolve(process.cwd(), 'outputs', 'proofs', 'on-chain', 'location-attestation');
    const distanceProofsDir = path.resolve(process.cwd(), 'outputs', 'proofs', 'on-chain', 'distance-attestation');
    
    // Circuit artifacts directories
    const locationArtifactsDir = path.resolve(process.cwd(), 'src', 'on-chain', 'circuits', 'artifacts', 'location-attestation');
    const distanceArtifactsDir = path.resolve(process.cwd(), 'src', 'on-chain', 'circuits', 'artifacts', 'distance-attestation');
    
    beforeAll(async () => {
        // Load test private key - required for tests
        // If missing, provide clear instructions
        try {
            testPrivateKey = loadPrivateKey();
            console.log('✓ Loaded private key from .env for testing');
        } catch (error: any) {
            const errorMsg = `Cannot run tests without EDDSA_POSEIDON_AUTHORITY_PRIV_KEY.\n` +
                `  Error: ${error.message}\n` +
                `  To fix this, run: pnpm generate-auth-key\n` +
                `  Or manually set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY in your .env file.`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
        
        // Verify circuit artifacts exist
        const locationWasm = path.join(locationArtifactsDir, 'location-attestation.wasm');
        const locationZkey = path.join(locationArtifactsDir, 'location-attestation_final.zkey');
        const distanceWasm = path.join(distanceArtifactsDir, 'distance-attestation.wasm');
        const distanceZkey = path.join(distanceArtifactsDir, 'distance-attestation_final.zkey');
        
        try {
            await fs.access(locationWasm);
            await fs.access(locationZkey);
            await fs.access(distanceWasm);
            await fs.access(distanceZkey);
        } catch (error) {
            throw new Error(
                'Circuit artifacts not found. Please run "pnpm circuit:compile:on-chain" first.\n' +
                `Expected:\n` +
                `  ${locationWasm}\n` +
                `  ${locationZkey}\n` +
                `  ${distanceWasm}\n` +
                `  ${distanceZkey}`
            );
        }
    });

    afterAll(async () => {
        // Clean up all output files created during tests
        const outputDirs = [
            path.resolve(process.cwd(), 'outputs', 'pods'),
            path.resolve(process.cwd(), 'outputs', 'merkle', 'trees'),
            path.resolve(process.cwd(), 'outputs', 'merkle', 'multiproofs'),
            locationProofsDir,
            distanceProofsDir,
        ];

        // Clean up all output directories
        for (const dir of outputDirs) {
            await cleanupDirectory(dir);
        }

        // Clean up snarkjs workers
        try {
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                await (groth16 as any).thread.terminateAll();
            }
        } catch (error) {
            // Ignore termination errors
        }

        // Clean up any lingering move-analyzer processes spawned by tests
        // Note: We skip move-analyzer processes that are children of Cursor IDE
        // as those are legitimate language server processes
        try {
            execSync('ps aux | grep "move-analyzer" | grep -v grep | grep -v "Cursor" | awk \'{print $2}\' | xargs -r kill -9 2>/dev/null || true', { stdio: 'ignore' });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    // Helper function to recursively remove directory contents
    async function cleanupDirectory(dirPath: string): Promise<void> {
        try {
            const files = await fs.readdir(dirPath);
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                try {
                    const stat = await fs.stat(filePath);
                    if (stat.isFile()) {
                        await fs.unlink(filePath);
                    } else if (stat.isDirectory()) {
                        await fs.rm(filePath, { recursive: true, force: true });
                    }
                } catch (error) {
                    // Ignore individual file errors
                }
            }
        } catch (error) {
            // Ignore directory read errors (directory might not exist)
        }
    }

    describe('Location Proof Generation', () => {
        it('should generate a valid location proof and save it to the correct directory', async () => {
            const locationData: LocationAttestationData = {
                objectId: '0x' + '1'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 1000,
                    y: 2000,
                    z: 3000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            // Generate POD
            const { jsonPod, merkleRoot } = await generateLocationAttestationPod(locationData, testPrivateKey);
            const pod = POD.fromJSON(jsonPod);

            // Generate proof (timing is measured internally, only for groth16.fullProve)
            const proofResult = await generateLocationProof(pod, locationData);
            const proofDurationMs = proofResult.proofGenerationTimeMs;

            // Verify proof file exists
            expect(proofResult.filePath).toBeDefined();
            const fileStats = await fs.stat(proofResult.filePath);
            expect(fileStats.isFile()).toBe(true);
            expect(proofResult.filePath).toContain('location-attestation');
            expect(proofResult.filePath).toContain(locationProofsDir);

            // Verify input file exists
            expect(proofResult.inputFilePath).toBeDefined();
            const inputStats = await fs.stat(proofResult.inputFilePath);
            expect(inputStats.isFile()).toBe(true);

            // Verify proof structure
            expect(proofResult.proof).toBeDefined();
            expect(proofResult.proof.pi_a).toBeDefined();
            expect(proofResult.proof.pi_b).toBeDefined();
            expect(proofResult.proof.pi_c).toBeDefined();
            expect(Array.isArray(proofResult.publicSignals)).toBe(true);
            expect(proofResult.publicSignals.length).toBe(3); // 3 public inputs (merkleRoot, coordinatesHash, signatureAndKeyHash)

            // Verify public signals match expected values
            // Public signals order: [merkleRoot, coordinatesHash, signatureAndKeyHash]
            const [merkleRootSignal, coordinatesHashSignal, signatureAndKeyHashSignal] = proofResult.publicSignals;
            
            // Merkle root should match
            expect(BigInt(merkleRootSignal).toString()).toBe(BigInt(merkleRoot).toString());
            
            // Note: Timestamp is verified in Merkle proof but not a public output
            
            // Coordinates hash should be correct
            const saltFieldElement = hexToFieldElement(locationData.salt);
            const expectedCoordinatesHash = poseidon4([
                BigInt(locationData.coordinates.x),
                BigInt(locationData.coordinates.y),
                BigInt(locationData.coordinates.z),
                saltFieldElement
            ]).toString();
            expect(coordinatesHashSignal).toBe(expectedCoordinatesHash);

            // Verify proof can be verified using snarkjs
            const wasmPath = path.join(locationArtifactsDir, 'location-attestation.wasm');
            const vkeyPath = path.join(locationArtifactsDir, 'location-attestation_vkey.json');
            
            const vkey = JSON.parse(await fs.readFile(vkeyPath, 'utf-8'));
            const verified = await groth16.verify(vkey, proofResult.publicSignals, proofResult.proof);
            expect(verified).toBe(true);

            console.log(`  ⏱️  Location proof generation duration: ${proofDurationMs}ms (${(proofDurationMs / 1000).toFixed(2)}s)`);

            // Cleanup handled in afterAll
        });

        it('should handle large u64 coordinates correctly', async () => {
            const locationData: LocationAttestationData = {
                objectId: '0x' + '2'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 1000000000,
                    y: 2000000000,
                    z: 3000000000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod } = await generateLocationAttestationPod(locationData, testPrivateKey);
            const pod = POD.fromJSON(jsonPod);

            // Generate proof (timing is measured internally, only for groth16.fullProve)
            const proofResult = await generateLocationProof(pod, locationData);
            const proofDurationMs = proofResult.proofGenerationTimeMs;

            // Verify proof structure
            expect(proofResult.proof).toBeDefined();
            expect(proofResult.publicSignals.length).toBe(3);

            // Verify proof
            const vkeyPath = path.join(locationArtifactsDir, 'location-attestation_vkey.json');
            const vkey = JSON.parse(await fs.readFile(vkeyPath, 'utf-8'));
            const verified = await groth16.verify(vkey, proofResult.publicSignals, proofResult.proof);
            expect(verified).toBe(true);

            console.log(`  ⏱️  Location proof generation duration: ${proofDurationMs}ms (${(proofDurationMs / 1000).toFixed(2)}s)`);

            // Cleanup handled in afterAll
        });

        it('should save proof files with correct naming convention', async () => {
            const locationData: LocationAttestationData = {
                objectId: '0x' + '3'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 5000,
                    y: 6000,
                    z: 7000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod } = await generateLocationAttestationPod(locationData, testPrivateKey);
            const pod = POD.fromJSON(jsonPod);

            const customFileName = 'test_location_proof.json';
            // Generate proof (timing is measured internally, only for groth16.fullProve)
            const proofResult = await generateLocationProof(pod, locationData, customFileName);
            const proofDurationMs = proofResult.proofGenerationTimeMs;

            // Verify custom filename is used
            expect(proofResult.filePath).toContain(customFileName);
            expect(proofResult.inputFilePath).toContain(customFileName.replace('.json', '_input.json'));

            console.log(`  ⏱️  Location proof generation duration: ${proofDurationMs}ms (${(proofDurationMs / 1000).toFixed(2)}s)`);

            // Cleanup handled in afterAll
        });
    });

    describe('Distance Proof Generation', () => {
        it('should generate a valid distance proof and save it to the correct directory', async () => {
            // Generate two location PODs
            const locationData1: LocationAttestationData = {
                objectId: '0x' + '4'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 1000,
                    y: 2000,
                    z: 3000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const locationData2: LocationAttestationData = {
                objectId: '0x' + '5'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 2000,
                    y: 3000,
                    z: 4000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod: locationPod1Json, merkleRoot: locationMerkleRoot1 } = await generateLocationAttestationPod(locationData1, testPrivateKey);
            const { jsonPod: locationPod2Json, merkleRoot: locationMerkleRoot2 } = await generateLocationAttestationPod(locationData2, testPrivateKey);
            
            const locationPod1 = POD.fromJSON(locationPod1Json);
            const locationPod2 = POD.fromJSON(locationPod2Json);

            // Generate location proofs to get coordinates hashes (timing is measured internally)
            const locationProof1 = await generateLocationProof(locationPod1, locationData1);
            const locationProof1DurationMs = locationProof1.proofGenerationTimeMs;

            const locationProof2 = await generateLocationProof(locationPod2, locationData2);
            const locationProof2DurationMs = locationProof2.proofGenerationTimeMs;

            // Public signals order: [merkleRoot, coordinatesHash, signatureAndKeyHash]
            const coordinatesHash1 = locationProof1.publicSignals[1]; // Second public signal is coordinatesHash
            const coordinatesHash2 = locationProof2.publicSignals[1];

            // Calculate Manhattan distance
            const dx = Math.abs(locationData1.coordinates.x - locationData2.coordinates.x);
            const dy = Math.abs(locationData1.coordinates.y - locationData2.coordinates.y);
            const dz = Math.abs(locationData1.coordinates.z - locationData2.coordinates.z);
            const distance = dx + dy + dz;
            const distanceSquared = BigInt(distance * distance);

            // Generate distance data (no POD needed for circuit)
            const distanceData: DistanceAttestationData = {
                objectId1: locationData1.objectId,
                objectId2: locationData2.objectId,
                objectLocation1: locationMerkleRoot1,
                objectLocation2: locationMerkleRoot2,
                distanceSquaredMeters: distanceSquared,
                pod_data_type: 'evefrontier.distance_attestation',
                timestamp: BigInt(Date.now()) // Not used in circuit, but kept for data structure
            };

            // Generate distance proof (timing is measured internally, only for groth16.fullProve)
            // No distance POD needed - circuit uses location proof data directly
            const distanceProofResult = await generateDistanceProof(
                distanceData,
                locationData1,
                locationData2,
                locationProof1,
                locationProof2,
                locationMerkleRoot1,
                locationMerkleRoot2,
                coordinatesHash1,
                coordinatesHash2
            );
            const distanceProofDurationMs = distanceProofResult.proofGenerationTimeMs;

            // Verify proof file exists
            expect(distanceProofResult.filePath).toBeDefined();
            const fileStats = await fs.stat(distanceProofResult.filePath);
            expect(fileStats.isFile()).toBe(true);
            expect(distanceProofResult.filePath).toContain('distance-attestation');
            expect(distanceProofResult.filePath).toContain(distanceProofsDir);

            // Verify input file exists
            expect(distanceProofResult.inputFilePath).toBeDefined();
            const inputStats = await fs.stat(distanceProofResult.inputFilePath);
            expect(inputStats.isFile()).toBe(true);

            // Verify proof structure
            expect(distanceProofResult.proof).toBeDefined();
            expect(distanceProofResult.proof.pi_a).toBeDefined();
            expect(distanceProofResult.proof.pi_b).toBeDefined();
            expect(distanceProofResult.proof.pi_c).toBeDefined();
            expect(Array.isArray(distanceProofResult.publicSignals)).toBe(true);
            expect(distanceProofResult.publicSignals.length).toBe(6); // 5 public inputs + 1 public output (maxTimestamp)

            // Verify public signals
            // Public signals: [locationMerkleRoot1, locationMerkleRoot2, coordinatesHash1, coordinatesHash2, distanceSquaredMeters, maxTimestamp]
            // Distance proof public signals order: [maxTimestamp (output), locationMerkleRoot1, locationMerkleRoot2, coordinatesHash1, coordinatesHash2, distanceSquaredMeters]
            // In Groth16, public outputs appear before public inputs
            const [
                maxTimestamp,
                locMerkleRoot1,
                locMerkleRoot2,
                coordsHash1,
                coordsHash2,
                distSquared
            ] = distanceProofResult.publicSignals;

            expect(BigInt(locMerkleRoot1).toString()).toBe(BigInt(locationMerkleRoot1).toString());
            expect(BigInt(locMerkleRoot2).toString()).toBe(BigInt(locationMerkleRoot2).toString());
            expect(coordsHash1).toBe(coordinatesHash1);
            expect(coordsHash2).toBe(coordinatesHash2);
            expect(BigInt(distSquared).toString()).toBe(distanceSquared.toString());
            
            // maxTimestamp should be the maximum of the two location timestamps
            const expectedMaxTimestamp = locationData1.timestamp > locationData2.timestamp 
                ? locationData1.timestamp 
                : locationData2.timestamp;
            expect(BigInt(maxTimestamp).toString()).toBe(expectedMaxTimestamp.toString());

            // Verify proof can be verified using snarkjs
            const vkeyPath = path.join(distanceArtifactsDir, 'distance-attestation_vkey.json');
            const vkey = JSON.parse(await fs.readFile(vkeyPath, 'utf-8'));
            const verified = await groth16.verify(vkey, distanceProofResult.publicSignals, distanceProofResult.proof);
            expect(verified).toBe(true);

            // Clean up
            await fs.unlink(distanceProofResult.filePath).catch(() => {});
            await fs.unlink(distanceProofResult.inputFilePath).catch(() => {});
            await fs.unlink(locationProof1.filePath).catch(() => {});
            await fs.unlink(locationProof1.inputFilePath).catch(() => {});
            await fs.unlink(locationProof2.filePath).catch(() => {});
            await fs.unlink(locationProof2.inputFilePath).catch(() => {});
        });

        it('should handle large u64 coordinates in distance calculation', async () => {
            const locationData1: LocationAttestationData = {
                objectId: '0x' + '6'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 1000000,
                    y: 2000000,
                    z: 3000000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const locationData2: LocationAttestationData = {
                objectId: '0x' + '7'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 2000000,
                    y: 3000000,
                    z: 4000000
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod: locationPod1Json, merkleRoot: locationMerkleRoot1 } = await generateLocationAttestationPod(locationData1, testPrivateKey);
            const { jsonPod: locationPod2Json, merkleRoot: locationMerkleRoot2 } = await generateLocationAttestationPod(locationData2, testPrivateKey);
            
            const locationPod1 = POD.fromJSON(locationPod1Json);
            const locationPod2 = POD.fromJSON(locationPod2Json);

            // Generate location proofs (timing is measured internally)
            const locationProof1 = await generateLocationProof(locationPod1, locationData1);
            const locationProof1DurationMs = locationProof1.proofGenerationTimeMs;

            const locationProof2 = await generateLocationProof(locationPod2, locationData2);
            const locationProof2DurationMs = locationProof2.proofGenerationTimeMs;

            const coordinatesHash1 = locationProof1.publicSignals[1];
            const coordinatesHash2 = locationProof2.publicSignals[1];

            const dx = Math.abs(locationData1.coordinates.x - locationData2.coordinates.x);
            const dy = Math.abs(locationData1.coordinates.y - locationData2.coordinates.y);
            const dz = Math.abs(locationData1.coordinates.z - locationData2.coordinates.z);
            const distance = dx + dy + dz;
            const distanceSquared = BigInt(distance * distance);

            // Generate distance data (no POD needed for circuit)
            const distanceData: DistanceAttestationData = {
                objectId1: locationData1.objectId,
                objectId2: locationData2.objectId,
                objectLocation1: locationMerkleRoot1,
                objectLocation2: locationMerkleRoot2,
                distanceSquaredMeters: distanceSquared,
                pod_data_type: 'evefrontier.distance_attestation',
                timestamp: BigInt(Date.now()) // Not used in circuit, but kept for data structure
            };

            // Generate distance proof (timing is measured internally, only for groth16.fullProve)
            // No distance POD needed - circuit uses location proof data directly
            const distanceProofResult = await generateDistanceProof(
                distanceData,
                locationData1,
                locationData2,
                locationProof1,
                locationProof2,
                locationMerkleRoot1,
                locationMerkleRoot2,
                coordinatesHash1,
                coordinatesHash2
            );
            const distanceProofDurationMs = distanceProofResult.proofGenerationTimeMs;

            // Verify proof
            const vkeyPath = path.join(distanceArtifactsDir, 'distance-attestation_vkey.json');
            const vkey = JSON.parse(await fs.readFile(vkeyPath, 'utf-8'));
            const verified = await groth16.verify(vkey, distanceProofResult.publicSignals, distanceProofResult.proof);
            expect(verified).toBe(true);

            console.log(`  ⏱️  Location proof 1 generation duration: ${locationProof1DurationMs}ms (${(locationProof1DurationMs / 1000).toFixed(2)}s)`);
            console.log(`  ⏱️  Location proof 2 generation duration: ${locationProof2DurationMs}ms (${(locationProof2DurationMs / 1000).toFixed(2)}s)`);
            console.log(`  ⏱️  Distance proof generation duration: ${distanceProofDurationMs}ms (${(distanceProofDurationMs / 1000).toFixed(2)}s)`);
            console.log(`  ⏱️  Total duration (2 location + 1 distance): ${locationProof1DurationMs + locationProof2DurationMs + distanceProofDurationMs}ms (${((locationProof1DurationMs + locationProof2DurationMs + distanceProofDurationMs) / 1000).toFixed(2)}s)`);

            // Clean up
            await fs.unlink(distanceProofResult.filePath).catch(() => {});
            await fs.unlink(distanceProofResult.inputFilePath).catch(() => {});
            await fs.unlink(locationProof1.filePath).catch(() => {});
            await fs.unlink(locationProof1.inputFilePath).catch(() => {});
            await fs.unlink(locationProof2.filePath).catch(() => {});
            await fs.unlink(locationProof2.inputFilePath).catch(() => {});
        });
    });

    describe('Proof File Structure', () => {
        it('should save proof files with correct JSON structure', async () => {
            const locationData: LocationAttestationData = {
                objectId: '0x' + '8'.repeat(64),
                solarSystem: 987,
                coordinates: {
                    x: 100,
                    y: 200,
                    z: 300
                },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod } = await generateLocationAttestationPod(locationData, testPrivateKey);
            const pod = POD.fromJSON(jsonPod);

            // Generate proof (timing is measured internally, only for groth16.fullProve)
            const proofResult = await generateLocationProof(pod, locationData);
            const proofDurationMs = proofResult.proofGenerationTimeMs;

            // Read and verify proof file structure
            const proofFileContent = JSON.parse(await fs.readFile(proofResult.filePath, 'utf-8'));
            expect(proofFileContent).toHaveProperty('proof');
            expect(proofFileContent).toHaveProperty('publicSignals');
            expect(proofFileContent).toHaveProperty('inputs');
            
            expect(proofFileContent.proof).toHaveProperty('pi_a');
            expect(proofFileContent.proof).toHaveProperty('pi_b');
            expect(proofFileContent.proof).toHaveProperty('pi_c');
            
            expect(Array.isArray(proofFileContent.publicSignals)).toBe(true);
            expect(proofFileContent.inputs).toHaveProperty('merkleRoot');
            expect(proofFileContent.inputs).toHaveProperty('coordinatesHash');
            expect(proofFileContent.inputs).toHaveProperty('timestampWitness'); // Private input, not public output
            expect(proofFileContent.inputs).toHaveProperty('signatureAndKeyHash');

            console.log(`  ⏱️  Location proof generation duration: ${proofDurationMs}ms (${(proofDurationMs / 1000).toFixed(2)}s)`);

            // Cleanup handled in afterAll
        });
    });
});

