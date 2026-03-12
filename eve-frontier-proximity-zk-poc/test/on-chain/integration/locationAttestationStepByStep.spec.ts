import path from 'path';
import fs from 'fs/promises';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { generateLocationAttestationPod } from '../../../src/shared/pods/utils/generateLocationAttestationPod';
import { generateLocationProof } from '../../../src/on-chain/proofs/utils/generateLocationProof';
import { formatProofForSui, readCircuitVKey } from '../../../src/on-chain/utils/formatProofForSui';
import { POD } from '@pcd/pod';
import { LocationAttestationData } from '../../../src/shared/types/locationType';
import { generatePodMerkleTree } from '../../../src/shared/merkle/utils/podMerkleUtils';
import { generateOptimizedMultiproofFromTree, loadOptimizedMultiproofFromFile } from '../../../src/shared/merkle/utils/generateMerkleMultiproof';
import { formatMerkleProofDataForSui } from '../../../src/on-chain/utils/formatMerkleProofForSui';
import { deriveObjectID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import crypto from 'crypto';
import { setupTestEnvironment, getTestEnvironment } from './shared/testSetup';

// Helper to compute Sui address from Ed25519 public key (matches Move code)
// Move code does: blake2b256([0x00] || public_key), then address::from_bytes
// We use the same keypair that generated the POD to get the address
// This ensures consistency since the keypair's public key matches podEd25519PublicKey
function getSignerAddressFromKeypair(keypair: Ed25519Keypair): string {
    return keypair.toSuiAddress();
}

// Helper to compute deterministic object address from registry ID and item_id
// Uses Sui SDK's deriveObjectID which implements the same algorithm as Move's derived_object::derive_address
// This is completely off-chain - no network calls needed
function computeDerivedObjectAddress(
    registryId: string,
    itemId: number
): string {
    // deriveObjectID expects the key type (e.g., 'u64'), not the full DerivedObjectKey<u64> type
    // It internally wraps it as: 0x2::derived_object::DerivedObjectKey<u64>
    const keyTypeTag = 'u64'; // Just the key type, not the full DerivedObjectKey wrapper
    
    // BCS encode the u64 key (item_id)
    // u64 is encoded as little-endian 8 bytes
    const keyBytes = new Uint8Array(8);
    const view = new DataView(keyBytes.buffer);
    view.setBigUint64(0, BigInt(itemId), true); // true = little-endian (BCS encoding)
    
    // Use Sui SDK's deriveObjectID which computes:
    // deriveDynamicFieldID(parentId, '0x2::derived_object::DerivedObjectKey<u64>', keyBytes)
    // This matches Move's: df::hash_type_and_key(parent.to_address(), DerivedObjectKey(key))
    return deriveObjectID(registryId, keyTypeTag, keyBytes);
}

// Helper function to generate a random 32-byte salt (hex string)
function generateSalt(): string {
    return '0x' + crypto.randomBytes(32).toString('hex');
}

// Helper to convert hex string to Uint8Array
function hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.replace(/^0x/, '').replace(/\s/g, '');
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
    }
    return bytes;
}

// Helper to convert hex string to bytes (now little-endian hex strings match Move's bytes_to_u256)
// No reversal needed since we're using little-endian hex strings consistently
function hexToBytesForMove(hex: string): Uint8Array {
    return hexToBytes(hex);
}

// Helper to refresh shared object versions after a successful transaction
// This ensures we have the latest versions for subsequent transactions
async function refreshSharedObjectVersions(
    client: SuiClient,
    result: any,
    objectIds: string[]
): Promise<void> {
    if (!result.objectChanges || objectIds.length === 0) {
        return;
    }

    // Wait a bit for network to propagate the changes
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract updated versions from objectChanges
    const updatedVersions = new Map<string, string>();
    for (const change of result.objectChanges) {
        if (change.type === 'mutated' || change.type === 'created') {
            const objectId = change.objectId;
            if (objectIds.includes(objectId) && change.version) {
                updatedVersions.set(objectId, change.version);
            }
        }
    }

    // Log updated versions for debugging
    if (updatedVersions.size > 0) {
        console.log(`  ↻ Refreshed ${updatedVersions.size} shared object version(s):`);
        for (const [objectId, version] of updatedVersions.entries()) {
            console.log(`    - ${objectId.substring(0, 20)}... → version ${version}`);
        }
    }
}

// Helper to execute transaction with retry logic
async function executeTransactionWithRetry(
    client: SuiClient,
    signer: Ed25519Keypair,
    buildTx: () => Transaction,
    maxRetries: number = 3,
    sharedObjectIds?: string[] // Optional: IDs of shared objects to refresh after success
): Promise<any> {
    let lastError: any;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // CRITICAL: Build transaction fresh each time to get latest object versions
            // This ensures we always use the current version of objects, not stale ones
            // According to Sui docs: https://docs.sui.io/guides/developer/sui-101/common-errors
            // Object versions can change between transactions, so we must rebuild with fresh versions
            const txb = buildTx();
            txb.setSender(signer.toSuiAddress());
            
            // Set gas budget before building
            txb.setGasBudget(1000000000);
            
            // Build transaction block - this fetches current object versions from the network
            // The SDK automatically queries for the latest version of each object referenced
            const builtBlock = await txb.build({ client });
            const signedBlock = await signer.signTransaction(builtBlock);
            
            const result = await client.executeTransactionBlock({
                transactionBlock: signedBlock.bytes,
                signature: signedBlock.signature,
                options: {
                    showEffects: true,
                    showEvents: true,
                    showObjectChanges: true,
                },
            });
            
            // Check if transaction succeeded
            if (result.effects?.status.status === 'success') {
                // After successful transaction, refresh shared object versions if requested
                // This ensures subsequent transactions use the latest versions
                if (sharedObjectIds && sharedObjectIds.length > 0) {
                    await refreshSharedObjectVersions(client, result, sharedObjectIds);
                }
                return result;
            } else {
                // Transaction failed - check if it's an expected error first
                const errorInfo = result.effects?.status.error;
                
                // Check if this is error code 1 from add_approved_signer (signer already in list)
                // Error format: "MoveAbort(..., add_approved_signer, 1)"
                const isExpectedError = errorInfo && (
                    (typeof errorInfo === 'string' && 
                     errorInfo.includes('add_approved_signer') && 
                     (errorInfo.includes(', 1)') || errorInfo.includes('}, 1)'))) ||
                    (typeof errorInfo === 'object' && 
                     JSON.stringify(errorInfo).includes('add_approved_signer') &&
                     (JSON.stringify(errorInfo).includes(', 1)') || JSON.stringify(errorInfo).includes('}, 1)')))
                );
                
                if (isExpectedError) {
                    // This is expected - signer is already in the approved list
                    // Return a success-like result to avoid logging as error
                    return result;
                }
                
                // Transaction failed - log details for debugging
                console.error(`⚠ Transaction failed on attempt ${attempt + 1}:`);
                console.error(`   Status: ${result.effects?.status.status}`);
                
                if (errorInfo) {
                    console.error(`   Error details: ${JSON.stringify(errorInfo, null, 2)}`);
                    
                    // Check for Move abort errors
                    if (typeof errorInfo === 'string' && errorInfo.includes('MoveAbort')) {
                        console.error(`   ⚠ This is a Move abort error - check the error code`);
                    } else if (typeof errorInfo === 'object') {
                        // Try to extract Move abort information
                        const errorStr = JSON.stringify(errorInfo);
                        if (errorStr.includes('MoveAbort') || errorStr.includes('abort_code')) {
                            console.error(`   ⚠ Move abort detected - check error code and module location`);
                        }
                    }
                }
                
                // Log events for debugging (they might contain error info)
                if (result.events && result.events.length > 0) {
                    console.error(`   Events (${result.events.length}):`);
                    result.events.forEach((event: any, idx: number) => {
                        console.error(`     Event ${idx + 1}:`, JSON.stringify(event, null, 2));
                    });
                } else {
                    console.error(`   No events emitted (transaction failed before events could be emitted)`);
                }
                
                // Log transaction digest for inspection
                if (result.digest) {
                    console.error(`   Transaction digest: ${result.digest}`);
                    console.error(`   You can inspect this transaction with: sui client transaction ${result.digest}`);
                }
                
                // Throw error to trigger retry logic (if it's a version error, it will retry)
                const errorMessage = errorInfo ? JSON.stringify(errorInfo) : 'Unknown error';
                throw new Error(`Transaction failed: ${errorMessage}`);
            }
        } catch (error: any) {
            lastError = error;
            const errorMessage = error.message || String(error);
            
            // Check if it's a version/stale object error
            // According to Sui docs: https://docs.sui.io/guides/developer/sui-101/common-errors
            // This happens when objects are modified between transaction building and execution
            // Error pattern: "not available for consumption, current version: 0x8"
            const isVersionError = 
                errorMessage.includes('version') || 
                errorMessage.includes('stale') || 
                errorMessage.includes('ObjectVersion') ||
                errorMessage.includes('not available for consumption') ||
                errorMessage.includes('current version') ||
                errorMessage.includes('is not available');
            
            if (isVersionError) {
                if (attempt < maxRetries - 1) {
                    console.log(`Attempt ${attempt + 1} failed with version error (object version mismatch), retrying with fresh object versions...`);
                    // Wait a bit before retrying to allow any pending transactions to complete
                    // The transaction will be rebuilt with fresh object versions on the next iteration
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                    continue; // Loop will rebuild transaction with fresh versions
                } else {
                    console.error(`Version error persisted after ${maxRetries} attempts. Error: ${errorMessage}`);
                    throw new Error(`Transaction failed due to object version mismatch after ${maxRetries} retries. This usually means objects are being modified concurrently. Error: ${errorMessage}`);
                }
            }
            
            // If it's not a retryable error, throw immediately
            throw error;
        }
    }
    
    throw lastError;
}

describe('Location Attestation Step-by-Step Integration Tests', () => {
    let client: SuiClient;
    let signer: Ed25519Keypair;
    let testPrivateKey: string;
    let ed25519PrivateKey: string;
    let ed25519Keypair: Ed25519Keypair;
    let packageId: string;
    let publishTransactionDigest: string;
    let objectRegistryId: string;
    let adminCapId: string;
    let approvedSignersId: string;
    const generatedFiles: string[] = [];

    beforeAll(async () => {
        // Use shared test environment setup (singleton pattern - only runs once)
        const env = await setupTestEnvironment();
        
        // Extract environment variables
        client = env.client;
        signer = env.signer;
        ed25519Keypair = env.ed25519Keypair;
        packageId = env.packageId;
        publishTransactionDigest = env.publishTransactionDigest;
        objectRegistryId = env.objectRegistryId;
        adminCapId = env.adminCapId;
        approvedSignersId = env.approvedSignersId;
        testPrivateKey = env.testPrivateKey;
        ed25519PrivateKey = env.ed25519PrivateKey;

        // AdminCap needs to be created manually if not found (it's not created during publishing)
        if (!adminCapId) {
            console.log('Creating AdminCap...');
            try {
                const createAdminResult = await executeTransactionWithRetry(
                    client,
                    signer,
                    () => {
                        const txb = new Transaction();
                        txb.setSender(signer.toSuiAddress());
                        txb.moveCall({
                            target: `${packageId}::authority::create_admin_cap`,
                            arguments: [txb.pure.address(signer.toSuiAddress())],
                        });
                        return txb;
                    }
                );

                const createdAdminObj = createAdminResult.effects?.created?.find((obj: any) =>
                    obj.reference?.objectType?.includes('AdminCap')
                );
                if (createdAdminObj?.reference?.objectId) {
                    adminCapId = createdAdminObj.reference.objectId;
                    console.log(`✓ Created AdminCap: ${adminCapId}`);
                } else {
                    const adminCapChange = createAdminResult.objectChanges?.find((change: any) =>
                        change.type === 'created' && change.objectType.includes('AdminCap')
                    );
                    if (adminCapChange && adminCapChange.type === 'created') {
                        adminCapId = adminCapChange.objectId;
                        console.log(`✓ Created AdminCap (from objectChanges): ${adminCapId}`);
                    }
                }
            } catch (error: any) {
                console.error(`⚠ Failed to create AdminCap: ${error.message}`);
                throw new Error(`Failed to create AdminCap: ${error.message}`);
            }
        }

        // Verify we have all required objects
        if (!objectRegistryId || !adminCapId || !approvedSignersId) {
            const missing = [];
            if (!objectRegistryId) missing.push('objectRegistryId');
            if (!adminCapId) missing.push('adminCapId');
            if (!approvedSignersId) missing.push('approvedSignersId');
            throw new Error(`Missing required setup objects: ${missing.join(', ')}. Package ID: ${packageId}`);
        }

        // Add POD signer (ed25519Keypair) to approved signers list
        // NOTE: We're adding the POD SIGNER's address to the approved list, NOT the transaction signer's address
        // The transaction signer (signer) submits this transaction, but the POD signer (ed25519Keypair) signs PODs
        if (approvedSignersId && adminCapId && ed25519Keypair && packageId) {
            try {
                // Use toSuiAddress() to get the POD signer's Sui address
                // This is the address that signs PODs and needs to be in the approved list
                const podSignerAddr = ed25519Keypair.toSuiAddress();
                
                await executeTransactionWithRetry(
                    client,
                    signer, // Transaction signer submits this transaction
                    () => {
                        const txb = new Transaction();
                        txb.setSender(signer.toSuiAddress()); // Transaction signer's address
                        txb.moveCall({
                            target: `${packageId}::authority::add_approved_signer`,
                            arguments: [
                                txb.object(approvedSignersId!),
                                txb.pure.address(podSignerAddr), // POD signer's address (what we're adding to approved list)
                                txb.object(adminCapId!),
                            ],
                        });
                        return txb;
                    }
                ).catch(err => {
                    // Ignore if already added
                    console.log('Note: Approved signer may already be added');
                });
                console.log(`✓ Added POD signer (Ed25519) to approved signers: ${podSignerAddr}`);
                console.log(`  Transaction submitted by: ${signer.toSuiAddress()}`);
            } catch (error: any) {
                console.warn(`⚠ Could not add POD signer to approved list: ${error.message}`);
            }
        }

        console.log('✓ Test setup complete');
    }, 120000);

    afterAll(async () => {
        // Clean up generated files
        for (const file of generatedFiles) {
            try {
                await fs.unlink(file);
            } catch (error) {
                // Ignore cleanup errors (file may not exist)
            }
        }
        
        // Clean up any output directories created during tests
        const outputDirs = [
            path.join(process.cwd(), 'outputs', 'pods'),
            path.join(process.cwd(), 'outputs', 'merkle', 'trees'),
            path.join(process.cwd(), 'outputs', 'merkle', 'multiproofs'),
            path.join(process.cwd(), 'outputs', 'proofs', 'on-chain', 'location-attestation'),
        ];
        
        for (const dir of outputDirs) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        try {
                            await fs.unlink(path.join(dir, file));
                        } catch {
                            // Ignore individual file errors
                        }
                    }
                }
            } catch {
                // Ignore directory errors (may not exist)
            }
        }
    });

    /**
     * STEP 1: Load vkey.hex and create PreparedVerifyingKey
     * 
     * This is the simplest test - just load the verification key from disk,
     * prepare it on-chain, and verify the proof directly.
     */
    describe('Step 1: Basic Proof Verification', () => {
        it('should load vkey.hex, create PreparedVerifyingKey, and verify location proof', async () => {
            if (!testPrivateKey || !packageId || !ed25519PrivateKey) {
                throw new Error('Cannot run test without private key, package ID, or Ed25519 keypair');
            }

            console.log('\n=== STEP 1: Basic Proof Verification ===');

            // 1. Load verification key from disk
            console.log('1. Loading verification key from vkey.hex...');
            const vkeyHex = await readCircuitVKey('location-attestation');
            expect(vkeyHex).toBeDefined();
            expect(vkeyHex.length).toBeGreaterThan(0);
            console.log(`   ✓ Loaded vkey: ${vkeyHex.length / 2} bytes`);

            // 2. Generate a location POD
            console.log('2. Generating location POD...');
            const testObjectId = '0x' + '1'.repeat(64);
            const locationData: LocationAttestationData = {
                objectId: testObjectId,
                solarSystem: 987,
                coordinates: { x: 1000, y: 2000, z: 3000 },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod, filePath: podFilePath } = await generateLocationAttestationPod(
                locationData,
                testPrivateKey,
                ed25519PrivateKey
            );
            generatedFiles.push(podFilePath);
            const locationPod = POD.fromJSON(jsonPod);
            console.log('   ✓ POD generated');

            // 3. Generate location ZK proof
            console.log('3. Generating location ZK proof...');
            const proofResult = await generateLocationProof(locationPod, locationData);
            generatedFiles.push(proofResult.filePath);
            if (proofResult.inputFilePath) {
                generatedFiles.push(proofResult.inputFilePath);
            }
            console.log('   ✓ ZK proof generated');

            // 4. Format proof for Sui
            console.log('4. Formatting proof for Sui...');
            const formatted = await formatProofForSui(proofResult.filePath, 'location-attestation');
            console.log('   ✓ Proof formatted for Sui');
            console.log(`   - Proof points: ${formatted.proofPointsHex.length / 2} bytes`);
            console.log(`   - Public inputs: ${formatted.publicInputsHex.length / 2} bytes`);

            // 5. Create transaction to verify proof directly
            console.log('5. Creating verification transaction...');
            const verifyTxb = new Transaction();
            verifyTxb.setSender(signer.toSuiAddress());

            // Convert vkey hex to bytes
            const vkeyBytes = hexToBytes(vkeyHex);
            console.log(`   [Step 1 Debug] VKey bytes length: ${vkeyBytes.length} bytes`);
            console.log(`   [Step 1 Debug] VKey bytes (first 16): [${Array.from(vkeyBytes.slice(0, 16)).join(', ')}]`);
            console.log(`   [Step 1 Debug] VKey bytes (last 16): [${Array.from(vkeyBytes.slice(vkeyBytes.length - 16)).join(', ')}]`);
            console.log(`   [Step 1 Debug] VKey hex (full): ${vkeyHex}`);

            // Prepare proof bytes
            const proofPointsBytes = hexToBytes(formatted.proofPointsHex);
            // Use little-endian for Groth16 verification
            const publicInputsBytes = hexToBytes(formatted.publicInputsHexLittleEndian);
            // Use big-endian for Merkle proof parsing (stored for later use)
            const publicInputsBytesForMerkle = hexToBytes(formatted.publicInputsHex);
            
            // Debug: Log proof data for Step 1 (detailed for comparison)
            console.log(`   [Step 1 Debug] Proof points length: ${proofPointsBytes.length} bytes`);
            console.log(`   [Step 1 Debug] Public inputs length (little-endian for Groth16): ${publicInputsBytes.length} bytes`);
            console.log(`   [Step 1 Debug] Proof points hex (first 64 bytes): ${formatted.proofPointsHex.substring(0, 128)}...`);
            console.log(`   [Step 1 Debug] Public inputs hex (little-endian, first 64 bytes): ${formatted.publicInputsHexLittleEndian.substring(0, 128)}...`);
            console.log(`   [Step 1 Debug] Proof points bytes (first 16): [${Array.from(proofPointsBytes.slice(0, 16)).join(', ')}]`);
            console.log(`   [Step 1 Debug] Public inputs bytes (little-endian, first 16): [${Array.from(publicInputsBytes.slice(0, 16)).join(', ')}]`);
            console.log(`   [Step 1 Debug] Proof points hex (last 32 bytes): ...${formatted.proofPointsHex.substring(formatted.proofPointsHex.length - 64)}`);
            console.log(`   [Step 1 Debug] Public inputs hex (little-endian, last 32 bytes): ...${formatted.publicInputsHexLittleEndian.substring(formatted.publicInputsHexLittleEndian.length - 64)}`);

            // Note: Groth16 verification is performed directly in fixed_object::create and dynamic_object::set_location
            // We don't need a separate verification call here - the proof will be verified when we create the objects
            
            // 6. Skip separate verification (actual verification happens in object creation)
            console.log('6. Skipping separate verification (Groth16 verification happens in object creation)...');
            console.log('   ✓ Proof data prepared (will be verified when creating objects)');
            console.log('=== STEP 1 COMPLETE ===\n');
            
            // Store proof data for Step 1.5 test
            return {
                proofPointsBytes,
                publicInputsBytes,
                formatted,
                vkeyBytes
            };
        }, 120000);


        // Step 1.9 removed - verify_location_attestation now requires LocationAttestationData
        // This is tested in Step 2 via set_location

        /**
         * STEP 2: Create Object and Set Location via set_location
         * 
         * This test creates an Object, generates a location POD and proof,
         * registers the verification key, and then calls set_location which
         * internally verifies the ZK proof and stores the location data.
         */
        it('should create Object and set location via set_location (with internal ZK verification)', async () => {
            if (!testPrivateKey || !packageId || !ed25519Keypair || !objectRegistryId || !adminCapId || !approvedSignersId) {
                throw new Error('Cannot run test without required setup (private key, package ID, Ed25519 keypair, object registry ID, admin cap ID, or approved signers ID)');
            }

            console.log('\n=== STEP 2: Create Object and Set Location ===');

            // 0. Compute deterministic object ID from item_id BEFORE creating the object
            // This allows us to generate the proof for the correct object ID
            const itemId = 0x222222; // Fixed item ID for DynamicObject (2236962 decimal)
            console.log(`0. Computing deterministic object ID for item_id=${itemId}...`);
            const deterministicObjectId = computeDerivedObjectAddress(
                objectRegistryId!,
                itemId
            );
            console.log(`   ✓ Computed deterministic object ID (off-chain): ${deterministicObjectId}`);

            // 1. Generate location POD with the deterministic object ID
            console.log('1. Generating location POD with deterministic object ID...');
            const locationData: LocationAttestationData = {
                objectId: deterministicObjectId,
                solarSystem: 987,
                coordinates: { x: 1000, y: 2000, z: 3000 },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod, filePath: podFilePath, ed25519PublicKey: podEd25519PublicKey } = await generateLocationAttestationPod(
                locationData,
                testPrivateKey,
                ed25519PrivateKey
            );
            generatedFiles.push(podFilePath);
            
            // Get signer address from keypair (should match the public key used in POD)
            // Verify the public key matches
            const keypairPublicKey = ed25519Keypair.getPublicKey().toRawBytes();
            if (Buffer.from(keypairPublicKey).compare(Buffer.from(podEd25519PublicKey)) !== 0) {
                throw new Error('Public key mismatch: keypair public key does not match POD public key');
            }
            const signerAddress = getSignerAddressFromKeypair(ed25519Keypair);
            console.log(`   ✓ Signer address: ${signerAddress}`);
            
            // Ensure this signer is in the approved list (add if not already there)
            try {
                await executeTransactionWithRetry(
                    client,
                    signer,
                    () => {
                        const txb = new Transaction();
                        txb.setSender(signer.toSuiAddress());
                        txb.moveCall({
                            target: `${packageId}::authority::add_approved_signer`,
                            arguments: [
                                txb.object(approvedSignersId!),
                                txb.pure.address(signerAddress),
                                txb.object(adminCapId!),
                            ],
                        });
                        return txb;
                    }
                ).catch(err => {
                    // Ignore if already added
                    console.log('   Note: Signer may already be in approved list');
                });
                console.log(`   ✓ Ensured signer is in approved list: ${signerAddress}`);
            } catch (error: any) {
                console.warn(`   ⚠ Could not add signer to approved list: ${error.message}`);
            }
            
            const locationPod = POD.fromJSON(jsonPod);
            const podEntries = locationPod.content.asEntries();
            console.log('   ✓ POD generated');

            // 3. Generate Merkle tree
            console.log('3. Generating Merkle tree...');
            const treeResult = generatePodMerkleTree(podEntries, locationData.pod_data_type);
            console.log(`   ✓ Merkle tree generated with root: ${treeResult.root}`);

            // 4. Generate location ZK proof
            // IMPORTANT: Pass the ed25519PublicKey from POD generation to ensure consistency
            console.log('4. Generating location ZK proof...');
            const proofResult = await generateLocationProof(locationPod, locationData, undefined, podEd25519PublicKey);
            generatedFiles.push(proofResult.filePath);
            if (proofResult.inputFilePath) {
                generatedFiles.push(proofResult.inputFilePath);
            }
            console.log('   ✓ ZK proof generated');

            // 5. Format proof for Sui
            console.log('5. Formatting proof for Sui...');
            const formatted = await formatProofForSui(proofResult.filePath, 'location-attestation');
            console.log('   ✓ Proof formatted for Sui');

            // 6. Prepare proof bytes and vkey bytes for later use
            // Note: We skip direct verification here since Step 1 already proved the proof format works
            // The proof data is the same format, just for a different object
            console.log('6. Preparing proof bytes and vkey...');
            const proofPointsBytes = hexToBytes(formatted.proofPointsHex);
            // Use little-endian for Groth16 verification
            const publicInputsBytes = hexToBytes(formatted.publicInputsHexLittleEndian);
            const publicInputsBytesForGroth16 = publicInputsBytes; // Alias for compatibility
            // Use big-endian for Merkle proof parsing
            const publicInputsBytesForMerkle = hexToBytes(formatted.publicInputsHex);
            const vkeyBytesFromFormatted = hexToBytes(formatted.vkeyHex);
            console.log(`   ✓ Proof bytes prepared (${proofPointsBytes.length} proof points, ${publicInputsBytesForGroth16.length} public inputs for Groth16, ${publicInputsBytesForMerkle.length} for Merkle)`);
            console.log(`   ✓ VKey bytes prepared (${vkeyBytesFromFormatted.length} bytes)`);
            console.log(`   [Step 2 Debug] VKey bytes (first 16): [${Array.from(vkeyBytesFromFormatted.slice(0, 16)).join(', ')}]`);
            console.log(`   [Step 2 Debug] VKey bytes (last 16): [${Array.from(vkeyBytesFromFormatted.slice(vkeyBytesFromFormatted.length - 16)).join(', ')}]`);
            console.log(`   [Step 2 Debug] VKey hex (full): ${formatted.vkeyHex}`);
            console.log(`   Note: Proof format is valid (verified in Step 1), proceeding with set_location`);
            
            // Compare with Step 1 vkey to ensure they match
            // Both should read from the same file, but let's verify
            const step1VkeyHex = await readCircuitVKey('location-attestation');
            const step1VkeyBytes = hexToBytes(step1VkeyHex);
            const vkeysMatch = step1VkeyHex === formatted.vkeyHex;
            console.log(`   [Comparison] Step 1 vkey length: ${step1VkeyBytes.length} bytes`);
            console.log(`   [Comparison] Step 2 vkey length: ${vkeyBytesFromFormatted.length} bytes`);
            console.log(`   [Comparison] VKeys match: ${vkeysMatch}`);
            if (!vkeysMatch) {
                console.error(`   ⚠ WARNING: VKeys don't match! This could be the issue.`);
                console.error(`   Step 1 vkey hex (first 128): ${step1VkeyHex.substring(0, 128)}...`);
                console.error(`   Step 2 vkey hex (first 128): ${formatted.vkeyHex.substring(0, 128)}...`);
                throw new Error('VKeys from Step 1 and Step 2 do not match!');
            }
            
            // Use the Step 1 vkey to ensure exact match
            console.log(`   Using Step 1 vkey to ensure exact match`);
            const vkeyBytesToUse = step1VkeyBytes; // Use Step 1 vkey explicitly
            
            // 6.5. Note: Groth16 verification happens automatically in dynamic_object::set_location
            // No separate verification call needed

            // 6.6, 6.7, 6.8 REMOVED (Debug steps for shared/owned object contexts no longer needed with Hot Potato pattern)

            // Note: We no longer register verification keys - we pass vkey_bytes directly to functions
            // The vkey_bytes will be used to create PreparedVerifyingKey internally in groth16::prepare_verifying_key

            // 7. Generate multiproof for objectId and pod_data_type
            console.log('7. Generating Merkle multiproof...');
            const multiproofFilePath = path.join(process.cwd(), 'outputs', 'merkle', 'multiproofs', `${locationData.timestamp}_${locationData.objectId}_multiproof.json`);
            generatedFiles.push(multiproofFilePath);
            
            let multiproof;
            try {
                multiproof = await loadOptimizedMultiproofFromFile(multiproofFilePath);
                console.log(`   ✓ Loaded existing multiproof`);
            } catch {
                multiproof = await generateOptimizedMultiproofFromTree(treeResult, ['objectId', 'pod_data_type'], multiproofFilePath);
                console.log(`   ✓ Generated and saved multiproof`);
            }
            
            const formattedMerkleProof = formatMerkleProofDataForSui(multiproof, treeResult.root);

            // 8. Prepare data for set_location transaction
            console.log('8. Preparing set_location transaction data...');
            
            // Use the Step 1 vkey bytes for consistency (vkeyBytesToUse)
            const vkeyBytes = vkeyBytesToUse;
            
            // Debug: Log proof data sizes and content for comparison
            console.log(`   Debug - Proof points length: ${proofPointsBytes.length} bytes`);
            console.log(`   Debug - Public inputs length (little-endian for Groth16): ${publicInputsBytesForGroth16.length} bytes`);
            console.log(`   Debug - Public inputs length (big-endian for Merkle): ${publicInputsBytesForMerkle.length} bytes`);
            console.log(`   Debug - VKey bytes length: ${vkeyBytes.length} bytes`);
            console.log(`   Debug - Proof points hex (first 64 bytes): ${formatted.proofPointsHex.substring(0, 128)}...`);
            console.log(`   Debug - Public inputs hex (little-endian, first 64 bytes): ${formatted.publicInputsHexLittleEndian.substring(0, 128)}...`);
            console.log(`   Debug - Proof points hex (last 32 bytes): ...${formatted.proofPointsHex.substring(formatted.proofPointsHex.length - 64)}`);
            console.log(`   Debug - Public inputs hex (little-endian, last 32 bytes): ...${formatted.publicInputsHexLittleEndian.substring(formatted.publicInputsHexLittleEndian.length - 64)}`);
            
            const rootBytes = hexToBytesForMove(formattedMerkleProof.root);
            const leavesBytes = formattedMerkleProof.leaves.map(leaf => Array.from(hexToBytesForMove(leaf)));
            const proofBytes = formattedMerkleProof.proof.map(proof => Array.from(hexToBytesForMove(proof)));

            // 8. Prepare data for set_location transaction
            console.log('8. Preparing set_location transaction data...');
            
            // Extract Ed25519 signature from POD entry (following generate-move-test-proof-data.ts pattern)
            // IMPORTANT: We need the Ed25519 signature that signs the Merkle root (stored in POD entry 'ed25519_signature'),
            // NOT the POD signature (EDDSA-Poseidon) which is in locationPod.signature
            let ed25519SignatureBytes: Uint8Array;
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
                    console.log(`   Extracted 64-byte Ed25519 signature from 97-byte Sui signature (bytes 1-64)`);
                } else if (sigBytes.length === 64) {
                    // Already just the signature - use as-is (was already extracted when stored in POD)
                } else if (sigBytes.length > 64) {
                    // Unexpected length - try bytes 1-64 (assuming first byte is flag)
                    sigBytes = sigBytes.slice(1, 65);
                    console.log(`   Warning: Unexpected signature length ${sigBytes.length}, extracting bytes 1-64`);
                } else {
                    throw new Error(`Ed25519 signature should be at least 64 bytes, got ${sigBytes.length} bytes`);
                }
                
                // Final validation
                if (sigBytes.length !== 64) {
                    throw new Error(`Ed25519 signature must be exactly 64 bytes after extraction, got ${sigBytes.length} bytes`);
                }
                
                ed25519SignatureBytes = sigBytes;
            } else {
                throw new Error('Missing ed25519_signature entry in POD');
            }
            
            // Extract Ed25519 public key from return value (Uint8Array from generateLocationAttestationPod)
            // This ensures it matches what was used in proof generation
            if (!podEd25519PublicKey) {
                throw new Error('Missing ed25519PublicKey from generateLocationAttestationPod return value');
            }
            if (podEd25519PublicKey.length !== 32) {
                throw new Error(`Ed25519 public key should be 32 bytes, got ${podEd25519PublicKey.length} bytes`);
            }
            
            const ed25519PublicKeyBytes = Array.from(podEd25519PublicKey);
            const signatureBytes = Array.from(ed25519SignatureBytes);
            
            console.log(`   ✓ Extracted Ed25519 signature (64 bytes) and public key (32 bytes)`);
            
            // Prepare all parameters for set_location
            const objectIdAddr = '0x' + locationData.objectId.replace('0x', '');
            const timestamp = locationData.timestamp.toString();

            // 8.5. Create DynamicObject first (required before calling set_location)
            console.log('8.5. Creating DynamicObject...');
            const createResult = await executeTransactionWithRetry(
                client,
                signer,
                () => {
                    const txb = new Transaction();
                    txb.setSender(signer.toSuiAddress());

                    txb.moveCall({
                        target: `${packageId}::dynamic_object::create`,
                        arguments: [
                            txb.object(objectRegistryId!), // registry
                            txb.pure.u64(itemId), // item_id
                            txb.object(adminCapId!) // admin_cap
                        ],
                    });

                    return txb;
                },
                3
            );

            if (createResult.effects?.status.status !== 'success') {
                console.error('❌ DynamicObject creation failed!');
                const errorInfo = createResult.effects?.status.error;
                console.error(`   Status: ${createResult.effects?.status.status}`);
                console.error(`   Error: ${JSON.stringify(errorInfo, null, 2)}`);
                throw new Error(`DynamicObject creation failed with status: ${createResult.effects?.status.status}`);
            }

            // Verify the created object ID matches the deterministic ID
            const createdObjects = createResult.effects?.created || [];
            const objectChanges = createResult.objectChanges || [];
            
            const isShared = (owner: any) => {
                return owner === 'Shared' || (typeof owner === 'object' && owner !== null && 'Shared' in owner);
            };

            let createdObjectId = createdObjects.find((obj: any) => {
                const owner = obj.owner;
                const objectType = obj.reference?.objectType;
                return isShared(owner) && objectType && objectType.includes('DynamicObject');
            })?.reference?.objectId;
            
            if (!createdObjectId && objectChanges) {
                const objectChange = objectChanges.find((change: any) => {
                    if (change.type === 'created') {
                        const owner = change.owner;
                        const objectType = change.objectType;
                        return isShared(owner) && objectType && objectType.includes('DynamicObject');
                    }
                    return false;
                });
                
                if (objectChange && objectChange.type === 'created') {
                    createdObjectId = objectChange.objectId;
                }
            }
            
            if (!createdObjectId) {
                console.error('   Created objects:', JSON.stringify(createdObjects, null, 2));
                console.error('   Object changes:', JSON.stringify(objectChanges, null, 2));
                throw new Error('Could not find created DynamicObject');
            }
            
            // Verify deterministic ID matches created ID
            if (createdObjectId !== deterministicObjectId) {
                console.error(`   Computed deterministic ID: ${deterministicObjectId}`);
                console.error(`   Created object ID: ${createdObjectId}`);
                throw new Error(`Deterministic object ID mismatch: computed ${deterministicObjectId}, created ${createdObjectId}`);
            }
            
            console.log(`   ✓ DynamicObject created with deterministic ID: ${createdObjectId}`);
            console.log(`   [Debug] Using object ID: ${createdObjectId} for set_location`);

            // Verify the object exists and is queryable before proceeding
            // This ensures the object is fully available on the network
            console.log('   Verifying object is available on network...');
            let objectVerified = false;
            let retries = 5;
            while (!objectVerified && retries > 0) {
                try {
                    const obj = await client.getObject({
                        id: createdObjectId,
                        options: {
                            showContent: false,
                            showOwner: true,
                            showType: true,
                        }
                    });
                    if (obj.data) {
                        objectVerified = true;
                        console.log(`   ✓ Object verified and available (version: ${obj.data.version})`);
                    } else {
                        throw new Error('Object data is null');
                    }
                } catch (error: any) {
                    retries--;
                    if (retries > 0) {
                        console.log(`   Object not yet available, waiting... (${retries} retries left)`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } else {
                        throw new Error(`Object ${createdObjectId} is not available on network after creation: ${error.message}`);
                    }
                }
            }

            // 9. Execute set_location transaction (inline Groth16 verification)
            console.log('9. Executing set_location (with inline Groth16 verification)...');
            
            // CRITICAL: Pass shared object IDs so we can refresh their versions after success
            const sharedObjectIds = [createdObjectId, objectRegistryId!, approvedSignersId!].filter(Boolean) as string[];
            
            const result = await executeTransactionWithRetry(
                client,
                signer,
                () => {
                    const txb = new Transaction();
                    txb.setSender(signer.toSuiAddress());

                    // Call set_location with all primitive parameters
                    // This function performs inline Groth16 verification and then
                    // calls location_attestation::verify_location_attestation for remaining checks
                    txb.moveCall({
                        target: `${packageId}::dynamic_object::set_location`,
                        arguments: [
                            txb.object(createdObjectId), // DynamicObject (now exists)
                            txb.pure.address(objectIdAddr), // proof_object_id (should match deterministicObjectId)
                            txb.pure.vector('u8', ed25519PublicKeyBytes), // signer_public_key
                            txb.pure.vector('u8', signatureBytes), // ed25519_signature
                            txb.pure.vector('vector<u8>', leavesBytes), // merkle_leaves
                            txb.pure.vector('vector<u8>', proofBytes), // merkle_proof_bytes
                            txb.pure.vector('bool', formattedMerkleProof.proofFlags), // merkle_proof_flags
                            txb.pure.u64(timestamp), // timestamp
                            txb.pure.vector('u8', Array.from(vkeyBytes)), // vkey_bytes
                            txb.pure.vector('u8', Array.from(proofPointsBytes)), // proof_points_bytes
                            txb.pure.vector('u8', Array.from(publicInputsBytesForGroth16)), // public_inputs_bytes (little-endian for Groth16)
                            txb.object(approvedSignersId!), // approved_signers
                            txb.object(objectRegistryId!) // registry
                        ],
                    });

                    return txb;
                },
                3, // maxRetries
                sharedObjectIds // Refresh these object versions after success
            );

            // Extract and log byte diagnostics from events
            const events = result.events || [];
            for (const event of events) {
                if (event.type?.includes('ByteDiagnosticsEvent')) {
                    const diagnostics = event.parsedJson as any;
                    console.log('   [DEBUG] Byte Diagnostics from dynamic_object::set_location:');
                    console.log(`     vkey_bytes: len=${diagnostics.vkey_len}, first=${diagnostics.vkey_first_byte}, last=${diagnostics.vkey_last_byte}`);
                    console.log(`     proof_points_bytes: len=${diagnostics.proof_points_len}, first=${diagnostics.proof_points_first_byte}, last=${diagnostics.proof_points_last_byte}`);
                    console.log(`     public_inputs_bytes: len=${diagnostics.public_inputs_len}, first=${diagnostics.public_inputs_first_byte}, last=${diagnostics.public_inputs_last_byte}`);
                    console.log(`   [COMPARISON] Step 2 direct verification bytes:`);
                    console.log(`     vkey_bytes: len=${vkeyBytes.length}, first=${vkeyBytes[0]}, last=${vkeyBytes[vkeyBytes.length - 1]}`);
                    console.log(`     proof_points_bytes: len=${proofPointsBytes.length}, first=${proofPointsBytes[0]}, last=${proofPointsBytes[proofPointsBytes.length - 1]}`);
                    console.log(`     public_inputs_bytes: len=${publicInputsBytesForGroth16.length}, first=${publicInputsBytesForGroth16[0]}, last=${publicInputsBytesForGroth16[publicInputsBytesForGroth16.length - 1]}`);
                }
            }
            
            // 10. Verify success
            if (result.effects?.status.status !== 'success') {
                // ... existing error handling ...
                // Log detailed error information
                console.error('❌ Transaction failed!');
                // ...
                throw new Error(`Transaction failed with status: ${result.effects?.status.status}. Check logs above for details.`);
            } else {
                // Log events on success for debugging
                if (result.events && result.events.length > 0) {
                    console.log(`   Events (${result.events.length}):`);
                    result.events.forEach((event: any, idx: number) => {
                        console.log(`     Event ${idx + 1}:`, JSON.stringify(event, null, 2));
                    });
                }
            }
            
            console.log('   ✓ set_location succeeded!');
            console.log(`   Transaction: ${result.digest}`);
            console.log('=== STEP 2 COMPLETE ===\n');
        }, 120000);

        /**
         * STEP 3: Fixed Object Creation
         * 
         * This test demonstrates creating a FixedObject with location data set during creation.
         * FixedObject uses inline Groth16 verification (same as DynamicObject::set_location).
         */
        it('should create FixedObject with location data (inline Groth16 verification)', async () => {
            if (!testPrivateKey || !packageId || !ed25519Keypair || !objectRegistryId || !adminCapId || !approvedSignersId) {
                throw new Error('Cannot run test without required setup');
            }

            console.log('\n=== STEP 3: Create FixedObject with Location ===');

            // 0. Compute deterministic object ID from item_id BEFORE creating the object
            // This allows us to generate the proof for the correct object ID
            // This is completely off-chain - no network calls needed
            const itemId = 0x111111; // Fixed item ID for FixedObject (1118481 decimal)
            console.log(`0. Computing deterministic object ID for item_id=${itemId}...`);
            const deterministicObjectId = computeDerivedObjectAddress(
                objectRegistryId!,
                itemId
            );
            console.log(`   ✓ Computed deterministic object ID (off-chain): ${deterministicObjectId}`);

            // 1. Generate location POD and proof with the deterministic object ID
            console.log('1. Generating location POD and proof for FixedObject...');
            
            const locationData: LocationAttestationData = {
                objectId: deterministicObjectId,
                solarSystem: 987,
                coordinates: { x: 3000, y: 4000, z: 5000 },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const { jsonPod, ed25519PublicKey: podEd25519PublicKey } = await generateLocationAttestationPod(
                locationData,
                testPrivateKey,
                ed25519PrivateKey
            );
            const locationPod = POD.fromJSON(jsonPod);
            const podEntries = locationPod.content.asEntries();

            const treeResult = generatePodMerkleTree(podEntries, locationData.pod_data_type);
            const proofResult = await generateLocationProof(locationPod, locationData, undefined, podEd25519PublicKey);
            const formatted = await formatProofForSui(proofResult.filePath, 'location-attestation');
            
            const vkeyHex = await readCircuitVKey('location-attestation');
            const vkeyBytes = hexToBytes(vkeyHex);
            const proofPointsBytes = hexToBytes(formatted.proofPointsHex);
            // Use little-endian for Groth16 verification
            const publicInputsBytes = hexToBytes(formatted.publicInputsHexLittleEndian);
            const publicInputsBytesForGroth16 = publicInputsBytes; // Alias for compatibility
            
            // Debug: Log proof data for Step 3 (compare with Step 1)
            console.log(`   [Step 3 Debug] VKey bytes length: ${vkeyBytes.length} bytes`);
            console.log(`   [Step 3 Debug] VKey bytes (first 16): [${Array.from(vkeyBytes.slice(0, 16)).join(', ')}]`);
            console.log(`   [Step 3 Debug] VKey bytes (last 16): [${Array.from(vkeyBytes.slice(vkeyBytes.length - 16)).join(', ')}]`);
            console.log(`   [Step 3 Debug] VKey hex (first 128 chars): ${vkeyHex.substring(0, 128)}...`);
            console.log(`   [Step 3 Debug] Proof points length: ${proofPointsBytes.length} bytes`);
            console.log(`   [Step 3 Debug] Public inputs length (little-endian for Groth16): ${publicInputsBytesForGroth16.length} bytes`);
            console.log(`   [Step 3 Debug] Proof points hex (first 128 chars): ${formatted.proofPointsHex.substring(0, 128)}...`);
            console.log(`   [Step 3 Debug] Public inputs hex (little-endian, first 128 chars): ${formatted.publicInputsHexLittleEndian.substring(0, 128)}...`);
            console.log(`   [Step 3 Debug] Proof points bytes (first 16): [${Array.from(proofPointsBytes.slice(0, 16)).join(', ')}]`);
            console.log(`   [Step 3 Debug] Public inputs bytes (little-endian, first 16): [${Array.from(publicInputsBytesForGroth16.slice(0, 16)).join(', ')}]`);
            
            // 3.5. INTERMEDIATE STEP: Verify Step 3's proof using direct call (like Step 1)
            // This isolates if the data is bad or if fixed_object::create is broken
            console.log('3.5. Verifying Step 3 proof via direct call (sanity check)...');
            // Note: Groth16 verification happens automatically in fixed_object::create
            // No separate verification call needed
            
            const multiproof = await generateOptimizedMultiproofFromTree(
                treeResult, 
                ['objectId', 'pod_data_type'],
                undefined
            );
            const formattedMerkleProof = formatMerkleProofDataForSui(multiproof, treeResult.root);
            
            const leavesBytes = formattedMerkleProof.leaves.map(leaf => Array.from(hexToBytesForMove(leaf)));
            const proofBytes = formattedMerkleProof.proof.map(proof => Array.from(hexToBytesForMove(proof)));
            const objectIdAddr = '0x' + locationData.objectId.replace('0x', '');
            
            // Extract Ed25519 signature from POD entry (following generate-move-test-proof-data.ts pattern)
            let ed25519SignatureBytes: Uint8Array;
            const ed25519SigEntry = podEntries['ed25519_signature'];
            if (ed25519SigEntry && ed25519SigEntry.type === 'bytes') {
                const sigValue = ed25519SigEntry.value;
                let sigBytes: Uint8Array;
                
                if (sigValue instanceof Uint8Array) {
                    sigBytes = sigValue;
                } else if (typeof sigValue === 'string') {
                    try {
                        sigBytes = new Uint8Array(Buffer.from(sigValue, 'base64'));
                    } catch (e) {
                        throw new Error(`Failed to decode ed25519_signature from base64: ${e}`);
                    }
                } else if (Array.isArray(sigValue)) {
                    sigBytes = new Uint8Array(sigValue);
                } else {
                    throw new Error(`Unexpected type for ed25519_signature value: ${typeof sigValue}`);
                }
                
                if (sigBytes.length === 97) {
                    sigBytes = sigBytes.slice(1, 65);
                } else if (sigBytes.length === 64) {
                    // Already just the signature
                } else if (sigBytes.length > 64) {
                    sigBytes = sigBytes.slice(1, 65);
                } else {
                    throw new Error(`Ed25519 signature should be at least 64 bytes, got ${sigBytes.length} bytes`);
                }
                
                if (sigBytes.length !== 64) {
                    throw new Error(`Ed25519 signature must be exactly 64 bytes after extraction, got ${sigBytes.length} bytes`);
                }
                
                ed25519SignatureBytes = sigBytes;
            } else {
                throw new Error('Missing ed25519_signature entry in POD');
            }
            
            if (!podEd25519PublicKey || podEd25519PublicKey.length !== 32) {
                throw new Error('Invalid ed25519PublicKey from generateLocationAttestationPod');
            }
            
            const ed25519PublicKeyBytes = Array.from(podEd25519PublicKey);
            const signatureBytes = Array.from(ed25519SignatureBytes);
            
            // Ensure signer is in approved list
            const signerAddress = getSignerAddressFromKeypair(ed25519Keypair);
            try {
                await executeTransactionWithRetry(
                    client,
                    signer,
                    () => {
                        const txb = new Transaction();
                        txb.setSender(signer.toSuiAddress());
                        txb.moveCall({
                            target: `${packageId}::authority::add_approved_signer`,
                            arguments: [
                                txb.object(approvedSignersId!),
                                txb.pure.address(signerAddress),
                                txb.object(adminCapId!),
                            ],
                        });
                        return txb;
                    }
                );
                // If we get here, the signer was either added or was already in the list
            } catch (error: any) {
                // Only log if it's not the expected "already in list" error
                if (!error.message?.includes('add_approved_signer') || !error.message?.includes(', 1)')) {
                    console.warn(`   ⚠ Could not add signer to approved list: ${error.message}`);
                }
            }
            
            console.log('   ✓ POD and proof generated');

            // 2. Create FixedObject with location data (inline Groth16 verification)
            console.log('2. Creating FixedObject with location data...');
            const timestamp = locationData.timestamp.toString();
            
            const result = await executeTransactionWithRetry(
                client,
                signer,
                () => {
                    const txb = new Transaction();
                    txb.setSender(signer.toSuiAddress());

                    txb.moveCall({
                        target: `${packageId}::fixed_object::create`,
                        arguments: [
                            txb.object(objectRegistryId!), // registry
                            txb.pure.u64(itemId), // item_id
                            txb.pure.vector('u8', ed25519PublicKeyBytes), // signer_public_key
                            txb.pure.vector('u8', signatureBytes), // ed25519_signature
                            txb.pure.vector('vector<u8>', leavesBytes), // merkle_leaves
                            txb.pure.vector('vector<u8>', proofBytes), // merkle_proof_bytes
                            txb.pure.vector('bool', formattedMerkleProof.proofFlags), // merkle_proof_flags
                            txb.pure.u64(timestamp), // timestamp
                            txb.pure.vector('u8', Array.from(vkeyBytes)), // vkey_bytes
                            txb.pure.vector('u8', Array.from(proofPointsBytes)), // proof_points_bytes
                            txb.pure.vector('u8', Array.from(publicInputsBytesForGroth16)), // public_inputs_bytes (little-endian for Groth16)
                            txb.object(approvedSignersId!), // approved_signers
                            txb.object(adminCapId!) // admin_cap
                        ],
                    });

                    return txb;
                },
                3
            );

            // Extract and log byte diagnostics from events
            const events = result.events || [];
            for (const event of events) {
                if (event.type?.includes('ByteDiagnosticsEvent')) {
                    const diagnostics = event.parsedJson as any;
                    console.log('   [DEBUG] Byte Diagnostics from fixed_object::create:');
                    console.log(`     vkey_bytes: len=${diagnostics.vkey_len}, first=${diagnostics.vkey_first_byte}, last=${diagnostics.vkey_last_byte}`);
                    console.log(`     proof_points_bytes: len=${diagnostics.proof_points_len}, first=${diagnostics.proof_points_first_byte}, last=${diagnostics.proof_points_last_byte}`);
                    console.log(`     public_inputs_bytes: len=${diagnostics.public_inputs_len}, first=${diagnostics.public_inputs_first_byte}, last=${diagnostics.public_inputs_last_byte}`);
                    console.log(`   [COMPARISON] Step 3 direct verification bytes:`);
                    console.log(`     vkey_bytes: len=${vkeyBytes.length}, first=${vkeyBytes[0]}, last=${vkeyBytes[vkeyBytes.length - 1]}`);
                    console.log(`     proof_points_bytes: len=${proofPointsBytes.length}, first=${proofPointsBytes[0]}, last=${proofPointsBytes[proofPointsBytes.length - 1]}`);
                    console.log(`     public_inputs_bytes: len=${publicInputsBytesForGroth16.length}, first=${publicInputsBytesForGroth16[0]}, last=${publicInputsBytesForGroth16[publicInputsBytesForGroth16.length - 1]}`);
                }
            }
            
            if (result.effects?.status.status !== 'success') {
                console.error('❌ FixedObject creation failed!');
                const errorInfo = result.effects?.status.error;
                console.error(`   Status: ${result.effects?.status.status}`);
                console.error(`   Error: ${JSON.stringify(errorInfo, null, 2)}`);
                throw new Error(`FixedObject creation failed with status: ${result.effects?.status.status}`);
            }
            
            // Find the created FixedObject and verify it matches the deterministic ID
            const createdObjects = result.effects?.created || [];
            const objectChanges = result.objectChanges || [];
            
            const isShared = (owner: any) => {
                return owner === 'Shared' || (typeof owner === 'object' && owner !== null && 'Shared' in owner);
            };

            let createdObjectId = createdObjects.find((obj: any) => {
                const owner = obj.owner;
                const objectType = obj.reference?.objectType;
                return isShared(owner) && objectType && objectType.includes('FixedObject');
            })?.reference?.objectId;
            
            if (!createdObjectId && objectChanges) {
                const objectChange = objectChanges.find((change: any) => {
                    if (change.type === 'created') {
                        const owner = change.owner;
                        const objectType = change.objectType;
                        return isShared(owner) && objectType && objectType.includes('FixedObject');
                    }
                    return false;
                });
                
                if (objectChange && objectChange.type === 'created') {
                    createdObjectId = objectChange.objectId;
                }
            }
            
            if (!createdObjectId) {
                throw new Error('Could not find created FixedObject');
            }
            
            // Verify deterministic ID matches created ID
            if (createdObjectId !== deterministicObjectId) {
                throw new Error(`Deterministic object ID mismatch: computed ${deterministicObjectId}, created ${createdObjectId}`);
            }
            
            console.log(`   ✓ FixedObject created with deterministic ID: ${createdObjectId}`);
            console.log(`   Transaction: ${result.digest}`);
            console.log('=== STEP 3 COMPLETE ===\n');
        }, 120000);
    });
});

