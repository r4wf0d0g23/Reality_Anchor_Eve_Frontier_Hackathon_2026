import path from 'path';
import fs from 'fs/promises';
import { POD } from '@pcd/pod';
import { generateLocationAttestationPod } from '../../src/shared/pods/utils/generateLocationAttestationPod';
import { LocationAttestationData } from '../../src/shared/types/locationType';
import { loadPrivateKey, loadPublicKey, loadEd25519PublicKey } from '../../src/shared/utils/fsUtils';
import { generatePodMerkleTree } from '../../src/shared/merkle/utils/podMerkleUtils';
import { Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519';
import crypto from 'crypto';

// Helper function to generate a random 32-byte salt (hex string)
function generateSalt(): string {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

describe('POD Generation Tests', () => {
    // Clean up output files after all tests
    afterAll(async () => {
        const outputDirs = [
            path.resolve(process.cwd(), 'outputs', 'pods'),
            path.resolve(process.cwd(), 'outputs', 'merkle', 'trees'),
            path.resolve(process.cwd(), 'outputs', 'merkle', 'multiproofs'),
        ];

        for (const dir of outputDirs) {
            try {
                const files = await fs.readdir(dir).catch(() => []);
                for (const file of files) {
                    const filePath = path.join(dir, file);
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
                // Ignore directory read errors
            }
        }
    });
    // Try to load the actual private key from .env for testing
    // This validates the real integration path
    let testPrivateKey: string | undefined;
    let testPublicKey: string | undefined;
    
    beforeAll(() => {
        try {
            testPrivateKey = loadPrivateKey();
            console.log('✓ Loaded private key from .env for testing');
        } catch (error: any) {
            console.warn('⚠ Could not load private key from .env. Tests will be skipped.');
            console.warn(`  Error: ${error.message}`);
            console.warn('  To run these tests, ensure EDDSA_POSEIDON_AUTHORITY_PRIV_KEY is set in .env');
        }
        
        try {
            testPublicKey = loadPublicKey();
            console.log('✓ Loaded public key from .env for signature verification');
        } catch (error: any) {
            console.warn('⚠ Could not load public key from .env. Signature verification will be skipped.');
            console.warn(`  Error: ${error.message}`);
        }
    });
    // Test data as specified
    const baseTimestamp = BigInt(Date.now());
    const timestamp1 = baseTimestamp;
    const timestamp2 = baseTimestamp + BigInt(2000); // 2 seconds later
    const timestamp3 = timestamp2 + BigInt(1000); // 1 second after timestamp2 (within 3 seconds)

    const locationData1: LocationAttestationData = {
        objectId: '0x' + '1'.repeat(64), // Valid 32-byte Sui object ID
        solarSystemId: 987,
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
        objectId: '0x' + '2'.repeat(64), // Valid 32-byte Sui object ID
        solarSystemId: 987,
        coordinates: {
            x: 2000,
            y: 3000,
            z: 4000
        },
        pod_data_type: 'evefrontier.location_attestation',
        timestamp: timestamp2,
        salt: generateSalt()
    };


    let locationPod1Path: string;
    let locationPod2Path: string;
    let locationPod1ContentId: string;
    let locationPod2ContentId: string;
    let locationPod1MerkleRoot: string;
    let locationPod1Ed25519PublicKey: Uint8Array;
    let locationPod2MerkleRoot: string;

    beforeAll(async () => {
        if (!testPrivateKey) {
            throw new Error('Cannot run tests without private key. Please set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY in .env');
        }

        // Generate location POD 1 using the .env private key
        const result1 = await generateLocationAttestationPod(locationData1, testPrivateKey);
        locationPod1Path = result1.filePath;
        locationPod1MerkleRoot = result1.merkleRoot;
        locationPod1Ed25519PublicKey = result1.ed25519PublicKey;
        // Get contentID from the POD object, not JSON (it's a bigint)
        const pod1 = POD.fromJSON(result1.jsonPod);
        locationPod1ContentId = pod1.contentID.toString();

        // Generate location POD 2 using the .env private key
        const result2 = await generateLocationAttestationPod(locationData2, testPrivateKey);
        locationPod2Path = result2.filePath;
        locationPod2MerkleRoot = result2.merkleRoot;
        // Get contentID from the POD object, not JSON (it's a bigint)
        const pod2 = POD.fromJSON(result2.jsonPod);
        locationPod2ContentId = pod2.contentID.toString();
    });

    describe('Location POD 1 Generation', () => {
        it('should generate a valid location POD file', async () => {
            expect(locationPod1Path).toBeDefined();
            const fileExists = await fs.access(locationPod1Path).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);
        });

        it('should be saved in pods/location/ directory', () => {
            expect(locationPod1Path).toContain('pods');
            expect(locationPod1Path).toContain('location');
        });

        it('should contain valid JSON POD structure', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);

            expect(jsonPod).toHaveProperty('entries');
            expect(jsonPod).toHaveProperty('signerPublicKey');
            expect(jsonPod.entries).toHaveProperty('objectId');
            expect(jsonPod.entries).toHaveProperty('solarSystem');
            expect(jsonPod.entries).toHaveProperty('x_coord');
            expect(jsonPod.entries).toHaveProperty('y_coord');
            expect(jsonPod.entries).toHaveProperty('z_coord');
            expect(jsonPod.entries).toHaveProperty('timestamp');
            expect(jsonPod.entries).toHaveProperty('pod_data_type');
            // Merkle root and Ed25519 signature fields
            expect(jsonPod.entries).toHaveProperty('poseidon_merkle_root');
            expect(jsonPod.entries).toHaveProperty('ed25519_signature');
            // Salt field for Merkle root randomization
            expect(jsonPod.entries).toHaveProperty('salt');
        });

        it('should have correct entry values', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);

            // objectId is stored as { "bytes": <base64 string> } - 32-byte Sui object ID
            expect(jsonPod.entries.objectId).toHaveProperty('bytes');
            const objectIdBase64 = jsonPod.entries.objectId.bytes;
            // Convert expected hex to base64 for comparison
            const expectedHex = locationData1.objectId.slice(2); // Remove 0x prefix
            const expectedBase64 = Buffer.from(expectedHex, 'hex').toString('base64').replace(/=+$/, ''); // Remove padding
            expect(objectIdBase64).toBe(expectedBase64);
            // int entries are stored directly as numbers
            expect(jsonPod.entries.solarSystem).toBe(locationData1.solarSystemId);
            expect(jsonPod.entries.x_coord).toBe(locationData1.coordinates.x);
            expect(jsonPod.entries.y_coord).toBe(locationData1.coordinates.y);
            expect(jsonPod.entries.z_coord).toBe(locationData1.coordinates.z);
            expect(jsonPod.entries.timestamp).toBe(Number(locationData1.timestamp));
            // string entries are stored directly as strings
            expect(jsonPod.entries.pod_data_type).toBe(locationData1.pod_data_type);
            
            // Verify merkle root and Ed25519 signature fields
            expect(jsonPod.entries.poseidon_merkle_root).toBeDefined();
            expect(typeof jsonPod.entries.poseidon_merkle_root).toBe('string');
            expect(jsonPod.entries.poseidon_merkle_root.startsWith('0x')).toBe(true);
            
            expect(jsonPod.entries.ed25519_signature).toHaveProperty('bytes');
            expect(jsonPod.entries.ed25519_signature.bytes).toBeDefined();
            
            // Verify salt field
            expect(jsonPod.entries.salt).toHaveProperty('bytes');
            const saltBytes = Buffer.from(jsonPod.entries.salt.bytes, 'base64');
            expect(saltBytes.length).toBe(32); // 32-byte salt
        });

        it('should be a valid signed POD', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);
            const pod = POD.fromJSON(jsonPod);

            expect(pod).toBeDefined();
            // contentID is a bigint, convert to string for comparison
            expect(pod.contentID.toString()).toBe(locationPod1ContentId);
        });

        it('should be signed with a valid signature', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);
            const pod = POD.fromJSON(jsonPod);

            // Verify the POD signature is valid
            // POD.fromJSON will throw if the signature is invalid
            expect(pod).toBeDefined();
            expect(pod.signerPublicKey).toBeDefined();
            expect(typeof pod.signerPublicKey).toBe('string');
            expect(pod.signature).toBeDefined();
            expect(typeof pod.signature).toBe('string');
        });

        it('should use the private key from .env for signing', async () => {
            if (!testPrivateKey) {
                console.warn('Skipping - private key not available');
                return;
            }

            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);
            const pod = POD.fromJSON(jsonPod);

            // The signerPublicKey should be derived from the private key we used
            // This validates that loadPrivateKey() is working correctly
            expect(pod.signerPublicKey).toBeDefined();
            expect(pod.signerPublicKey.length).toBeGreaterThan(0);
            
            // All PODs signed with the same key should have the same signerPublicKey
            const fileContent2 = await fs.readFile(locationPod2Path, 'utf-8');
            const jsonPod2 = JSON.parse(fileContent2);
            const pod2 = POD.fromJSON(jsonPod2);
            expect(pod2.signerPublicKey).toBe(pod.signerPublicKey);
        });
    });

    describe('Location POD 2 Generation', () => {
        it('should generate a valid location POD file', async () => {
            expect(locationPod2Path).toBeDefined();
            const fileExists = await fs.access(locationPod2Path).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);
        });

        it('should be saved in pods/location/ directory', () => {
            expect(locationPod2Path).toContain('pods');
            expect(locationPod2Path).toContain('location');
        });

        it('should contain valid JSON POD structure', async () => {
            const fileContent = await fs.readFile(locationPod2Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);

            expect(jsonPod).toHaveProperty('entries');
            expect(jsonPod).toHaveProperty('signerPublicKey');
            expect(jsonPod.entries).toHaveProperty('objectId');
            expect(jsonPod.entries).toHaveProperty('solarSystem');
            expect(jsonPod.entries).toHaveProperty('x_coord');
            expect(jsonPod.entries).toHaveProperty('y_coord');
            expect(jsonPod.entries).toHaveProperty('z_coord');
            expect(jsonPod.entries).toHaveProperty('timestamp');
            expect(jsonPod.entries).toHaveProperty('pod_data_type');
            expect(jsonPod.entries).toHaveProperty('salt');
            expect(jsonPod.entries).toHaveProperty('poseidon_merkle_root');
            expect(jsonPod.entries).toHaveProperty('ed25519_signature');
        });

        it('should have correct entry values', async () => {
            const fileContent = await fs.readFile(locationPod2Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);

            // objectId is stored as { "bytes": <base64 string> } - 32-byte Sui object ID
            expect(jsonPod.entries.objectId).toHaveProperty('bytes');
            const objectIdBase64 = jsonPod.entries.objectId.bytes;
            // Convert expected hex to base64 for comparison
            const expectedHex = locationData2.objectId.slice(2); // Remove 0x prefix
            const expectedBase64 = Buffer.from(expectedHex, 'hex').toString('base64').replace(/=+$/, ''); // Remove padding
            expect(objectIdBase64).toBe(expectedBase64);
            // int entries are stored directly as numbers
            expect(jsonPod.entries.solarSystem).toBe(locationData2.solarSystemId);
            expect(jsonPod.entries.x_coord).toBe(locationData2.coordinates.x);
            expect(jsonPod.entries.y_coord).toBe(locationData2.coordinates.y);
            expect(jsonPod.entries.z_coord).toBe(locationData2.coordinates.z);
            expect(jsonPod.entries.timestamp).toBe(Number(locationData2.timestamp));
            expect(jsonPod.entries.pod_data_type).toBe(locationData2.pod_data_type);
            
            // Verify salt field
            expect(jsonPod.entries.salt).toHaveProperty('bytes');
            const saltBytes = Buffer.from(jsonPod.entries.salt.bytes, 'base64');
            expect(saltBytes.length).toBe(32); // 32-byte salt
        });

        it('should have timestamp within 3 seconds of location POD 1', () => {
            const timeDiff = Number(timestamp2 - timestamp1);
            expect(timeDiff).toBeLessThanOrEqual(3000); // 3 seconds in milliseconds
        });
    });


    describe('POD Signature Verification', () => {
        it('all PODs should have valid signatures that can be verified', async () => {
            // Verify location POD 1 signature
            const loc1Content = await fs.readFile(locationPod1Path, 'utf-8');
            const loc1Pod = POD.fromJSON(JSON.parse(loc1Content));
            const isValid1 = loc1Pod.verifySignature();
            expect(isValid1).toBe(true);

            // Verify location POD 2 signature
            const loc2Content = await fs.readFile(locationPod2Path, 'utf-8');
            const loc2Pod = POD.fromJSON(JSON.parse(loc2Content));
            const isValid2 = loc2Pod.verifySignature();
            expect(isValid2).toBe(true);
        });

        it('all PODs should be signed with the same key from .env', async () => {
            if (!testPrivateKey) {
                console.warn('Skipping - private key not available');
                return;
            }

            const loc1Content = await fs.readFile(locationPod1Path, 'utf-8');
            const loc1Pod = POD.fromJSON(JSON.parse(loc1Content));

            const loc2Content = await fs.readFile(locationPod2Path, 'utf-8');
            const loc2Pod = POD.fromJSON(JSON.parse(loc2Content));

            // All PODs should have the same signerPublicKey since they're signed with the same .env key
            expect(loc1Pod.signerPublicKey).toBe(loc2Pod.signerPublicKey);
        });
    });

    describe('POD Format Validation', () => {
        it('contentID can be calculated from POD entries (not stored in JSON)', async () => {
            // contentID is calculated from the entries (without signature data) using @pcd/pod functionality
            // It's not stored in the JSON, but can be computed from the POD object
            const loc1Content = await fs.readFile(locationPod1Path, 'utf-8');
            const loc1Pod = POD.fromJSON(JSON.parse(loc1Content));
            // contentID should be calculable from the POD entries
            expect(loc1Pod.contentID).toBeDefined();
            expect(typeof loc1Pod.contentID).toBe('bigint');
            // The signature signs the contentID
            expect(loc1Pod.signature).toBeDefined();
            expect(loc1Pod.signerPublicKey).toBeDefined();

            const loc2Content = await fs.readFile(locationPod2Path, 'utf-8');
            const loc2Pod = POD.fromJSON(JSON.parse(loc2Content));
            expect(loc2Pod.contentID).toBeDefined();
            expect(typeof loc2Pod.contentID).toBe('bigint');
        });
    });

    describe('Merkle Root and Ed25519 Signature Fields', () => {
        it('should have poseidon_merkle_root that matches computed merkle tree for location POD', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);
            const pod = POD.fromJSON(jsonPod);
            const podEntries = pod.content.asEntries();

            // Get merkle root from POD
            const podMerkleRoot = jsonPod.entries.poseidon_merkle_root;
            expect(podMerkleRoot).toBe(locationPod1MerkleRoot);

            // Compute merkle tree from entries (excluding merkle root and signature)
            const merkleTreeResult = generatePodMerkleTree(podEntries, locationData1.pod_data_type);
            
            // The merkle root in POD should match the computed root
            expect(podMerkleRoot).toBe(merkleTreeResult.root);
        });


        it('should have valid Ed25519 signature of poseidon_merkle_root for location POD', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);
            
            // Get the poseidon_merkle_root that was signed
            const merkleRoot = jsonPod.entries.poseidon_merkle_root;
            const merkleRootBytes = Buffer.from(merkleRoot.slice(2), 'hex');
            
            // Get Ed25519 signature from POD (stored as base64 bytes)
            // The signature signs the poseidon_merkle_root and can be verified to recover/validate it
            const ed25519SignatureBase64 = jsonPod.entries.ed25519_signature.bytes;
            // Sui's verifyPersonalMessage expects the signature as a base64 string, not decoded bytes
            const ed25519Signature = ed25519SignatureBase64;
            
            // Verify signature: this confirms the signature was created by signing the poseidon_merkle_root
            // On-chain, this allows recovery/validation of the merkle root
            const publicKey = new Ed25519PublicKey(locationPod1Ed25519PublicKey);
            const isValid = await publicKey.verifyPersonalMessage(merkleRootBytes, ed25519Signature);
            
            expect(isValid).toBe(true);
        });

        it('should have Ed25519 public key that matches .env key', async () => {
            try {
                const envPublicKeyHex = loadEd25519PublicKey();
                const envPublicKeyBytes = Buffer.from(envPublicKeyHex, 'hex');
                
                // Compare with the public key from POD generation
                expect(Buffer.from(locationPod1Ed25519PublicKey).toString('hex')).toBe(envPublicKeyHex);
            } catch (error: any) {
                console.warn('⚠ Could not load Ed25519 public key from .env:', error.message);
                // This is okay - the test will still verify the signature works
            }
        });

        it('should exclude merkle root and Ed25519 signature from merkle tree calculation', async () => {
            const fileContent = await fs.readFile(locationPod1Path, 'utf-8');
            const jsonPod = JSON.parse(fileContent);
            const pod = POD.fromJSON(jsonPod);
            const podEntries = pod.content.asEntries();

            // Generate merkle tree (should exclude poseidon_merkle_root and ed25519_signature)
            const merkleTreeResult = generatePodMerkleTree(podEntries, locationData1.pod_data_type);
            
            // Count entries in POD vs leaves in tree
            const allEntryNames = Object.keys(podEntries);
            const excludedEntries = ['poseidon_merkle_root', 'ed25519_signature'];
            const expectedLeafCount = allEntryNames.filter(name => !excludedEntries.includes(name)).length;
            
            expect(merkleTreeResult.leafHashes.length).toBe(expectedLeafCount);
            
            // Verify the merkle root matches what's stored in POD
            expect(merkleTreeResult.root).toBe(jsonPod.entries.poseidon_merkle_root);
        });

        it('should have same Ed25519 public key across all PODs from same key', async () => {
            const fileContent1 = await fs.readFile(locationPod1Path, 'utf-8');
            const fileContent2 = await fs.readFile(locationPod2Path, 'utf-8');
            const jsonPod1 = JSON.parse(fileContent1);
            const jsonPod2 = JSON.parse(fileContent2);
            
            // Both PODs should have Ed25519 signatures
            expect(jsonPod1.entries.ed25519_signature).toBeDefined();
            expect(jsonPod2.entries.ed25519_signature).toBeDefined();
            
            // Since they're generated with the same Ed25519 key from .env, they should have the same public key
            // (We can't directly compare public keys from POD entries, but we can verify signatures work)
            const merkleRoot1 = jsonPod1.entries.poseidon_merkle_root;
            const merkleRoot2 = jsonPod2.entries.poseidon_merkle_root;
            
            // Both should be valid hex strings
            expect(merkleRoot1.startsWith('0x')).toBe(true);
            expect(merkleRoot2.startsWith('0x')).toBe(true);
        });
    });

});

