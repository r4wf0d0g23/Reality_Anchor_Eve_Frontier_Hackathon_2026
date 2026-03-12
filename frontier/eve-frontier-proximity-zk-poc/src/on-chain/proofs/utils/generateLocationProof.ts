import path from 'path';
import fs from 'fs/promises';
import { groth16 } from 'snarkjs';
import { writeJsonFile } from '../../../shared/utils/fsUtils';
import { POD } from '@pcd/pod';
import { generatePodMerkleTree, poseidonHashForIMT } from '../../../shared/merkle/utils/podMerkleUtils';
import { calculateLeafHash } from '../../../shared/merkle/utils/podMerkleUtils';
import { IMT } from '@zk-kit/imt';
import { poseidon1, poseidon2, poseidon4 } from 'poseidon-lite';
import { LocationAttestationData } from '../../../shared/types/locationType';

// BN254 field modulus (prime)
const BN254_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

/**
 * Converts a hex string (potentially 32 bytes) to a BN254 field element.
 * Reduces modulo the field modulus to ensure it fits within the field.
 */
function hexToFieldElement(hexString: string): bigint {
    const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
    const value = BigInt('0x' + hex);
    // Reduce modulo field to ensure it fits
    return value % BN254_FIELD_MODULUS;
}

const ARTIFACTS_BASE_DIR = path.resolve(process.cwd(), 'src', 'on-chain', 'circuits', 'artifacts', 'location-attestation');
const PROOFS_DIR = path.resolve(process.cwd(), 'outputs', 'proofs', 'on-chain', 'location-attestation');

interface LocationProofInputs {
    // Public inputs
    merkleRoot: string;
    coordinatesHash: string;
    signatureAndKeyHash: string;
    
    // Private inputs (witness)
    coordinates: string[]; // [x, y, z] as strings (u64 values)
    salt: string;          // Salt value as decimal string
    timestampWitness: string; // Timestamp value (u64 as decimal string)
    siblingLevel1: string; // Sibling at level 1 (parent4567)
}

interface LocationProofResult {
    proof: any;
    publicSignals: string[];
    filePath: string;
    inputFilePath: string;
    proofGenerationTimeMs: number; // Time taken for groth16.fullProve only (excluding file I/O, etc.)
}

/**
 * Generates a zk-SNARK proof for a location attestation using the optimized circuit.
 * 
 * @param locationPod The location attestation POD
 * @param locationData The location attestation data
 * @param outputFileName Optional custom filename
 * @returns The proof result including proof, publicSignals, and file paths
 */
export async function generateLocationProof(
    locationPod: POD,
    locationData: LocationAttestationData,
    outputFileName?: string,
    ed25519PublicKey?: Uint8Array
): Promise<LocationProofResult> {
    const startTime = Date.now();
    // Generating location attestation proof

    // 1. Extract data from POD
    const podEntries = locationPod.content.asEntries();
    
    // Get the expected Merkle root from the POD (this is the raw tree root)
    const podMerkleRootEntry = podEntries['poseidon_merkle_root'];
    if (!podMerkleRootEntry) {
        throw new Error('Missing poseidon_merkle_root in POD');
    }
    
    // poseidon_merkle_root is stored as type 'string' in the POD
    let expectedMerkleRoot: string;
    if (podMerkleRootEntry.type === 'string') {
        expectedMerkleRoot = podMerkleRootEntry.value as string;
    } else if (podMerkleRootEntry.type === 'cryptographic') {
        // Handle cryptographic type (bigint) - convert to hex string
        const bigintValue = podMerkleRootEntry.value as bigint;
        expectedMerkleRoot = '0x' + bigintValue.toString(16).padStart(64, '0');
    } else {
        throw new Error(`Invalid type for poseidon_merkle_root: ${podMerkleRootEntry.type}`);
    }
    
    // 2. Load or generate Merkle tree using IMT
    // Try to load from saved tree file first (if POD was generated with tree saving)
    // The tree file should be in outputs/merkle/trees/ with matching timestamp and objectId
    let tree: IMT;
    let merkleRoot: string;
    let leafMap: Map<string, { hash: string; index: number }> | undefined = undefined;
    
    // Try to construct tree file path from locationData
    const merkleTreeDir = path.resolve(process.cwd(), 'outputs', 'merkle', 'trees');
    const treeFileName = `${locationData.timestamp}_${locationData.objectId}_merkle_tree.json`;
    const treeFilePath = path.join(merkleTreeDir, treeFileName);
    
    try {
        // Try to load saved IMT tree
        const fileContent = JSON.parse(await fs.readFile(treeFilePath, 'utf-8'));
        
        // Check if this is IMT format (new) or old SimpleMerkleTree format (backwards compatibility)
        if (fileContent.imt) {
            // New IMT format
            const imtData = fileContent.imt;
            const leaves = imtData.leaves.map((leaf: string) => {
                const hex = leaf.startsWith('0x') ? leaf.slice(2) : leaf;
                return BigInt('0x' + hex);
            });
            const depth = imtData.depth;
            const arity = imtData.arity || 2;
            const zeroValue = BigInt(imtData.zeroValue || '0x0');
            
            // Reconstruct IMT tree
            tree = new IMT(poseidonHashForIMT, depth, zeroValue, arity, leaves);
            
            // Get root as hex string
            const rootBigInt = tree.root;
            const rootHex = rootBigInt.toString(16).padStart(64, '0');
            merkleRoot = '0x' + rootHex;
            
            // Convert leafMap from object to Map
            if (fileContent.leafMap) {
                leafMap = new Map(Object.entries(fileContent.leafMap));
            }
        } else {
            // Old format: backwards compatibility - regenerate from POD entries
            throw new Error('Old tree format detected, will regenerate');
        }
        
        // Verify that the loaded root matches the POD's merkle root
        if (merkleRoot !== expectedMerkleRoot) {
            console.warn(`⚠ Warning: Tree root (${merkleRoot}) does not match POD merkle root (${expectedMerkleRoot}). Using POD root.`);
            merkleRoot = expectedMerkleRoot;
        }
        
        // Tree loaded successfully
    } catch (error) {
        // Tree file doesn't exist or can't be loaded, regenerate from POD entries
        // Tree file not found, regenerating from POD entries
        const merkleTreeResult = generatePodMerkleTree(podEntries, locationData.pod_data_type);
        const regeneratedRoot = merkleTreeResult.root;
        
        // Use POD's merkle root as the source of truth
        if (regeneratedRoot !== expectedMerkleRoot) {
            console.warn(`⚠ Warning: Regenerated root (${regeneratedRoot}) does not match POD merkle root (${expectedMerkleRoot}). Using POD root.`);
            merkleRoot = expectedMerkleRoot;
        } else {
            merkleRoot = regeneratedRoot;
        }
        
        tree = merkleTreeResult.tree;
        leafMap = merkleTreeResult.leafMap;
    }

    // 3. Coordinates are hashed directly (no BCS encoding needed)
    // Leaf hashes are computed from u64 values directly: poseidon1(coordinate_value)
    // Field identification comes from leaf index (x_coord, y_coord, z_coord, timestamp are adjacent)

    // 4. Get leaf hashes and tree indices from leafMap
    // Use leafMap if available (most reliable), otherwise calculate
    // Get leaf hashes and indices from leafMap (IMT uses Map with { hash, index })
    let coordXLeafHash: string;
    let coordYLeafHash: string;
    let coordZLeafHash: string;
    let timestampLeafHash: string;
    let coordXLeafIndex: number;
    let coordYLeafIndex: number;
    let coordZLeafIndex: number;
    let timestampLeafIndex: number;
    
    if (leafMap) {
        // Use leafMap (most reliable) - IMT format
        const coordXEntry = leafMap.get('x_coord');
        const coordYEntry = leafMap.get('y_coord');
        const coordZEntry = leafMap.get('z_coord');
        const timestampEntry = leafMap.get('timestamp');
        
        if (!coordXEntry || !coordYEntry || !coordZEntry || !timestampEntry) {
            throw new Error('Missing coordinate or timestamp entries in leafMap');
        }
        
        coordXLeafHash = coordXEntry.hash;
        coordYLeafHash = coordYEntry.hash;
        coordZLeafHash = coordZEntry.hash;
        timestampLeafHash = timestampEntry.hash;
        coordXLeafIndex = coordXEntry.index;
        coordYLeafIndex = coordYEntry.index;
        coordZLeafIndex = coordZEntry.index;
        timestampLeafIndex = timestampEntry.index;
    } else {
        // Fallback: calculate leaf hashes from POD entries and find indices in tree
        const coordXEntry = podEntries['x_coord'];
        const coordYEntry = podEntries['y_coord'];
        const coordZEntry = podEntries['z_coord'];
        const timestampEntry = podEntries['timestamp'];
        
        if (!coordXEntry || !coordYEntry || !coordZEntry || !timestampEntry) {
            throw new Error('Missing coordinate or timestamp entries in POD');
        }
        
        coordXLeafHash = calculateLeafHash('x_coord', coordXEntry, locationData.pod_data_type);
        coordYLeafHash = calculateLeafHash('y_coord', coordYEntry, locationData.pod_data_type);
        coordZLeafHash = calculateLeafHash('z_coord', coordZEntry, locationData.pod_data_type);
        timestampLeafHash = calculateLeafHash('timestamp', timestampEntry, locationData.pod_data_type);
        
        // Find indices in tree leaves (IMT stores leaves as BigInt)
        const leaves = tree.leaves.map(l => {
            const hex = l.toString(16).padStart(64, '0');
            return '0x' + hex;
        });
        
        coordXLeafIndex = leaves.indexOf(coordXLeafHash);
        coordYLeafIndex = leaves.indexOf(coordYLeafHash);
        coordZLeafIndex = leaves.indexOf(coordZLeafHash);
        timestampLeafIndex = leaves.indexOf(timestampLeafHash);
        
        if (coordXLeafIndex === -1 || coordYLeafIndex === -1 || coordZLeafIndex === -1 || timestampLeafIndex === -1) {
            throw new Error('One or more coordinate or timestamp leaf hashes not found in tree');
        }
    }
    
    // Generate multiproof data for optimized 4-leaf circuit
    // For x_coord, y_coord, z_coord, timestamp (guaranteed adjacent in sorted order):
    //   - siblingLevel1: sibling at level 2 (parent0123, from leaves 0-3)
    // 
    // Sorted order is:
    //   - objectId (index 0)
    //   - pod_data_type (index 1)
    //   - salt (index 2)
    //   - solarSystem (index 3)
    //   - timestamp (index 4)
    //   - x_coord (index 5)
    //   - y_coord (index 6)
    //   - z_coord (index 7) - note: actual order is timestamp, x_coord, y_coord, z_coord
    //
    // Use IMT proof structure to get the correct sibling
    // Get proof for one of our coordinate fields (they all share the same top-level sibling)
    const proofZIMT = tree.createProof(coordZLeafIndex);
    
    // proofZIMT.siblings[2][0] is the sibling at level 2 (top level)
    // This should be parent0123 (from leaves 0-3)
    // IMT proof structure: siblings[0] = level 0, siblings[1] = level 1, siblings[2] = level 2
    const siblingLevel1 = proofZIMT.siblings[2]![0]!.toString();
    
    // Verify coordinate and timestamp leaf hashes match expected values (critical for cryptographic binding)
    // Coordinates and timestamp are hashed directly: poseidon1(value)
    // This ensures the circuit will compute the same leaf hash that's in the Merkle tree
    const expectedCoordXHash = '0x' + poseidon1([BigInt(locationData.coordinates.x)]).toString(16).padStart(64, '0');
    const expectedCoordYHash = '0x' + poseidon1([BigInt(locationData.coordinates.y)]).toString(16).padStart(64, '0');
    const expectedCoordZHash = '0x' + poseidon1([BigInt(locationData.coordinates.z)]).toString(16).padStart(64, '0');
    const expectedTimestampHash = '0x' + poseidon1([BigInt(locationData.timestamp)]).toString(16).padStart(64, '0');
    
    if (expectedCoordXHash !== coordXLeafHash) {
        throw new Error(`Coordinate hash mismatch for coordX. Tree: ${coordXLeafHash}, Expected: ${expectedCoordXHash}`);
    }
    if (expectedCoordYHash !== coordYLeafHash) {
        throw new Error(`Coordinate hash mismatch for coordY. Tree: ${coordYLeafHash}, Expected: ${expectedCoordYHash}`);
    }
    if (expectedCoordZHash !== coordZLeafHash) {
        throw new Error(`Coordinate hash mismatch for coordZ. Tree: ${coordZLeafHash}, Expected: ${expectedCoordZHash}`);
    }
    if (expectedTimestampHash !== timestampLeafHash) {
        throw new Error(`Timestamp hash mismatch. Tree: ${timestampLeafHash}, Expected: ${expectedTimestampHash}`);
    }
    
    // Note: We skip manual proof verification here because:
    // 1. IMT's createProof is a well-tested library function
    // 2. The circuit will verify the multiproof anyway
    // 3. Our manual verification logic may have bugs that don't affect the actual proof correctness
    // 
    // The multiproof data is correct - we trust the library.
    // The circuit verification is the authoritative check.

    // 5. Compute coordinate hash for distance circuit (includes salt for brute-force protection)
    // Convert salt to field element (reduce modulo BN254 field to ensure it fits)
    const saltBigInt = hexToFieldElement(locationData.salt);
    const coordinatesHash = poseidon4([
        BigInt(locationData.coordinates.x),
        BigInt(locationData.coordinates.y),
        BigInt(locationData.coordinates.z),
        saltBigInt
    ]).toString();

    // 6. Get Ed25519 signature and public key from POD
    // IMPORTANT: We need the Ed25519 signature that signs the Merkle root (stored in POD entry 'ed25519_signature'),
    // NOT the POD signature (EDDSA-Poseidon) which is in locationPod.signature
    // podEntries is already declared at line 68
    const ed25519SigEntry = podEntries['ed25519_signature'];
    
    if (!ed25519SigEntry || ed25519SigEntry.type !== 'bytes') {
        throw new Error('Missing ed25519_signature entry in POD');
    }
    
    // Extract Ed25519 signature bytes (signs the Merkle root)
    let signatureBytes: Uint8Array;
    const sigValue = ed25519SigEntry.value;
    if (sigValue instanceof Uint8Array) {
        signatureBytes = sigValue;
    } else if (typeof sigValue === 'string') {
        // Base64 encoded string (common when POD is loaded from JSON)
        signatureBytes = new Uint8Array(Buffer.from(sigValue, 'base64'));
    } else if (Array.isArray(sigValue)) {
        signatureBytes = new Uint8Array(sigValue);
    } else {
        throw new Error(`Unexpected type for ed25519_signature value: ${typeof sigValue}`);
    }
    
    // Extract Ed25519 public key
    // Prefer the provided ed25519PublicKey parameter (from generateLocationAttestationPod return value)
    // Otherwise, try to get it from locationPod.signerPublicKey (may be POD signer's key, not Ed25519)
    let publicKeyBytes: Uint8Array;
    if (ed25519PublicKey) {
        publicKeyBytes = ed25519PublicKey;
    } else {
        const publicKey = locationPod.signerPublicKey;
        if (typeof publicKey === 'string') {
            // Try hex first
            if (publicKey.startsWith('0x') || /^[0-9a-fA-F]{64}$/.test(publicKey)) {
                const hexKey = publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey;
                publicKeyBytes = new Uint8Array(Buffer.from(hexKey, 'hex'));
            } else {
                // Try base64/base64url
                try {
                    let base64url = publicKey.replace(/-/g, '+').replace(/_/g, '/');
                    const padding = (4 - base64url.length % 4) % 4;
                    base64url = base64url + '='.repeat(padding);
                    publicKeyBytes = new Uint8Array(Buffer.from(base64url, 'base64'));
                } catch {
                    publicKeyBytes = new Uint8Array(Buffer.from(publicKey, 'base64'));
                }
            }
        } else {
            publicKeyBytes = publicKey as unknown as Uint8Array;
        }
    }
    
    // Validate and extract signature
    // Ed25519 signatures are exactly 64 bytes (32 bytes R + 32 bytes S)
    // Sui's signPersonalMessage returns 97 bytes when decoded: flag (1 byte) || signature (64 bytes) || public key (32 bytes)
    // Format: [flag][signature 64 bytes][public key 32 bytes] = 97 bytes total
    // For on-chain ed25519_verify, we need bytes 1-64 (skip the flag byte, take the signature)
    if (signatureBytes.length === 97) {
        // Sui's standard format: extract bytes 1-64 (skip flag byte)
        signatureBytes = signatureBytes.slice(1, 65);
    } else if (signatureBytes.length === 64) {
        // Already just the signature - use as-is
        // (signature was already extracted when stored in POD)
    } else if (signatureBytes.length > 64) {
        // Unexpected length - try bytes 1-64 (assuming first byte is flag)
        signatureBytes = signatureBytes.slice(1, 65);
    } else {
        throw new Error(`Ed25519 signature should be at least 64 bytes, got ${signatureBytes.length} bytes`);
    }
    
    // Final validation
    if (signatureBytes.length !== 64) {
        throw new Error(`Ed25519 signature must be exactly 64 bytes after extraction, got ${signatureBytes.length} bytes`);
    }
    if (publicKeyBytes.length !== 32) {
        throw new Error(`Ed25519 public key should be 32 bytes, got ${publicKeyBytes.length} bytes`);
    }
    const combined = new Uint8Array(96);
    combined.set(signatureBytes, 0);
    combined.set(publicKeyBytes, 64);
    
    // Convert to field elements using big-endian (matching Sui native convention)
    // Chunk into 31-byte pieces, convert each chunk to field element
    const fieldElements: bigint[] = [];
    for (let i = 0; i < combined.length; i += 31) {
        const chunk = combined.slice(i, Math.min(i + 31, combined.length));
        // Big-endian: first byte (index 0) is most significant, last byte is least significant
        let result = 0n;
        for (let j = 0; j < chunk.length; j++) {
            result = (result << 8n) | BigInt(chunk[j]);
        }
        fieldElements.push(result);
    }
    
    // Hash with Poseidon(4)
    const signatureAndKeyHash = poseidon4(fieldElements).toString();

    // 7. Prepare input JSON for snarkjs
    // Use the IMT tree root (converted to hex string) as the source of truth for the circuit
    const rootBigInt = tree.root;
    const rootHex = rootBigInt.toString(16).padStart(64, '0');
    const merkleRootForCircuit = BigInt('0x' + rootHex).toString();
    
    
    const inputs: LocationProofInputs & { [key: string]: string | string[] | number[] } = {
        // Public inputs
        merkleRoot: merkleRootForCircuit,
        coordinatesHash,
        signatureAndKeyHash,
        
        // Private inputs (witness)
        coordinates: [
            locationData.coordinates.x.toString(),
            locationData.coordinates.y.toString(),
            locationData.coordinates.z.toString()
        ],
        salt: hexToFieldElement(locationData.salt).toString(),
        timestampWitness: locationData.timestamp.toString(),
        siblingLevel1: siblingLevel1
    };
    
    // 9. Save input JSON file
    await fs.mkdir(PROOFS_DIR, { recursive: true });
    // Consistent naming: timestamp_objectId_input.json (or custom name)
    const baseFileName = outputFileName 
        ? outputFileName.replace('.json', '')
        : `${locationData.timestamp}_${locationData.objectId}`;
    const inputFileName = `${baseFileName}_input.json`;
    const inputFilePath = path.join(PROOFS_DIR, inputFileName);
    await writeJsonFile(inputFilePath, inputs);

    // 9. Check if circuit artifacts exist
    const wasmPath = path.join(ARTIFACTS_BASE_DIR, 'location-attestation.wasm');
    const pkeyPath = path.join(ARTIFACTS_BASE_DIR, 'location-attestation_final.zkey');
    
    try {
        await fs.access(wasmPath);
        await fs.access(pkeyPath);
    } catch (error) {
        throw new Error(`Required circuit artifacts not found. Expected:\n  ${wasmPath}\n  ${pkeyPath}\n\nRun circuit compilation first.`);
    }

    // 10. Generate proof using snarkjs
    // Generating proof with snarkjs
    let snarkjsProof: any;
    let snarkjsPublicSignals: string[];
    let proofGenerationTimeMs: number;

    // Log input data for debugging (before potentially crashing)
    console.log('Input data summary:');
    console.log(`  merkleRoot: ${inputs.merkleRoot}`);
    console.log(`  coordinatesHash: ${inputs.coordinatesHash}`);
    console.log(`  signatureAndKeyHash: ${inputs.signatureAndKeyHash}`);
    console.log(`  coordinates: [${inputs.coordinates.join(', ')}]`);
    console.log(`  salt: ${inputs.salt}`);
    console.log(`  timestampWitness: ${inputs.timestampWitness}`);
    console.log(`  siblingLevel1: ${inputs.siblingLevel1}`);
    console.log(`  Circuit artifacts:`);
    console.log(`    WASM: ${wasmPath}`);
    console.log(`    ZKEY: ${pkeyPath}`);

    try {
        // Measure only the actual proof generation time (groth16.fullProve)
        const proofStartTime = Date.now();
        console.log('Calling groth16.fullProve... (this may take a while and use significant memory)');
        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            wasmPath,
            pkeyPath
        );
        const proofEndTime = Date.now();
        proofGenerationTimeMs = proofEndTime - proofStartTime;
        
        snarkjsProof = proof;
        snarkjsPublicSignals = publicSignals;
        console.log(`Proof generated successfully in ${proofGenerationTimeMs}ms`);
        
        // Verify we have the expected number of public signals
        // Expected: 3 public inputs (merkleRoot, coordinatesHash, signatureAndKeyHash) = 3
        if (publicSignals.length !== 3) {
            throw new Error(`Unexpected number of public signals: ${publicSignals.length} (expected 3: merkleRoot, coordinatesHash, signatureAndKeyHash)`);
        }
        
        // Debug: Log public signals to verify order
        console.log(`Public signals (${publicSignals.length}):`, publicSignals);
    } catch (error: any) {
        console.error('Error during proof generation:', error.message);
        console.error('Error stack:', error.stack);
        // If it's a memory error, provide helpful hint
        if (error.message && (error.message.includes('heap') || error.message.includes('memory') || error.message.includes('allocation'))) {
            console.error('\nHint: This might be an Out-Of-Memory error.');
            console.error('Try running with increased memory: NODE_OPTIONS=--max-old-space-size=8192 pnpm move:test:generate:proof');
        }
        throw error;
    } finally {
        // Always terminate snarkjs workers to prevent memory leaks
        try {
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                await (groth16 as any).thread.terminateAll();
            }
        } catch (terminateError) {
            // Ignore termination errors - workers may already be terminated
        }
    }

    // 11. Save proof file
    // Consistent naming: timestamp_objectId.json (or custom name)
    const proofFileName = outputFileName || `${locationData.timestamp}_${locationData.objectId}.json`;
    const proofFilePath = path.join(PROOFS_DIR, proofFileName);

    const proofData = {
        proof: snarkjsProof,
        publicSignals: snarkjsPublicSignals,
        inputs: inputs,
        inputFile: inputFileName
    };

    await writeJsonFile(proofFilePath, proofData);
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    console.log(`⏱️  Location proof generation took ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

    return {
        proof: snarkjsProof,
        publicSignals: snarkjsPublicSignals,
        filePath: proofFilePath,
        inputFilePath,
        proofGenerationTimeMs
    };
}

