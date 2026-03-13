import path from 'path';
import fs from 'fs/promises';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { generateLocationAttestationPod } from '../../../src/shared/pods/utils/generateLocationAttestationPod';
import { generateLocationProof } from '../../../src/on-chain/proofs/utils/generateLocationProof';
import { generateDistanceProof } from '../../../src/on-chain/proofs/utils/generateDistanceProof';
import { formatProofForSui, readCircuitVKey } from '../../../src/on-chain/utils/formatProofForSui';
import { POD } from '@pcd/pod';
import { LocationAttestationData } from '../../../src/shared/types/locationType';
import { DistanceAttestationData } from '../../../src/shared/types/distanceType';
import { generatePodMerkleTree } from '../../../src/shared/merkle/utils/podMerkleUtils';
import { generateOptimizedMultiproofFromTree } from '../../../src/shared/merkle/utils/generateMerkleMultiproof';
import { formatMerkleProofDataForSui } from '../../../src/on-chain/utils/formatMerkleProofForSui';
import { deriveObjectID } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import crypto from 'crypto';
import { setupTestEnvironment } from './shared/testSetup';

// Helper to compute Sui address from Ed25519 public key (matches Move code)
function getSignerAddressFromKeypair(keypair: Ed25519Keypair): string {
    return keypair.toSuiAddress();
}

// Helper to compute deterministic object address from registry ID and item_id
function computeDerivedObjectAddress(
    registryId: string,
    itemId: number
): string {
    const keyTypeTag = 'u64';
    const keyBytes = new Uint8Array(8);
    const view = new DataView(keyBytes.buffer);
    view.setBigUint64(0, BigInt(itemId), true); // true = little-endian (BCS encoding)
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

// Improved transaction execution with retry logic
async function executeTransactionWithRetry(
    client: SuiClient,
    signer: Ed25519Keypair,
    buildTransaction: () => Transaction,
    maxRetries: number = 3
): Promise<Awaited<ReturnType<typeof client.executeTransactionBlock>>> {
    let retries = maxRetries;
    let lastError: Error | null = null;
    
    while (retries > 0) {
        try {
            if (retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            const txb = buildTransaction();
            txb.setSender(signer.toSuiAddress());
            const builtBlock = await txb.build({ client });
            const signedBlock = await signer.signTransaction(builtBlock);
            
            const result = await Promise.race([
                client.executeTransactionBlock({
                    transactionBlock: signedBlock.bytes,
                    signature: signedBlock.signature,
                    options: {
                        showEffects: true,
                        showEvents: true,
                        showObjectChanges: true,
                    },
                }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Transaction timeout after 10s')), 10000)
                )
            ]) as Awaited<ReturnType<typeof client.executeTransactionBlock>>;
            
            if (!result.digest) {
                throw new Error('Transaction execution returned no digest');
            }
            
            return result;
        } catch (error: any) {
            lastError = error;
            const errorMsg = error.message || JSON.stringify(error);
            const isVersionError = 
                errorMsg.includes('not available for consumption') || 
                errorMsg.includes('current version') ||
                errorMsg.includes('Version') ||
                errorMsg.includes('Transaction validator signing failed') ||
                errorMsg.includes('Transaction is rejected');
            const isTimeout = errorMsg.includes('timeout');
            
            if ((isVersionError || isTimeout) && retries > 1) {
                retries--;
                console.log(`⚠ ${isTimeout ? 'Timeout' : 'Version error'} detected, retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
            throw error;
        }
    }
    
    throw lastError || new Error('Transaction failed after retries');
}

describe('Distance Attestation Step-by-Step Integration Tests', () => {
    let client: SuiClient;
    let signer: Ed25519Keypair;
    let testPrivateKey: string;
    let ed25519PrivateKey: string;
    let ed25519Keypair: Ed25519Keypair;
    let packageId: string | undefined;
    let publishTransactionDigest: string | undefined;
    let objectRegistryId: string | undefined;
    let adminCapId: string | undefined;
    let approvedSignersId: string | undefined;
    const generatedFiles: string[] = [];
    
    // Store Step 1 data in memory (not in outputs folder - only standard formats go there)
    let step1LocationData1: LocationAttestationData | undefined;
    let step1LocationData2: LocationAttestationData | undefined;
    let step1Proof1Result: any | undefined;
    let step1Proof2Result: any | undefined;
    let step1Formatted1: any | undefined;
    let step1Formatted2: any | undefined;
    let step1FormattedMerkleProof1: any | undefined;
    let step1FormattedMerkleProof2: any | undefined;
    let step1Ed25519PublicKeyBytes1: number[] | undefined;
    let step1Ed25519PublicKeyBytes2: number[] | undefined;
    let step1Signature1Bytes: number[] | undefined;
    let step1Signature2Bytes: number[] | undefined;

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
            // Use toSuiAddress() to get the POD signer's Sui address
            // This is the address that signs PODs and needs to be in the approved list
            const podSignerAddr = ed25519Keypair.toSuiAddress();
            console.log(`Adding POD signer to approved list: ${podSignerAddr}`);
            
            // Try to add signer - if it fails with error code 1, signer is already in list (that's fine)
            let signerAddedInBeforeAll = false;
            try {
                const addSignerResult = await executeTransactionWithRetry(
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
                );
                
                // Check if the transaction succeeded
                const status = addSignerResult.effects?.status.status;
                if (status === 'success') {
                    console.log(`✓ Successfully added POD signer (Ed25519) to approved signers: ${podSignerAddr}`);
                    signerAddedInBeforeAll = true;
                } else {
                    // Transaction failed - check error message
                    const errorMsg = addSignerResult.effects?.status.error;
                    if (errorMsg) {
                        // Error code 1 means signer is already in list (that's fine)
                        const errorStr = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
                        if (errorStr.includes('error code 1') || errorStr.includes(', 1)') || errorStr.includes('}, 1)')) {
                            console.log(`✓ Signer is already in approved list (error code 1): ${podSignerAddr}`);
                            signerAddedInBeforeAll = true; // Consider it "added" if already exists
                        } else {
                            console.warn(`⚠ Signer addition failed in beforeAll: ${errorStr}`);
                        }
                    } else {
                        console.warn(`⚠ Signer addition failed with unknown error: ${status}`);
                    }
                }
            } catch (error: any) {
                // If transaction fails during execution, log it
                console.warn(`⚠ Could not add POD signer to approved list in beforeAll: ${error.message}`);
            }
            
            if (!signerAddedInBeforeAll) {
                console.warn(`⚠ WARNING: Could not confirm signer is in approved list in beforeAll. Will try again in Step 1.`);
            }
        } else {
            console.warn(`⚠ Cannot add POD signer: missing required setup (approvedSignersId=${approvedSignersId}, adminCapId=${adminCapId}, packageId=${packageId})`);
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
            path.join(process.cwd(), 'outputs', 'proofs', 'on-chain', 'distance-attestation'),
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
     * STEP 1: Create two FixedObjects with location data
     * 
     * This test creates two FixedObjects with location data using fixed_object::create,
     * which performs inline Groth16 verification and stores location data.
     */
    describe('Step 1: Create FixedObjects with Location Data', () => {
        it('should create two FixedObjects with location data (inline ZK verification)', async () => {
            if (!testPrivateKey || !packageId || !ed25519Keypair || !objectRegistryId || !approvedSignersId) {
                throw new Error('Cannot run test without required setup');
            }

            console.log('\n=== STEP 1: Create Two FixedObjects with Location Data ===');

            // Item IDs for the two objects
            const itemId1 = 0x111111; // Fixed object 1
            const itemId2 = 0x111112; // Fixed object 2

            // Compute deterministic object IDs
            console.log('0. Computing deterministic object IDs...');
            const deterministicObjectId1 = computeDerivedObjectAddress(objectRegistryId!, itemId1);
            const deterministicObjectId2 = computeDerivedObjectAddress(objectRegistryId!, itemId2);
            console.log(`   ✓ Object 1 ID: ${deterministicObjectId1}`);
            console.log(`   ✓ Object 2 ID: ${deterministicObjectId2}`);

            // Generate location PODs for both objects
            console.log('1. Generating location PODs...');
            const locationData1: LocationAttestationData = {
                objectId: deterministicObjectId1,
                solarSystem: 987,
                coordinates: { x: 1000, y: 2000, z: 3000 },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now()),
                salt: generateSalt()
            };

            const locationData2: LocationAttestationData = {
                objectId: deterministicObjectId2,
                solarSystem: 987,
                coordinates: { x: 2000, y: 3000, z: 4000 },
                pod_data_type: 'evefrontier.location_attestation',
                timestamp: BigInt(Date.now() + 1000),
                salt: generateSalt()
            };

            const { jsonPod: pod1Json, filePath: pod1FilePath, ed25519PublicKey: podEd25519PublicKey1 } = await generateLocationAttestationPod(
                locationData1,
                testPrivateKey,
                ed25519PrivateKey
            );
            const { jsonPod: pod2Json, filePath: pod2FilePath, ed25519PublicKey: podEd25519PublicKey2 } = await generateLocationAttestationPod(
                locationData2,
                testPrivateKey,
                ed25519PrivateKey
            );
            generatedFiles.push(pod1FilePath, pod2FilePath);
            const locationPod1 = POD.fromJSON(pod1Json);
            const locationPod2 = POD.fromJSON(pod2Json);
            const pod1Entries = locationPod1.content.asEntries();
            const pod2Entries = locationPod2.content.asEntries();
            console.log('   ✓ Location PODs generated');

            // Generate location ZK proofs
            // IMPORTANT: Pass the ed25519PublicKey from POD generation to ensure consistency
            console.log('2. Generating location ZK proofs...');
            const proof1Result = await generateLocationProof(locationPod1, locationData1, undefined, podEd25519PublicKey1);
            const proof2Result = await generateLocationProof(locationPod2, locationData2, undefined, podEd25519PublicKey2);
            generatedFiles.push(proof1Result.filePath, proof2Result.filePath);
            if (proof1Result.inputFilePath) generatedFiles.push(proof1Result.inputFilePath);
            if (proof2Result.inputFilePath) generatedFiles.push(proof2Result.inputFilePath);
            console.log('   ✓ Location ZK proofs generated');

            // Format proofs for Sui
            console.log('3. Formatting proofs for Sui...');
            const formatted1 = await formatProofForSui(proof1Result.filePath, 'location-attestation');
            const formatted2 = await formatProofForSui(proof2Result.filePath, 'location-attestation');
            console.log('   ✓ Proofs formatted for Sui');

            // Generate Merkle trees and multiproofs
            console.log('4. Generating Merkle multiproofs...');
            const tree1Result = generatePodMerkleTree(pod1Entries, locationData1.pod_data_type);
            const tree2Result = generatePodMerkleTree(pod2Entries, locationData2.pod_data_type);
            
            const multiproof1FilePath = path.join(process.cwd(), 'outputs', 'merkle', 'multiproofs', `${locationData1.timestamp}_${locationData1.objectId}_multiproof.json`);
            const multiproof2FilePath = path.join(process.cwd(), 'outputs', 'merkle', 'multiproofs', `${locationData2.timestamp}_${locationData2.objectId}_multiproof.json`);
            generatedFiles.push(multiproof1FilePath, multiproof2FilePath);
            
            const multiproof1 = await generateOptimizedMultiproofFromTree(tree1Result, ['objectId', 'pod_data_type'], multiproof1FilePath);
            const multiproof2 = await generateOptimizedMultiproofFromTree(tree2Result, ['objectId', 'pod_data_type'], multiproof2FilePath);
            
            const formattedMerkleProof1 = formatMerkleProofDataForSui(multiproof1, tree1Result.root);
            const formattedMerkleProof2 = formatMerkleProofDataForSui(multiproof2, tree2Result.root);
            console.log('   ✓ Merkle multiproofs generated');

            // Extract Ed25519 signature and public key from PODs (following location test pattern)
            let ed25519SignatureBytes1: Uint8Array;
            const ed25519SigEntry1 = pod1Entries['ed25519_signature'];
            if (ed25519SigEntry1 && ed25519SigEntry1.type === 'bytes') {
                const sigValue1 = ed25519SigEntry1.value;
                let sigBytes1: Uint8Array;
                
                if (sigValue1 instanceof Uint8Array) {
                    sigBytes1 = sigValue1;
                } else if (typeof sigValue1 === 'string') {
                    try {
                        sigBytes1 = new Uint8Array(Buffer.from(sigValue1, 'base64'));
                    } catch (e) {
                        throw new Error(`Failed to decode ed25519_signature from base64: ${e}`);
                    }
                } else if (Array.isArray(sigValue1)) {
                    sigBytes1 = new Uint8Array(sigValue1);
                } else {
                    throw new Error(`Unexpected type for ed25519_signature value: ${typeof sigValue1}`);
                }
                
                if (sigBytes1.length === 97) {
                    sigBytes1 = sigBytes1.slice(1, 65);
                } else if (sigBytes1.length === 64) {
                    // Already just the signature
                } else if (sigBytes1.length > 64) {
                    sigBytes1 = sigBytes1.slice(1, 65);
                } else {
                    throw new Error(`Ed25519 signature should be at least 64 bytes, got ${sigBytes1.length} bytes`);
                }
                
                if (sigBytes1.length !== 64) {
                    throw new Error(`Ed25519 signature must be exactly 64 bytes after extraction, got ${sigBytes1.length} bytes`);
                }
                
                ed25519SignatureBytes1 = sigBytes1;
            } else {
                throw new Error('Missing ed25519_signature entry in POD 1');
            }

            let ed25519SignatureBytes2: Uint8Array;
            const ed25519SigEntry2 = pod2Entries['ed25519_signature'];
            if (ed25519SigEntry2 && ed25519SigEntry2.type === 'bytes') {
                const sigValue2 = ed25519SigEntry2.value;
                let sigBytes2: Uint8Array;
                
                if (sigValue2 instanceof Uint8Array) {
                    sigBytes2 = sigValue2;
                } else if (typeof sigValue2 === 'string') {
                    try {
                        sigBytes2 = new Uint8Array(Buffer.from(sigValue2, 'base64'));
                    } catch (e) {
                        throw new Error(`Failed to decode ed25519_signature from base64: ${e}`);
                    }
                } else if (Array.isArray(sigValue2)) {
                    sigBytes2 = new Uint8Array(sigValue2);
                } else {
                    throw new Error(`Unexpected type for ed25519_signature value: ${typeof sigValue2}`);
                }
                
                if (sigBytes2.length === 97) {
                    sigBytes2 = sigBytes2.slice(1, 65);
                } else if (sigBytes2.length === 64) {
                    // Already just the signature
                } else if (sigBytes2.length > 64) {
                    sigBytes2 = sigBytes2.slice(1, 65);
                } else {
                    throw new Error(`Ed25519 signature should be at least 64 bytes, got ${sigBytes2.length} bytes`);
                }
                
                if (sigBytes2.length !== 64) {
                    throw new Error(`Ed25519 signature must be exactly 64 bytes after extraction, got ${sigBytes2.length} bytes`);
                }
                
                ed25519SignatureBytes2 = sigBytes2;
            } else {
                throw new Error('Missing ed25519_signature entry in POD 2');
            }
            
            if (!podEd25519PublicKey1 || podEd25519PublicKey1.length !== 32) {
                throw new Error('Invalid ed25519PublicKey from generateLocationAttestationPod for POD 1');
            }
            if (!podEd25519PublicKey2 || podEd25519PublicKey2.length !== 32) {
                throw new Error('Invalid ed25519PublicKey from generateLocationAttestationPod for POD 2');
            }
            
            // Verify public keys match the keypair (same as location test)
            const keypairPublicKey = ed25519Keypair.getPublicKey().toRawBytes();
            if (Buffer.from(keypairPublicKey).compare(Buffer.from(podEd25519PublicKey1)) !== 0) {
                throw new Error('Public key mismatch: keypair public key does not match POD 1 public key');
            }
            if (Buffer.from(keypairPublicKey).compare(Buffer.from(podEd25519PublicKey2)) !== 0) {
                throw new Error('Public key mismatch: keypair public key does not match POD 2 public key');
            }
            
            const ed25519PublicKeyBytes1 = Array.from(podEd25519PublicKey1);
            const ed25519PublicKeyBytes2 = Array.from(podEd25519PublicKey2);
            const signature1Bytes = Array.from(ed25519SignatureBytes1);
            const signature2Bytes = Array.from(ed25519SignatureBytes2);
            
            console.log(`   ✓ Verified public keys match keypair (both PODs use same keypair)`);
            console.log(`   ✓ Extracted Ed25519 signatures (64 bytes each) and public keys (32 bytes each)`);

            // Ensure signer is in approved list BEFORE creating objects (same as location test)
            const signerAddress = getSignerAddressFromKeypair(ed25519Keypair);
            console.log(`   ✓ Signer address: ${signerAddress}`);
            
            // Ensure this signer is in the approved list (add if not already there)
            // This is critical - the signer MUST be in the approved list before creating objects
            if (!approvedSignersId || !adminCapId || !packageId) {
                throw new Error(`Missing required setup: approvedSignersId=${approvedSignersId}, adminCapId=${adminCapId}, packageId=${packageId}`);
            }
            
            // Try to add signer - if it fails with error code 1, signer is already in list (that's fine)
            // If it fails for any other reason, we need to investigate
            let signerAdded = false;
            try {
                const addSignerResult = await executeTransactionWithRetry(
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
                
                // Check if the transaction succeeded
                const status = addSignerResult.effects?.status.status;
                if (status === 'success') {
                    console.log(`   ✓ Successfully added signer to approved list: ${signerAddress}`);
                    signerAdded = true;
                } else {
                    // Transaction failed - check error message
                    const errorMsg = addSignerResult.effects?.status.error;
                    if (errorMsg) {
                        // Error code 1 means signer is already in list (that's fine)
                        // The error message format is usually "MoveAbort(..., CODE)" where CODE is the error code
                        const errorStr = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
                        if (errorStr.includes('error code 1') || errorStr.includes(', 1)') || errorStr.includes('}, 1)')) {
                            console.log(`   ✓ Signer is already in approved list (error code 1): ${signerAddress}`);
                            signerAdded = true; // Consider it "added" if already exists
                        } else {
                            console.warn(`   ⚠ Signer addition failed: ${errorStr}`);
                            // Continue anyway - will fail on object creation if signer is not in list
                        }
                    } else {
                        console.warn(`   ⚠ Signer addition failed with unknown error: ${status}`);
                    }
                }
            } catch (error: any) {
                // If transaction fails during execution, log it but continue
                // The object creation will fail if signer is not actually in the list
                console.log(`   Note: Signer addition transaction failed: ${error.message}`);
                console.log(`   Continuing - if signer is not in list, object creation will fail with E_UNAUTHORIZED`);
            }
            
            if (!signerAdded) {
                console.warn(`   ⚠ WARNING: Could not confirm signer is in approved list.`);
                console.warn(`   Signer address: ${signerAddress}`);
                console.warn(`   This may cause object creation to fail with E_UNAUTHORIZED (error code 10).`);
                console.warn(`   Attempting object creation anyway...`);
            } else {
                console.log(`   ✓ Confirmed signer is in approved list: ${signerAddress}`);
            }
            
            // Small delay to ensure transaction has propagated (if signer was just added)
            if (signerAdded) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            console.log(`   ✓ Proceeding with object creation`);

            // Create FixedObjects with location data
            console.log('5. Creating FixedObjects with location data...');
            const leavesBytes1 = formattedMerkleProof1.leaves.map(leaf => Array.from(hexToBytes(leaf)));
            const proofBytes1 = formattedMerkleProof1.proof.map(proof => Array.from(hexToBytes(proof)));
            const vkeyBytes1 = hexToBytes(formatted1.vkeyHex);
            const proofPointsBytes1 = hexToBytes(formatted1.proofPointsHex);
            const publicInputsBytes1 = hexToBytes(formatted1.publicInputsHexLittleEndian); // little-endian for Groth16 verification
            const timestamp1 = locationData1.timestamp.toString();
            
            const create1Result = await executeTransactionWithRetry(
                client,
                signer,
                () => {
                    const txb = new Transaction();
                    txb.setSender(signer.toSuiAddress());
                    txb.moveCall({
                        target: `${packageId}::fixed_object::create`,
                        arguments: [
                            txb.object(objectRegistryId!), // registry
                            txb.pure.u64(itemId1), // item_id
                            txb.pure.vector('u8', ed25519PublicKeyBytes1), // signer_public_key
                            txb.pure.vector('u8', signature1Bytes), // ed25519_signature
                            txb.pure.vector('vector<u8>', leavesBytes1), // merkle_leaves
                            txb.pure.vector('vector<u8>', proofBytes1), // merkle_proof_bytes
                            txb.pure.vector('bool', formattedMerkleProof1.proofFlags), // merkle_proof_flags
                            txb.pure.u64(timestamp1), // timestamp
                            txb.pure.vector('u8', Array.from(vkeyBytes1)), // vkey_bytes
                            txb.pure.vector('u8', Array.from(proofPointsBytes1)), // proof_points_bytes
                            txb.pure.vector('u8', Array.from(publicInputsBytes1)), // public_inputs_bytes
                            txb.object(approvedSignersId!), // approved_signers
                            txb.object(adminCapId!) // admin_cap
                        ],
                    });
                    return txb;
                }
            );

            expect(create1Result.effects?.status.status).toBe('success');
            
            // Find the created FixedObject (check both effects?.created and objectChanges)
            const createdObjects1 = create1Result.effects?.created || [];
            const objectChanges1 = create1Result.objectChanges || [];
            
            const isShared = (owner: any) => {
                return owner === 'Shared' || (typeof owner === 'object' && owner !== null && 'Shared' in owner);
            };
            
            let createdObject1Id = createdObjects1.find((obj: any) => {
                const owner = obj.owner;
                const objectType = obj.reference?.objectType;
                return isShared(owner) && objectType && objectType.includes('FixedObject');
            })?.reference?.objectId;
            
            if (!createdObject1Id && objectChanges1) {
                const objectChange = objectChanges1.find((change: any) => {
                    if (change.type === 'created') {
                        const owner = change.owner;
                        const objectType = change.objectType;
                        return isShared(owner) && objectType && objectType.includes('FixedObject');
                    }
                    return false;
                });
                
                if (objectChange && objectChange.type === 'created') {
                    createdObject1Id = objectChange.objectId;
                }
            }
            
            console.log(`   ✓ FixedObject 1 created: ${createdObject1Id}`);

            const leavesBytes2 = formattedMerkleProof2.leaves.map(leaf => Array.from(hexToBytes(leaf)));
            const proofBytes2 = formattedMerkleProof2.proof.map(proof => Array.from(hexToBytes(proof)));
            const vkeyBytes2 = hexToBytes(formatted2.vkeyHex);
            const proofPointsBytes2 = hexToBytes(formatted2.proofPointsHex);
            const publicInputsBytes2 = hexToBytes(formatted2.publicInputsHexLittleEndian); // little-endian for Groth16 verification
            const timestamp2 = locationData2.timestamp.toString();
            
            const create2Result = await executeTransactionWithRetry(
                client,
                signer,
                () => {
                    const txb = new Transaction();
                    txb.setSender(signer.toSuiAddress());
                    txb.moveCall({
                        target: `${packageId}::fixed_object::create`,
                        arguments: [
                            txb.object(objectRegistryId!), // registry
                            txb.pure.u64(itemId2), // item_id
                            txb.pure.vector('u8', ed25519PublicKeyBytes2), // signer_public_key
                            txb.pure.vector('u8', signature2Bytes), // ed25519_signature
                            txb.pure.vector('vector<u8>', leavesBytes2), // merkle_leaves
                            txb.pure.vector('vector<u8>', proofBytes2), // merkle_proof_bytes
                            txb.pure.vector('bool', formattedMerkleProof2.proofFlags), // merkle_proof_flags
                            txb.pure.u64(timestamp2), // timestamp
                            txb.pure.vector('u8', Array.from(vkeyBytes2)), // vkey_bytes
                            txb.pure.vector('u8', Array.from(proofPointsBytes2)), // proof_points_bytes
                            txb.pure.vector('u8', Array.from(publicInputsBytes2)), // public_inputs_bytes
                            txb.object(approvedSignersId!), // approved_signers
                            txb.object(adminCapId!) // admin_cap
                        ],
                    });
                    return txb;
                }
            );

            expect(create2Result.effects?.status.status).toBe('success');
            
            // Find the created FixedObject (check both effects?.created and objectChanges)
            const createdObjects2 = create2Result.effects?.created || [];
            const objectChanges2 = create2Result.objectChanges || [];
            
            let createdObject2Id = createdObjects2.find((obj: any) => {
                const owner = obj.owner;
                const objectType = obj.reference?.objectType;
                return isShared(owner) && objectType && objectType.includes('FixedObject');
            })?.reference?.objectId;
            
            if (!createdObject2Id && objectChanges2) {
                const objectChange = objectChanges2.find((change: any) => {
                    if (change.type === 'created') {
                        const owner = change.owner;
                        const objectType = change.objectType;
                        return isShared(owner) && objectType && objectType.includes('FixedObject');
                    }
                    return false;
                });
                
                if (objectChange && objectChange.type === 'created') {
                    createdObject2Id = objectChange.objectId;
                }
            }
            
            console.log(`   ✓ FixedObject 2 created: ${createdObject2Id}`);

            // Verify objects exist and have correct IDs
            expect(createdObject1Id).toBe(deterministicObjectId1);
            expect(createdObject2Id).toBe(deterministicObjectId2);
            
            // Wait a bit to ensure registry state has propagated
            console.log('5.5. Waiting for registry state to propagate after object creation...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('   ✓ Registry state should be ready');
            
            // Store all data for Step 2 in memory (not in outputs folder - only standard formats go there)
            step1LocationData1 = locationData1;
            step1LocationData2 = locationData2;
            step1Proof1Result = proof1Result;
            step1Proof2Result = proof2Result;
            step1Formatted1 = formatted1;
            step1Formatted2 = formatted2;
            step1FormattedMerkleProof1 = formattedMerkleProof1;
            step1FormattedMerkleProof2 = formattedMerkleProof2;
            step1Ed25519PublicKeyBytes1 = ed25519PublicKeyBytes1;
            step1Ed25519PublicKeyBytes2 = ed25519PublicKeyBytes2;
            step1Signature1Bytes = signature1Bytes;
            step1Signature2Bytes = signature2Bytes;
            
            console.log('=== STEP 1 COMPLETE ===\n');
        }, 180000);
    });

    /**
     * STEP 2: Generate distance proof and verify via inventory::transfer
     * 
     * This test generates a distance proof between the two objects and calls
     * inventory::transfer, which performs inline Groth16 verification and
     * stores distance data in the registry.
     */
    describe('Step 2: Distance Attestation Verification', () => {
        it('should generate distance proof and verify via inventory::transfer (inline ZK verification)', async () => {
            if (!testPrivateKey || !packageId || !objectRegistryId) {
                throw new Error('Cannot run test without required setup');
            }

            console.log('\n=== STEP 2: Distance Attestation Verification ===');

            // Use location data from Step 1 (stored in memory)
            if (!step1LocationData1 || !step1LocationData2 || !step1Proof1Result || !step1Proof2Result) {
                throw new Error('Step 1 location data not available. Step 1 must run before Step 2.');
            }
            
            const locationData1 = step1LocationData1;
            const locationData2 = step1LocationData2;
            const proof1Result = step1Proof1Result;
            const proof2Result = step1Proof2Result;
            
            const deterministicObjectId1 = locationData1.objectId;
            const deterministicObjectId2 = locationData2.objectId;
            
            // Reuse all formatted data from Step 1
            if (!step1Formatted1 || !step1Formatted2 || !step1FormattedMerkleProof1 || !step1FormattedMerkleProof2 ||
                !step1Ed25519PublicKeyBytes1 || !step1Ed25519PublicKeyBytes2 || 
                !step1Signature1Bytes || !step1Signature2Bytes) {
                throw new Error('Step 1 data not available. Step 1 must run before Step 2.');
            }
            
            const formatted1 = step1Formatted1;
            const formatted2 = step1Formatted2;
            const formattedMerkleProof1 = step1FormattedMerkleProof1;
            const formattedMerkleProof2 = step1FormattedMerkleProof2;
            const ed25519PublicKeyBytes1 = step1Ed25519PublicKeyBytes1;
            const ed25519PublicKeyBytes2 = step1Ed25519PublicKeyBytes2;
            const signature1Bytes = step1Signature1Bytes;
            const signature2Bytes = step1Signature2Bytes;
            
            console.log('   ✓ Using location data and proofs from Step 1 (same timestamps as stored on-chain)');
            console.log(`   Object 1 ID: ${deterministicObjectId1}`);
            console.log(`   Object 2 ID: ${deterministicObjectId2}`);
            console.log(`   Location 1 timestamp: ${locationData1.timestamp}`);
            console.log(`   Location 2 timestamp: ${locationData2.timestamp}`);
            console.log(`   Max timestamp (for distance proof): ${locationData1.timestamp > locationData2.timestamp ? locationData1.timestamp : locationData2.timestamp}`);

            // Objects should already exist from Step 1
            console.log('   Note: Objects should already exist from Step 1. Using deterministic IDs.');
            console.log('✓ Both FixedObjects ready (created in Step 1)');

            // Now generate distance proof
            console.log('1. Generating distance proof...');
            const locationMerkleRoot1 = proof1Result.publicSignals[0]!;
            const locationMerkleRoot2 = proof2Result.publicSignals[0]!;
            const coordinatesHash1 = proof1Result.publicSignals[1]!;
            const coordinatesHash2 = proof2Result.publicSignals[1]!;

            // Calculate distance squared (Manhattan distance)
            const dx = Math.abs(locationData1.coordinates.x - locationData2.coordinates.x);
            const dy = Math.abs(locationData1.coordinates.y - locationData2.coordinates.y);
            const dz = Math.abs(locationData1.coordinates.z - locationData2.coordinates.z);
            const distance = dx + dy + dz;
            const distanceSquared = BigInt(distance * distance);

            const distanceData: DistanceAttestationData = {
                objectId1: deterministicObjectId1,
                objectId2: deterministicObjectId2,
                objectLocation1: locationMerkleRoot1,
                objectLocation2: locationMerkleRoot2,
                distanceSquaredMeters: distanceSquared,
                pod_data_type: 'evefrontier.distance_attestation',
                timestamp: BigInt(Date.now())
            };

            const distanceProofResult = await generateDistanceProof(
                distanceData,
                locationData1,
                locationData2,
                proof1Result,
                proof2Result,
                locationMerkleRoot1,
                locationMerkleRoot2,
                coordinatesHash1,
                coordinatesHash2
            );
            generatedFiles.push(distanceProofResult.filePath);
            if (distanceProofResult.inputFilePath) {
                generatedFiles.push(distanceProofResult.inputFilePath);
            }
            console.log('   ✓ Distance proof generated');

            // Format distance proof for Sui
            console.log('2. Formatting distance proof for Sui...');
            const formattedDistance = await formatProofForSui(distanceProofResult.filePath, 'distance-attestation');
            console.log('   ✓ Distance proof formatted for Sui');

            // Wait a bit to ensure registry state has propagated after Step 1 object creation
            console.log('2.5. Waiting for registry state to propagate...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Increased wait time
            console.log('   ✓ Registry state should be ready');

            // Verify objects exist and log their addresses for debugging
            console.log('2.6. Verifying objects exist...');
            try {
                const obj1 = await client.getObject({
                    id: deterministicObjectId1,
                    options: { showContent: false, showOwner: true }
                });
                const obj2 = await client.getObject({
                    id: deterministicObjectId2,
                    options: { showContent: false, showOwner: true }
                });
                console.log(`   ✓ Object 1 exists: ${deterministicObjectId1} (version: ${obj1.data?.version})`);
                console.log(`   ✓ Object 2 exists: ${deterministicObjectId2} (version: ${obj2.data?.version})`);
                console.log(`   Using object addresses for distance verification:`);
                console.log(`     object_id1: ${deterministicObjectId1}`);
                console.log(`     object_id2: ${deterministicObjectId2}`);
            } catch (error: any) {
                console.error(`   ⚠ Error checking objects: ${error.message}`);
                throw new Error(`Objects may not exist or be accessible: ${error.message}`);
            }

            // Call inventory::transfer to verify distance attestation
            console.log('3. Verifying distance attestation via inventory::transfer...');
            const transferResult = await executeTransactionWithRetry(
                client,
                signer,
                () => {
                    const txb = new Transaction();
                    txb.setSender(signer.toSuiAddress());
                    txb.setGasBudget(1000000000); // Set explicit gas budget
                    txb.moveCall({
                        target: `${packageId}::inventory::transfer`,
                        arguments: [
                            txb.pure.address(deterministicObjectId1),
                            txb.pure.address(deterministicObjectId2),
                            txb.pure.vector('u8', Array.from(hexToBytes(formattedDistance.vkeyHex))),
                            txb.pure.vector('u8', Array.from(hexToBytes(formattedDistance.proofPointsHex))),
                            txb.pure.vector('u8', Array.from(hexToBytes(formattedDistance.publicInputsHexLittleEndian))), // little-endian for Groth16 verification
                            txb.object(objectRegistryId!),
                        ],
                    });
                    return txb;
                },
                5 // Increase max retries to handle version errors
            );

            expect(transferResult.effects?.status.status).toBe('success');
            console.log('   ✓ Distance attestation verified and stored on-chain');
            console.log(`   Transaction: ${transferResult.digest}`);
            console.log('=== STEP 2 COMPLETE ===\n');
        }, 180000);
    });
});

