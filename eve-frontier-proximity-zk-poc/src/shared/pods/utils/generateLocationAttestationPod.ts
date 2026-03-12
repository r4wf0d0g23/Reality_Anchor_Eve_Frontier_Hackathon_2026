import path from 'path';
import fs from 'fs/promises';
import { PODEntries, PODValue } from '@pcd/pod';
import { LocationAttestationData } from '../../types/locationType';
import { writeJsonFile, loadPrivateKey } from '../../utils/fsUtils';
import { signPod } from './podUtils';
import { generatePodWithMerkleRootAndSignature } from '../../utils/podMerkleSignatureUtils';
import crypto from 'crypto';

const outputDir = path.resolve(process.cwd(), 'outputs', 'pods');
const merkleTreeOutputDir = path.resolve(process.cwd(), 'outputs', 'merkle', 'trees');
const POD_DATA_TYPE_LOCATION_ATTESTATION = 'evefrontier.location_attestation';

export async function generateLocationAttestationPod(
    data: LocationAttestationData,
    privateKeyOverride?: string,
    ed25519PrivateKeyOverride?: string
): Promise<{ jsonPod: any; filePath: string; merkleRoot: string; ed25519PublicKey: Uint8Array }> {
    console.log('--- Generating Location Attestation Signed POD with Merkle Root and Ed25519 Signature... ---');

    // Construct base podEntries (merkle root and signature are added later)
    // objectId is stored as POD 'bytes' type because Sui object IDs are 32 bytes (256 bits)
    // which can exceed BN254 field modulus for Poseidon hash.
    
    // Validate and convert salt (32 bytes for Merkle root randomization)
    const saltHex = data.salt.startsWith('0x') ? data.salt.slice(2) : data.salt;
    const saltBytes = new Uint8Array(Buffer.from(saltHex, 'hex'));
    if (saltBytes.length !== 32) {
        throw new Error(`salt must be 32 bytes (64 hex characters). Got ${saltBytes.length} bytes from "${data.salt}"`);
    }
    
    const objectIdBytes = data.objectId.startsWith('0x') 
        ? Buffer.from(data.objectId.slice(2), 'hex')
        : Buffer.from(data.objectId, 'hex');
    if (objectIdBytes.length !== 32) {
        throw new Error(`objectId must be 32 bytes (64 hex characters). Got ${objectIdBytes.length} bytes from "${data.objectId}"`);
    }
    const basePodEntries: PODEntries = {
        'objectId': { type: 'bytes', value: new Uint8Array(objectIdBytes) },
        'solarSystem': { type: 'int', value: BigInt(data.solarSystem) },
        // Flatten coordinates - naming ensures they're adjacent with timestamp in sorted order for efficient merkle tree generation
        ...((): PODEntries => {
            const entries: Record<string, PODValue> = {};
            entries['x_coord'] = { type: 'int', value: BigInt(data.coordinates.x) };
            entries['y_coord'] = { type: 'int', value: BigInt(data.coordinates.y) };
            entries['z_coord'] = { type: 'int', value: BigInt(data.coordinates.z) };
            return entries;
        })(),
        'timestamp': { type: 'int', value: data.timestamp },
        'pod_data_type': { type: 'string', value: POD_DATA_TYPE_LOCATION_ATTESTATION },
        'salt': { type: 'bytes', value: saltBytes }, // 32-byte salt for Merkle root and coordinate hash brute-force protection
    };

    // Step 1: Generate merkle root and Ed25519 signature
    console.log('1. Generating Merkle root and Ed25519 signature...');
    
    // Prepare tree output path (save to outputs/merkle/trees/)
    // Consistent naming: timestamp_objectId_merkle_tree.json
    await fs.mkdir(merkleTreeOutputDir, { recursive: true });
    const treeOutputPath = path.join(merkleTreeOutputDir, `${data.timestamp}_${data.objectId}_merkle_tree.json`);
    
    const { entries: podEntriesWithBinding, merkleSignatureResult } = 
        await generatePodWithMerkleRootAndSignature(
            basePodEntries,
            POD_DATA_TYPE_LOCATION_ATTESTATION,
            ed25519PrivateKeyOverride,
            treeOutputPath
        );
    console.log(`   ✓ Merkle root: ${merkleSignatureResult.merkleRoot}`);
    console.log(`   ✓ Ed25519 public key: 0x${Buffer.from(merkleSignatureResult.ed25519PublicKey).toString('hex')}`);

    // Step 2: Sign POD with EDDSA-Poseidon (includes merkle root and Ed25519 signature)
    let privateKeyString: string;
    try {
        privateKeyString = privateKeyOverride || loadPrivateKey();
    } catch (error: any) {
        const errorMsg = `Could not load private key for signing: ${error.message}`;
        console.error(`Error: ${errorMsg}`);
        throw new Error(errorMsg);
    }

    try {
        console.log('2. Signing POD with EDDSA-Poseidon...');
        const { jsonPod, signedPod } = await signPod(
            podEntriesWithBinding,
            privateKeyString
        );
        console.log(`   ✓ Content ID: ${signedPod.contentID.toString()}`);

        // Consistent naming: timestamp_objectId.json
        const outputPath = path.join(outputDir, `${data.timestamp}_${data.objectId}.json`);

        await fs.mkdir(outputDir, { recursive: true });

        await writeJsonFile(outputPath, jsonPod);
        console.log(`3. ✓ Successfully wrote signed location attestation POD to ${outputPath}`);

        return { 
            jsonPod, 
            filePath: outputPath,
            merkleRoot: merkleSignatureResult.merkleRoot,
            ed25519PublicKey: merkleSignatureResult.ed25519PublicKey
        };

    } catch (error: any) {
        console.error('Error during Location Attestation Signed POD generation process:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        throw error;
    }
}