import { PODEntries, PODStringValue, PODBytesValue } from '@pcd/pod';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { generatePodMerkleTree } from '../merkle/utils/podMerkleUtils';
import { fromHex } from '@mysten/sui/utils';
import { loadEd25519PrivateKey } from './fsUtils';
import { sign, verify, utils, hashes } from '@noble/ed25519';
import crypto from 'crypto';

// Set up SHA-512 for @noble/ed25519 using Node's built-in crypto
// @noble/ed25519 expects a function that takes (message: Uint8Array) => Uint8Array
// Must be set before any sign/verify operations
// The library checks for hashes.sha512 internally
const sha512Hash = (msg: Uint8Array): Uint8Array => {
    return crypto.createHash('sha512').update(msg).digest();
};

// Set it on hashes object - the library accesses it as hashes.sha512
(hashes as any).sha512 = sha512Hash;

export interface MerkleSignatureResult {
    merkleRoot: string;
    ed25519Signature: Uint8Array;
    ed25519PublicKey: Uint8Array;
    ed25519Keypair: Ed25519Keypair;
    merkleTreeResult?: any; // Optional: includes tree data if tree was saved
}

/**
 * Generates a Merkle root from POD entries and signs it with Ed25519.
 * 
 * This utility:
 * 1. Computes the Poseidon Merkle root from POD entries (excluding merkle root and signature entries)
 * 2. Signs the poseidon_merkle_root with Ed25519 (using Sui's keypair)
 *    - The signature can be verified on-chain to recover/validate the merkle root
 * 3. Returns the merkle root, signature, and public key
 * 
 * @param podEntries The POD entries to build the Merkle tree from
 * @param podDataType The POD data type (e.g., 'evefrontier.location_attestation')
 * @param ed25519PrivateKey Optional Ed25519 private key (Bech32 string or hex string or Uint8Array). If not provided, loads from .env.
 * @returns Object containing merkle root, Ed25519 signature, public key, and keypair
 */
export async function generateMerkleRootAndSignature(
    podEntries: PODEntries,
    podDataType: string,
    ed25519PrivateKey?: string | Uint8Array,
    treeOutputPath?: string
): Promise<MerkleSignatureResult & { merkleTreeResult: any }> {
    // 1. Generate Merkle tree from entries (excludes poseidon_merkle_root and ed25519_signature)
    const merkleTreeResult = generatePodMerkleTree(podEntries, podDataType);
    const merkleRoot = merkleTreeResult.root;
    
    // Save tree dump if output path is provided
    if (treeOutputPath) {
        const fs = await import('fs/promises');
        
        // IMT doesn't have built-in serialization, so we save:
        // 1. Leaf hashes (in order) - for tree reconstruction
        // 2. Tree depth - for tree reconstruction
        // 3. Leaf map - for entry name -> leaf hash/index lookup
        
        // Convert leafMap (Map) to plain object for JSON serialization
        const leafMapObj: Record<string, { hash: string; index: number }> = {};
        merkleTreeResult.leafMap.forEach((value, key) => {
            leafMapObj[key] = value;
        });
        
        // Save IMT tree data
        const treeDump = {
            // IMT-specific data
            imt: {
                leaves: merkleTreeResult.leafHashes, // Leaf hashes in order (for reconstruction)
                depth: merkleTreeResult.tree.depth, // Tree depth
                root: merkleRoot, // Root hash
                arity: merkleTreeResult.tree.arity, // Arity (2 for binary tree)
                zeroValue: '0x0' // Zero value used by IMT
            },
            // Entry name -> leaf hash/index mapping
            leafMap: leafMapObj,
            nodeHashType: 'poseidon' // Our metadata: documents that Poseidon is used
        };
        
        await fs.writeFile(treeOutputPath, JSON.stringify(treeDump, null, 2));
        console.log(`   ✓ Merkle tree saved to: ${treeOutputPath}`);
    }
    
    // 2. Create or use Ed25519 keypair
    let keypair: Ed25519Keypair;
    if (ed25519PrivateKey) {
        if (typeof ed25519PrivateKey === 'string') {
            // Check if it's Bech32 format (starts with "suiprivkey")
            if (ed25519PrivateKey.startsWith('suiprivkey')) {
                // Bech32 format - decode it to get raw key
                const decoded = decodeSuiPrivateKey(ed25519PrivateKey);
                if (decoded.scheme !== 'ED25519') {
                    throw new Error(`Invalid key scheme: expected ED25519, got ${decoded.scheme}`);
                }
                keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
            } else {
                // Hex string - convert to Uint8Array
                const keyBytes = fromHex(ed25519PrivateKey);
                keypair = Ed25519Keypair.fromSecretKey(keyBytes);
            }
        } else {
            // Already Uint8Array
            keypair = Ed25519Keypair.fromSecretKey(ed25519PrivateKey);
        }
    } else {
        // Load from .env
        const privateKeyStr = loadEd25519PrivateKey();
        
        // Check if it's Bech32 format (starts with "suiprivkey")
        if (privateKeyStr.startsWith('suiprivkey')) {
            // Bech32 format - decode it to get raw key
            const decoded = decodeSuiPrivateKey(privateKeyStr);
            if (decoded.scheme !== 'ED25519') {
                throw new Error(`Invalid key scheme: expected ED25519, got ${decoded.scheme}`);
            }
            keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
        } else {
            // Legacy hex format - convert to bytes
            const keyBytes = fromHex(privateKeyStr);
            // Validate it's 32 bytes
            if (keyBytes.length !== 32) {
                throw new Error(`Invalid Ed25519 private key length: expected 32 bytes, got ${keyBytes.length}. Please regenerate the key with 'pnpm generate-ed25519-key'`);
            }
            keypair = Ed25519Keypair.fromSecretKey(keyBytes);
        }
    }
    
    // 3. Sign the poseidon_merkle_root with raw Ed25519 (no prefix)
    // IMPORTANT: We use raw Ed25519 signing (not signPersonalMessage) because:
    // - signPersonalMessage adds a "Sui Personal Message:\n" prefix
    // - ed25519_verify on-chain expects the raw message without prefix
    // - We want to sign the exact merkle root bytes for on-chain verification
    const merkleRootBytes = Buffer.from(merkleRoot.slice(2), 'hex');
    
    // Get the raw private key bytes for raw Ed25519 signing
    let privateKeyBytes: Uint8Array;
    if (ed25519PrivateKey) {
        if (typeof ed25519PrivateKey === 'string') {
            if (ed25519PrivateKey.startsWith('suiprivkey')) {
                // Bech32 format - decode it to get raw key
                const decoded = decodeSuiPrivateKey(ed25519PrivateKey);
                if (decoded.scheme !== 'ED25519') {
                    throw new Error(`Invalid key scheme: expected ED25519, got ${decoded.scheme}`);
                }
                privateKeyBytes = decoded.secretKey;
            } else {
                // Hex format
                privateKeyBytes = fromHex(ed25519PrivateKey);
            }
        } else {
            // Already Uint8Array
            privateKeyBytes = ed25519PrivateKey;
        }
    } else {
        // Load from .env (same logic as keypair creation above)
        const privateKeyStr = loadEd25519PrivateKey();
        if (privateKeyStr.startsWith('suiprivkey')) {
            // Bech32 format - decode it to get raw key
            const decoded = decodeSuiPrivateKey(privateKeyStr);
            if (decoded.scheme !== 'ED25519') {
                throw new Error(`Invalid key scheme: expected ED25519, got ${decoded.scheme}`);
            }
            privateKeyBytes = decoded.secretKey;
        } else {
            // Hex format
            privateKeyBytes = fromHex(privateKeyStr);
        }
    }
    
    // Validate private key is 32 bytes
    if (privateKeyBytes.length !== 32) {
        throw new Error(`Invalid Ed25519 private key length: expected 32 bytes, got ${privateKeyBytes.length}`);
    }
    
    // Sign the merkle root bytes directly (raw Ed25519, no prefix)
    // This matches on-chain ed25519_verify which expects raw message (no intent prefix)
    const rawSignature = sign(merkleRootBytes, privateKeyBytes);
    
    // Verify the signature off-chain before storing in POD
    // This ensures the signature is valid before we store it
    const publicKey = keypair.getPublicKey().toRawBytes();
    const isValid = verify(rawSignature, merkleRootBytes, publicKey);
    if (!isValid) {
        throw new Error('Failed to verify Ed25519 signature off-chain. This should never happen.');
    }
    console.log('✓ Verified Ed25519 signature off-chain before storing in POD');
    
    // Final validation - Ed25519 signature must be exactly 64 bytes
    if (rawSignature.length !== 64) {
        throw new Error(`Ed25519 signature must be exactly 64 bytes, got ${rawSignature.length} bytes`);
    }
    
    const result: MerkleSignatureResult & { merkleTreeResult: any } = {
        merkleRoot,
        ed25519Signature: new Uint8Array(rawSignature),
        ed25519PublicKey: publicKey,
        ed25519Keypair: keypair,
        merkleTreeResult // Always include tree result
    };
    
    return result;
}

/**
 * Adds merkle root and Ed25519 signature to POD entries.
 * 
 * This is used to create the "full POD" with binding fields before signing with EDDSA-Poseidon.
 * 
 * @param podEntries Original POD entries (without merkle root and signature)
 * @param merkleRoot The Poseidon Merkle root
 * @param ed25519Signature The Ed25519 signature of the merkle root
 * @returns POD entries with merkle root and Ed25519 signature added
 */
export function addMerkleRootAndSignatureToEntries(
    podEntries: PODEntries,
    merkleRoot: string,
    ed25519Signature: Uint8Array
): PODEntries {
    return {
        ...podEntries,
        'poseidon_merkle_root': { type: 'string', value: merkleRoot } as PODStringValue,
        'ed25519_signature': { type: 'bytes', value: ed25519Signature } as PODBytesValue,
    };
}

/**
 * Complete workflow: Generate POD entries with merkle root and Ed25519 signature.
 * 
 * This function:
 * 1. Takes original POD entries
 * 2. Computes merkle root
 * 3. Signs merkle root with Ed25519
 * 4. Adds both to entries
 * 
 * @param podEntries Original POD entries (without merkle root and signature)
 * @param podDataType The POD data type
 * @param ed25519PrivateKey Optional Ed25519 private key (hex string or Uint8Array)
 * @param treeOutputPath Optional path to save the Merkle tree dump (JSON)
 * @returns POD entries with merkle root and Ed25519 signature, plus the signature result
 */
export async function generatePodWithMerkleRootAndSignature(
    podEntries: PODEntries,
    podDataType: string,
    ed25519PrivateKey?: string | Uint8Array,
    treeOutputPath?: string
): Promise<{
    entries: PODEntries;
    merkleSignatureResult: MerkleSignatureResult;
}> {
    // Generate merkle root and signature
    const merkleSignatureResult = await generateMerkleRootAndSignature(
        podEntries,
        podDataType,
        ed25519PrivateKey,
        treeOutputPath
    );
    
    // Add to entries
    const entriesWithBinding = addMerkleRootAndSignatureToEntries(
        podEntries,
        merkleSignatureResult.merkleRoot,
        merkleSignatureResult.ed25519Signature
    );
    
    return {
        entries: entriesWithBinding,
        merkleSignatureResult
    };
}

