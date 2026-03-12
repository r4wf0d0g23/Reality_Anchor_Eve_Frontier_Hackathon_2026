/**
 * Script to generate Move test data from existing proof files
 * This creates a Move module with valid proof data for unit tests
 * 
 * Usage: pnpm move:test:generate:proof
 * 
 * This script follows the same pattern as the integration tests:
 * 1. Generate location POD
 * 2. Generate Merkle tree
 * 3. Generate location ZK proof
 * 4. Generate multiproof for objectId and pod_data_type
 * 5. Format all data for Move tests
 */

import fs from 'fs/promises';
import path from 'path';
import { formatProofForSui } from '../src/on-chain/utils/formatProofForSui';
import { formatMerkleProofDataForSui } from '../src/on-chain/utils/formatMerkleProofForSui';
import { POD } from '@pcd/pod';
import { generateLocationAttestationPod } from '../src/shared/pods/utils/generateLocationAttestationPod';
import { generateLocationProof } from '../src/on-chain/proofs/utils/generateLocationProof';
import { generatePodMerkleTree } from '../src/shared/merkle/utils/podMerkleUtils';
import { generateOptimizedMultiproofFromTree } from '../src/shared/merkle/utils/generateMerkleMultiproof';
import { loadPrivateKey, loadEd25519PrivateKey } from '../src/shared/utils/fsUtils';
import { LocationAttestationData } from '../src/shared/types/locationType';
import { serializeVKeyForSui } from './serializeVKeyForSui';
import { deriveObjectID } from '@mysten/sui/utils';
import crypto from 'crypto';

/**
 * Converts hex string to Move vector<u8> format
 */
function hexToMoveBytes(hex: string): string {
    const cleanHex = hex.replace(/^0x/, '').replace(/\s/g, '').toLowerCase();
    // Validate hex string
    if (!/^[0-9a-f]*$/.test(cleanHex)) {
        throw new Error(`Invalid hex string: ${hex}`);
    }
    // Ensure even length
    const paddedHex = cleanHex.length % 2 === 0 ? cleanHex : '0' + cleanHex;
    const bytes: string[] = [];
    for (let i = 0; i < paddedHex.length; i += 2) {
        const byte = paddedHex.substring(i, i + 2);
        bytes.push(`0x${byte}`);
    }
    return `vector[${bytes.join(', ')}]`;
}

/**
 * Converts hex string to Move hex literal format (x"...")
 */
function hexToMoveHexLiteral(hex: string): string {
    const cleanHex = hex.replace(/^0x/, '').replace(/\s/g, '');
    return `x"${cleanHex}"`;
}

// Helper function to generate a random 32-byte salt (hex string)
function generateSalt(): string {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

/**
 * Generates Move test data module by generating a complete location POD and proof
 * This follows the exact same pattern as the integration tests
 */
/**
 * Generate proof data for a single item_id
 */
async function generateProofDataForItemId(
    itemId: number,
    testRegistryId: string,
    testPrivateKey: string,
    ed25519PrivateKey: string
): Promise<{
    objectId: string;
    formatted: any;
    formattedMerkleProof: any;
    ed25519SignatureHex: string;
    ed25519PublicKeyHex: string;
    locationData: LocationAttestationData;
}> {
    // Compute deterministic object ID using the same algorithm as Move's derived_object::derive_address
    // deriveObjectID expects the key type (e.g., 'u64'), not the full DerivedObjectKey<u64> type
    // It internally wraps it as: 0x2::derived_object::DerivedObjectKey<u64>
    const keyTypeTag = 'u64'; // Just the key type, not the full DerivedObjectKey wrapper
    const keyBytes = new Uint8Array(8);
    const view = new DataView(keyBytes.buffer);
    view.setBigUint64(0, BigInt(itemId), true); // true = little-endian (BCS encoding)
    
    const testObjectId = deriveObjectID(testRegistryId, keyTypeTag, keyBytes);
    
    const locationData: LocationAttestationData = {
        objectId: testObjectId,
        solarSystem: 987,
        coordinates: { x: 1000, y: 2000, z: 3000 },
        pod_data_type: 'evefrontier.location_attestation',
        timestamp: BigInt(Date.now()),
        salt: generateSalt()
    };
    
    const { jsonPod, filePath: podFilePath, ed25519PublicKey } = await generateLocationAttestationPod(locationData, testPrivateKey, ed25519PrivateKey);
    
    const locationPod = POD.fromJSON(jsonPod);
    const podEntries = locationPod.content.asEntries();
    
    // Extract Ed25519 signature and public key
    // IMPORTANT: We need the Ed25519 signature that signs the Merkle root (stored in POD entry 'ed25519_signature'),
    // NOT the POD signature (EDDSA-Poseidon) which is in locationPod.signature
    // The Ed25519 public key comes from the return value of generateLocationAttestationPod
    let ed25519SignatureHex = '';
    let ed25519PublicKeyHex = '';
    
    // Extract Ed25519 signature from POD entry (this signs the Merkle root)
    // Note: POD bytes are stored as base64 in JSON, so we need to handle both Uint8Array and base64 string
    const ed25519SigEntry = podEntries['ed25519_signature'];
    if (ed25519SigEntry && ed25519SigEntry.type === 'bytes') {
        const sigValue = ed25519SigEntry.value;
        let sigBytes: Uint8Array;
        
        if (sigValue instanceof Uint8Array) {
            // Already a Uint8Array
            sigBytes = sigValue;
        } else if (typeof sigValue === 'string') {
            // Base64 encoded string (common when POD is loaded from JSON)
            try {
                sigBytes = new Uint8Array(Buffer.from(sigValue, 'base64'));
            } catch (e) {
                throw new Error(`Failed to decode ed25519_signature from base64: ${e}`);
            }
        } else if (Array.isArray(sigValue)) {
            // Array of numbers (alternative representation)
            sigBytes = new Uint8Array(sigValue);
        } else {
            throw new Error(`Unexpected type for ed25519_signature value: ${typeof sigValue}`);
        }
        
        // Sui's signPersonalMessage returns 97 bytes: flag (1 byte) || signature (64 bytes) || public key (32 bytes)
        // Format: [flag][signature 64 bytes][public key 32 bytes] = 97 bytes total
        // Extract bytes 1-64 (skip flag byte, take signature)
        if (sigBytes.length === 97) {
            // Sui's standard format: extract bytes 1-64 (skip flag byte)
            sigBytes = sigBytes.slice(1, 65);
        } else if (sigBytes.length === 64) {
            // Already just the signature - use as-is (was already extracted when stored in POD)
        } else if (sigBytes.length > 64) {
            // Unexpected length - try bytes 1-64 (assuming first byte is flag)
            sigBytes = sigBytes.slice(1, 65);
        } else {
            throw new Error(`Ed25519 signature should be at least 64 bytes, got ${sigBytes.length} bytes`);
        }
        
        // Final validation
        if (sigBytes.length !== 64) {
            throw new Error(`Ed25519 signature must be exactly 64 bytes after extraction, got ${sigBytes.length} bytes`);
        }
        
        ed25519SignatureHex = Buffer.from(sigBytes).toString('hex');
    } else {
        throw new Error('Missing ed25519_signature entry in POD');
    }
    
    // Extract Ed25519 public key from return value (Uint8Array from generateLocationAttestationPod)
    if (ed25519PublicKey) {
        ed25519PublicKeyHex = Buffer.from(ed25519PublicKey).toString('hex');
    } else {
        throw new Error('Missing ed25519PublicKey from generateLocationAttestationPod return value');
    }
    
    // Validate lengths
    if (ed25519SignatureHex.length !== 128) { // 64 bytes = 128 hex chars
        throw new Error(`Ed25519 signature should be 64 bytes (128 hex chars), got ${ed25519SignatureHex.length / 2} bytes`);
    }
    if (ed25519PublicKeyHex.length !== 64) { // 32 bytes = 64 hex chars
        throw new Error(`Ed25519 public key should be 32 bytes (64 hex chars), got ${ed25519PublicKeyHex.length / 2} bytes`);
    }
    
    // Validate final hex strings
    if (ed25519SignatureHex && !/^[0-9a-fA-F]*$/.test(ed25519SignatureHex)) {
        throw new Error(`Invalid signature hex: ${ed25519SignatureHex}`);
    }
    if (ed25519PublicKeyHex && !/^[0-9a-fA-F]*$/.test(ed25519PublicKeyHex)) {
        throw new Error(`Invalid public key hex: ${ed25519PublicKeyHex}`);
    }
    
    const treeResult = generatePodMerkleTree(podEntries, locationData.pod_data_type);
    
    // Ensure vkey.hex is properly formatted using rust serializer BEFORE generating proof
    const artifactsDir = path.resolve(process.cwd(), 'src', 'on-chain', 'circuits', 'artifacts', 'location-attestation');
    const vkeyJsonPath = path.join(artifactsDir, 'location-attestation_vkey.json');
    const vkeyHexPath = path.join(artifactsDir, 'location-attestation_vkey.hex');
    
    try {
        await fs.access(vkeyJsonPath);
        await serializeVKeyForSui(vkeyJsonPath, vkeyHexPath);
    } catch {
        // Use existing vkey.hex if regeneration fails
    }
    
    const proofResult = await generateLocationProof(locationPod, locationData, undefined, ed25519PublicKey);
    const formatted = await formatProofForSui(proofResult.filePath, 'location-attestation');
    
    const multiproofFilePath = path.join(process.cwd(), 'outputs', 'merkle', 'multiproofs', `${locationData.timestamp}_${locationData.objectId}_multiproof.json`);
    
    let multiproof;
    try {
        const { loadOptimizedMultiproofFromFile } = await import('../src/shared/merkle/utils/generateMerkleMultiproof');
        multiproof = await loadOptimizedMultiproofFromFile(multiproofFilePath);
    } catch {
        multiproof = await generateOptimizedMultiproofFromTree(treeResult, ['objectId', 'pod_data_type'], multiproofFilePath);
    }
    
    const formattedMerkleProof = formatMerkleProofDataForSui(multiproof, multiproof.root);
    
    return {
        objectId: testObjectId,
        formatted,
        formattedMerkleProof,
        ed25519SignatureHex,
        ed25519PublicKeyHex,
        locationData
    };
}

async function generateMoveTestDataModule(): Promise<void> {
    // Load keys
    let testPrivateKey: string;
    let ed25519PrivateKey: string;
    try {
        testPrivateKey = loadPrivateKey();
        ed25519PrivateKey = loadEd25519PrivateKey();
    } catch (error: any) {
        throw new Error(`Could not load private keys: ${error.message}. Please run 'pnpm generate-auth-key' and 'pnpm generate-ed25519-key' to generate the required keys, or set EDDSA_POSEIDON_AUTHORITY_PRIV_KEY and ED25519_PRIVATE_KEY in .env`);
    }
    
    // Registry ID from test_scenario (deterministic - same every test run)
    // This is the ID that test_scenario creates for the first object (ObjectRegistry) in the first transaction
    // Obtained from debug output: [debug] 0x2::object::ID { bytes: @0x34401905bebdf8c04f3cd5f04f442a39372c8dc321c29edfb4f9cb30b23ab96 }
    const testRegistryId = '0x34401905bebdf8c04f3cd5f04f442a39372c8dc321c29edfb4f9cb30b23ab96';
    
    const proofData1 = await generateProofDataForItemId(0x111111, testRegistryId, testPrivateKey, ed25519PrivateKey);
    const proofData2 = await generateProofDataForItemId(0x111112, testRegistryId, testPrivateKey, ed25519PrivateKey);
    const proofData3 = await generateProofDataForItemId(0x222222, testRegistryId, testPrivateKey, ed25519PrivateKey);
    
    // Use proofData1 as the primary (for most tests)
    const { objectId, formatted, formattedMerkleProof, ed25519SignatureHex, ed25519PublicKeyHex, locationData } = proofData1;
    // 
    // IMPORTANT: The registry ID in test_scenario is created deterministically but we need to
    // compute it. In test_scenario::begin(@0x1), the first object created gets a deterministic ID.
    // The registry is created first via object_registry::init_for_testing, which calls sui_object::new(ctx).
    // 
    // The object ID created by sui_object::new in test_scenario is deterministic based on:
    // - Transaction sender (@0x1)
    // - Transaction number (0 for first transaction)
    // - Object creation order (registry is first object)
    //
    // We can compute this using the same algorithm that test_scenario uses internally.
    // For test_scenario::begin(@0x1), first transaction, first object:
    // The ID is computed from: sender=@0x1, tx_number=0, object_index=0
    //
    // However, since this is complex, we'll use a known test registry ID that matches
    // what test_scenario creates. This can be obtained by running a test and logging the registry ID.
    //
    // For now, we'll compute it: test_scenario creates IDs using tx_context::new_from_hint
    // which uses a deterministic algorithm. The first object in the first transaction
    // with sender @0x1 will have a predictable ID.
    //
    // Actually, the simplest approach is to use the test_scenario's deterministic ID generation.
    // In test_scenario, the first object created in the first transaction gets ID based on:
    // hash(sender || tx_number || object_counter)
    //
    // For test_scenario::begin(@0x1), tx 0, first object (registry):
    // We need to match what test_scenario creates. Let's use a computed value.
    //
    // NOTE: The actual registry ID will be computed when the test runs. For proof generation,
    // we need to either:
    // 1. Run a test first to get the registry ID, then regenerate proofs
    // 2. Use a fixed registry ID that we know test_scenario will create
    //
    // For now, let's compute the deterministic registry ID that test_scenario creates.
    // test_scenario::begin(@0x1) creates a context, and the first sui_object::new(ctx) call
    // creates an object with a deterministic ID based on the context state.
    //
    // The registry ID in test_scenario for sender @0x1, first tx, first object is:
    // This is computed by Sui's object ID generation, which uses the transaction context.
    // We can't easily predict it without running the test, so we'll need to either:
    // - Run the test once to get the registry ID, then use it here
    // - Or accept the registry ID as a parameter to this script
    //
    // Extract objectId hex (remove 0x prefix)
    const objectIdHex = objectId.replace('0x', '');
    const objectId2Hex = proofData2.objectId.replace('0x', '');
    const objectId3Hex = proofData3.objectId.replace('0x', '');
    
    // Extract timestamps
    const timestamp1 = proofData1.locationData.timestamp;
    const timestamp3 = proofData3.locationData.timestamp;
    
    // Generate Move module with helper functions for test proof data
    const moveModule = `#[test_only]
module world::test_proof_data {
    use world::location_attestation;
    use world::merkle_verify;
    
    /// Valid verification key bytes for location-attestation circuit
    /// Generated from complete POD and proof generation
    public fun get_valid_vkey_bytes(): vector<u8> {
        ${hexToMoveBytes(formatted.vkeyHex)}
    }
    
    /// Valid proof points bytes from a real location proof
    /// Generated from complete POD and proof generation
    public fun get_valid_proof_points_bytes(): vector<u8> {
        ${hexToMoveBytes(formatted.proofPointsHex)}
    }
    
    /// Valid public inputs bytes from a real location proof
    /// Public signals: [merkleRoot, coordinatesHash, signatureAndKeyHash]
    /// Generated from complete POD and proof generation
    /// NOTE: Public inputs are in little-endian format (for Groth16 verification)
    /// The Move code will convert to big-endian for Merkle parsing if needed
    public fun get_valid_public_inputs_bytes(): vector<u8> {
        ${hexToMoveBytes(formatted.publicInputsHexLittleEndian)}
    }
    
    /// Valid public inputs bytes in big-endian format (for Merkle proof parsing)
    /// This is the same data as get_valid_public_inputs_bytes() but in big-endian format
    /// Use this for Merkle verification, use get_valid_public_inputs_bytes() for Groth16 verification
    public fun get_valid_public_inputs_bytes_big_endian(): vector<u8> {
        ${hexToMoveBytes(formatted.publicInputsHex)}
    }
    
    /// Object ID from the proof (matches the proof data)
    public fun get_object_id(): address {
        @0x${objectIdHex}
    }
    
    /// Ed25519 signature bytes (64 bytes) matching the proof
    public fun get_ed25519_signature(): vector<u8> {
        ${ed25519SignatureHex ? hexToMoveBytes(ed25519SignatureHex) : 'vector::empty<u8>()'}
    }
    
    /// Ed25519 public key bytes (32 bytes) matching the proof
    public fun get_ed25519_public_key(): vector<u8> {
        ${ed25519PublicKeyHex ? hexToMoveBytes(ed25519PublicKeyHex) : 'vector::empty<u8>()'}
    }
    
    /// Timestamp from the proof
    public fun get_timestamp(): u64 {
        ${locationData.timestamp.toString()}u64
    }
    
    /// Merkle proof matching the proof's merkle root
    /// Generated for objectId and pod_data_type leaves
    public fun get_merkle_proof(): merkle_verify::MerkleMultiProof {
        let (leaves, proof_hashes, proof_flags) = get_merkle_proof_components();
        merkle_verify::create_multiproof(leaves, proof_hashes, proof_flags)
    }
    
    /// Get raw merkle proof components
    /// NOTE: Multiproof leaves/proof are little-endian hex strings from bigIntToLittleEndianHex
    /// bigIntToLittleEndianHex converts BigInt → little-endian bytes → hex string
    /// Move's x"..." interprets hex as big-endian, producing the same bytes
    /// Move's bytes_to_u256 interprets bytes as little-endian, producing the original BigInt value
    /// So no reversal is needed - the conversion is already correct
    public fun get_merkle_proof_components(): (vector<vector<u8>>, vector<vector<u8>>, vector<bool>) {
        let leaves = vector[
            ${formattedMerkleProof.leaves.map(l => {
                // No reversal needed - bigIntToLittleEndianHex already produces the correct format
                return hexToMoveBytes(l);
            }).join(',\n            ')}
        ];
        let proof_hashes = vector[
            ${formattedMerkleProof.proof.map(h => {
                // No reversal needed - bigIntToLittleEndianHex already produces the correct format
                return hexToMoveBytes(h);
            }).join(',\n            ')}
        ];
        let proof_flags = vector[${formattedMerkleProof.proofFlags.map(f => f ? 'true' : 'false').join(', ')}];
        (leaves, proof_hashes, proof_flags)
    }
    
    /// Create LocationAttestationData matching the proof
    /// This data matches the ZK proof and will pass verification
    public fun create_matching_location_attestation_data(): location_attestation::LocationAttestationData {
        location_attestation::create_location_attestation_data(
            get_object_id(),
            get_ed25519_public_key(),
            get_ed25519_signature(),
            get_merkle_proof(),
            get_timestamp()
        )
    }
    
    // ===== Helper functions for item_id = 0x111112 (for inventory transfer test) =====
    
    /// Object ID for item_id = 0x111112 (second object in inventory transfer test)
    public fun get_object_id_2(): address {
        @0x${objectId2Hex}
    }
    
    /// Ed25519 signature bytes (64 bytes) for item_id = 0x111112
    /// This signature signs the Merkle root for the second object
    public fun get_ed25519_signature_2(): vector<u8> {
        ${proofData2.ed25519SignatureHex ? hexToMoveBytes(proofData2.ed25519SignatureHex) : 'vector::empty<u8>()'}
    }
    
    /// Ed25519 public key bytes (32 bytes) for item_id = 0x111112
    /// Note: This should be the same as get_ed25519_public_key() since both proofs use the same keypair
    public fun get_ed25519_public_key_2(): vector<u8> {
        ${proofData2.ed25519PublicKeyHex ? hexToMoveBytes(proofData2.ed25519PublicKeyHex) : 'vector::empty<u8>()'}
    }
    
    /// Merkle proof components for item_id = 0x111112
    public fun get_merkle_proof_components_2(): (vector<vector<u8>>, vector<vector<u8>>, vector<bool>) {
        let leaves = vector[
            ${proofData2.formattedMerkleProof.leaves.map(l => {
                return hexToMoveBytes(l);
            }).join(',\n            ')}
        ];
        let proof_hashes = vector[
            ${proofData2.formattedMerkleProof.proof.map(h => {
                return hexToMoveBytes(h);
            }).join(',\n            ')}
        ];
        let proof_flags = vector[${proofData2.formattedMerkleProof.proofFlags.map(f => f ? 'true' : 'false').join(', ')}];
        (leaves, proof_hashes, proof_flags)
    }
    
    /// Public inputs bytes for item_id = 0x111112
    public fun get_valid_public_inputs_bytes_2(): vector<u8> {
        ${hexToMoveBytes(proofData2.formatted.publicInputsHexLittleEndian)}
    }
    
    // ===== Helper functions for item_id = 0x222222 (for dynamic objects) =====
    
    /// Object ID for item_id = 0x222222 (dynamic objects)
    public fun get_object_id_3(): address {
        @0x${objectId3Hex}
    }
    
    /// Ed25519 signature bytes (64 bytes) for item_id = 0x222222
    /// This signature signs the Merkle root for the third object
    public fun get_ed25519_signature_3(): vector<u8> {
        ${proofData3.ed25519SignatureHex ? hexToMoveBytes(proofData3.ed25519SignatureHex) : 'vector::empty<u8>()'}
    }
    
    /// Ed25519 public key bytes (32 bytes) for item_id = 0x222222
    /// Note: This should be the same as get_ed25519_public_key() since all proofs use the same keypair
    public fun get_ed25519_public_key_3(): vector<u8> {
        ${proofData3.ed25519PublicKeyHex ? hexToMoveBytes(proofData3.ed25519PublicKeyHex) : 'vector::empty<u8>()'}
    }
    
    /// Merkle proof components for item_id = 0x222222
    public fun get_merkle_proof_components_3(): (vector<vector<u8>>, vector<vector<u8>>, vector<bool>) {
        let leaves = vector[
            ${proofData3.formattedMerkleProof.leaves.map(l => {
                return hexToMoveBytes(l);
            }).join(',\n            ')}
        ];
        let proof_hashes = vector[
            ${proofData3.formattedMerkleProof.proof.map(h => {
                return hexToMoveBytes(h);
            }).join(',\n            ')}
        ];
        let proof_flags = vector[${proofData3.formattedMerkleProof.proofFlags.map(f => f ? 'true' : 'false').join(', ')}];
        (leaves, proof_hashes, proof_flags)
    }
    
    /// Proof points bytes for item_id = 0x222222
    /// Generated from complete POD and proof generation for the third object
    public fun get_valid_proof_points_bytes_3(): vector<u8> {
        ${hexToMoveBytes(proofData3.formatted.proofPointsHex)}
    }
    
    /// Public inputs bytes for item_id = 0x222222
    public fun get_valid_public_inputs_bytes_3(): vector<u8> {
        ${hexToMoveBytes(proofData3.formatted.publicInputsHexLittleEndian)}
    }
    
    /// Timestamp for item_id = 0x222222 (dynamic objects)
    public fun get_timestamp_3(): u64 {
        ${timestamp3.toString()}u64
    }
}
`;
    
    // Write to tests directory
    const outputPath = path.resolve(process.cwd(), 'move', 'world', 'tests', 'test_proof_data.move');
    await fs.writeFile(outputPath, moveModule, 'utf-8');
    console.log(`✓ Generated Move test data module: ${outputPath}`);
    console.log(`  - Public inputs: ${formatted.publicInputsHex.length / 2} bytes`);
    console.log(`  - Object ID: 0x${objectIdHex}`);
    console.log(`  - Timestamp: ${locationData.timestamp}`);
    console.log(`  - Merkle proof leaves: ${formattedMerkleProof.leaves.length}`);
    console.log(`  - Merkle proof hashes: ${formattedMerkleProof.proof.length}`);
    console.log(`\n✓ All test data generated successfully!`);
    console.log(`  Run 'pnpm move:test' to test with real ZK verification.`);
}

// Run the script with cleanup
generateMoveTestDataModule()
    .then(() => {
        // Cleanup snarkjs workers if they exist
        try {
            const groth16 = require('snarkjs');
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                const cleanupPromise = (groth16 as any).thread.terminateAll();
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Cleanup timeout')), 1000)
                );
                
                Promise.race([cleanupPromise, timeoutPromise])
                    .then(() => {
                        console.log('✓ Cleaned up snarkjs workers');
                        process.exit(0);
                    })
                    .catch(() => {
                        console.log('⚠ Cleanup timed out (workers may still be terminating)');
                        process.exit(0);
                    });
            } else {
                process.exit(0);
            }
        } catch (e) {
            // Ignore cleanup errors
            process.exit(0);
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        process.exit(1);
    });

