import path from 'path';
import fs from 'fs/promises';
import { groth16 } from 'snarkjs';
import { writeJsonFile } from '../../../shared/utils/fsUtils';
import { poseidon4 } from 'poseidon-lite';
import { DistanceAttestationData } from '../../../shared/types/distanceType';
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

const ARTIFACTS_BASE_DIR = path.resolve(process.cwd(), 'src', 'on-chain', 'circuits', 'artifacts', 'distance-attestation');
const PROOFS_DIR = path.resolve(process.cwd(), 'outputs', 'proofs', 'on-chain', 'distance-attestation');

interface DistanceProofInputs {
    // Public inputs
    locationMerkleRoot1: string;
    locationMerkleRoot2: string;
    coordinatesHash1: string;
    coordinatesHash2: string;
    distanceSquaredMeters: string;
    
    // Private inputs (witness)
    x1: string;
    y1: string;
    z1: string;
    salt1: string;
    x2: string;
    y2: string;
    z2: string;
    salt2: string;
    timestamp1: string;  // Timestamp from location proof 1 (u64 as decimal string)
    timestamp2: string;  // Timestamp from location proof 2 (u64 as decimal string)
    objectLocation1: string;
    objectLocation2: string;
}

interface DistanceProofResult {
    proof: any;
    publicSignals: string[];
    filePath: string;
    inputFilePath: string;
    proofGenerationTimeMs: number; // Time taken for groth16.fullProve only (excluding file I/O, etc.)
}

/**
 * Generates a zk-SNARK proof for a distance attestation using the optimized circuit.
 * 
 * @param distanceData The distance attestation data
 * @param locationData1 The first location attestation data (for coordinates)
 * @param locationData2 The second location attestation data (for coordinates)
 * @param locationProof1 The location proof result 1 (contains public signals with timestamp)
 * @param locationProof2 The location proof result 2 (contains public signals with timestamp)
 * @param locationMerkleRoot1 The Merkle root from location proof 1
 * @param locationMerkleRoot2 The Merkle root from location proof 2
 * @param coordinatesHash1 The coordinates hash from location proof 1
 * @param coordinatesHash2 The coordinates hash from location proof 2
 * @param outputFileName Optional custom filename
 * @returns The proof result including proof, publicSignals, and file paths
 */
export async function generateDistanceProof(
    distanceData: DistanceAttestationData,
    locationData1: LocationAttestationData,
    locationData2: LocationAttestationData,
    locationProof1: { publicSignals: string[] },
    locationProof2: { publicSignals: string[] },
    locationMerkleRoot1: string,
    locationMerkleRoot2: string,
    coordinatesHash1: string,
    coordinatesHash2: string,
    outputFileName?: string
): Promise<DistanceProofResult> {
    const startTime = Date.now();
    console.log('=== Generating Distance Attestation Proof (Optimized Circuit) ===');

    // 1. Extract timestamps from location proof public signals
    // Location proof public signals: [merkleRoot, coordinatesHash, signatureAndKeyHash, timestamp]
    // Location proofs have 3 public signals: [merkleRoot, coordinatesHash, signatureAndKeyHash]
    if (locationProof1.publicSignals.length < 3 || locationProof2.publicSignals.length < 3) {
        throw new Error('Location proofs must have at least 3 public signals (merkleRoot, coordinatesHash, signatureAndKeyHash)');
    }
    // 2. Extract location Merkle roots from location proof public signals
    // Location proof public signals order: [merkleRoot, coordinatesHash, signatureAndKeyHash]
    // No public outputs - timestamp is verified in Merkle proof, read from locationData
    const locationMerkleRoot1FromProof = locationProof1.publicSignals[0]!;
    const locationMerkleRoot2FromProof = locationProof2.publicSignals[0]!;
    
    // Get timestamps from locationData (they're already verified in the location proof's Merkle tree)
    const timestamp1 = locationData1.timestamp.toString();
    const timestamp2 = locationData2.timestamp.toString();
    
    // Verify they match the provided roots
    // Convert both to BigInt for comparison (proof has decimal string, expected might be hex string)
    const root1FromProofBigInt = BigInt(locationMerkleRoot1FromProof);
    const root1ExpectedBigInt = BigInt(locationMerkleRoot1);
    const root2FromProofBigInt = BigInt(locationMerkleRoot2FromProof);
    const root2ExpectedBigInt = BigInt(locationMerkleRoot2);
    
    if (root1FromProofBigInt !== root1ExpectedBigInt) {
        throw new Error(`Location Merkle root 1 mismatch: proof has ${locationMerkleRoot1FromProof}, expected ${locationMerkleRoot1}`);
    }
    if (root2FromProofBigInt !== root2ExpectedBigInt) {
        throw new Error(`Location Merkle root 2 mismatch: proof has ${locationMerkleRoot2FromProof}, expected ${locationMerkleRoot2}`);
    }

    // 3. Extract objectLocation values (should match location Merkle roots)
    const objectLocation1 = BigInt(locationMerkleRoot1).toString();
    const objectLocation2 = BigInt(locationMerkleRoot2).toString();

    // 4. Extract coordinates hashes from location proof public signals
    // Location proof public signals order: [merkleRoot, coordinatesHash, signatureAndKeyHash]
    // coordinatesHash is at index 1
    const coordinatesHash1FromProof = locationProof1.publicSignals[1]!;
    const coordinatesHash2FromProof = locationProof2.publicSignals[1]!;
    
    // Verify they match the provided hashes (convert to BigInt for comparison in case of format differences)
    const hash1FromProofBigInt = BigInt(coordinatesHash1FromProof);
    const hash1ExpectedBigInt = BigInt(coordinatesHash1);
    const hash2FromProofBigInt = BigInt(coordinatesHash2FromProof);
    const hash2ExpectedBigInt = BigInt(coordinatesHash2);
    
    if (hash1FromProofBigInt !== hash1ExpectedBigInt) {
        throw new Error(`Coordinates hash 1 mismatch: proof has ${coordinatesHash1FromProof}, expected ${coordinatesHash1}`);
    }
    if (hash2FromProofBigInt !== hash2ExpectedBigInt) {
        throw new Error(`Coordinates hash 2 mismatch: proof has ${coordinatesHash2FromProof}, expected ${coordinatesHash2}`);
    }
    
    // Use the hashes from the proof (they're the source of truth)
    const coordinatesHash1Final = coordinatesHash1FromProof;
    const coordinatesHash2Final = coordinatesHash2FromProof;

    // 5. Prepare input JSON for snarkjs
    const inputs: DistanceProofInputs & { [key: string]: string | string[] | number[] } = {
        // Public inputs
        locationMerkleRoot1: BigInt(locationMerkleRoot1).toString(),
        locationMerkleRoot2: BigInt(locationMerkleRoot2).toString(),
        coordinatesHash1: coordinatesHash1Final,
        coordinatesHash2: coordinatesHash2Final,
        distanceSquaredMeters: distanceData.distanceSquaredMeters.toString(),
        
        // Private inputs (witness)
        x1: locationData1.coordinates.x.toString(),
        y1: locationData1.coordinates.y.toString(),
        z1: locationData1.coordinates.z.toString(),
        salt1: hexToFieldElement(locationData1.salt).toString(),
        x2: locationData2.coordinates.x.toString(),
        y2: locationData2.coordinates.y.toString(),
        z2: locationData2.coordinates.z.toString(),
        salt2: hexToFieldElement(locationData2.salt).toString(),
        timestamp1: timestamp1,
        timestamp2: timestamp2,
        objectLocation1,
        objectLocation2
    };

    // 7. Save input JSON file
    await fs.mkdir(PROOFS_DIR, { recursive: true });
    // Consistent naming: timestamp_objectId1_objectId2_input.json (or custom name)
    const baseFileName = outputFileName 
        ? outputFileName.replace('.json', '')
        : `${distanceData.timestamp}_${distanceData.objectId1}_${distanceData.objectId2}`;
    const inputFileName = `${baseFileName}_input.json`;
    const inputFilePath = path.join(PROOFS_DIR, inputFileName);
    await writeJsonFile(inputFilePath, inputs);
    console.log(`Input JSON saved to: ${inputFilePath}`);

    // 8. Check if circuit artifacts exist
    const wasmPath = path.join(ARTIFACTS_BASE_DIR, 'distance-attestation.wasm');
    const pkeyPath = path.join(ARTIFACTS_BASE_DIR, 'distance-attestation_final.zkey');
    
    try {
        await fs.access(wasmPath);
        await fs.access(pkeyPath);
    } catch (error) {
        throw new Error(`Required circuit artifacts not found. Expected:\n  ${wasmPath}\n  ${pkeyPath}\n\nRun circuit compilation first.`);
    }

    // 9. Generate proof using snarkjs
    console.log('Generating proof with snarkjs...');
    let snarkjsProof: any;
    let snarkjsPublicSignals: string[];
    let proofGenerationTimeMs: number;

    try {
        // Measure only the actual proof generation time (groth16.fullProve)
        const proofStartTime = Date.now();
        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            wasmPath,
            pkeyPath
        );
        const proofEndTime = Date.now();
        proofGenerationTimeMs = proofEndTime - proofStartTime;
        
        snarkjsProof = proof;
        snarkjsPublicSignals = publicSignals;
        
        // Verify we have the expected number of public signals
        // Expected: 5 public inputs (locationMerkleRoot1, locationMerkleRoot2, coordinatesHash1, coordinatesHash2, distanceSquaredMeters) + 1 public output (maxTimestamp) = 6
        if (publicSignals.length !== 6) {
            throw new Error(`Unexpected number of public signals: ${publicSignals.length} (expected 6: 5 inputs + 1 output)`);
        }
        
        console.log('Proof generated successfully.');
    } catch (error: any) {
        console.error('Error during proof generation:', error.message);
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

    // 10. Save proof file
    // Consistent naming: timestamp_objectId1_objectId2.json (or custom name)
    const proofFileName = outputFileName || `${distanceData.timestamp}_${distanceData.objectId1}_${distanceData.objectId2}.json`;
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
    console.log(`Proof saved to: ${proofFilePath}`);
    console.log(`⏱️  Distance proof generation took ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

    return {
        proof: snarkjsProof,
        publicSignals: snarkjsPublicSignals,
        filePath: proofFilePath,
        inputFilePath,
        proofGenerationTimeMs
    };
}

