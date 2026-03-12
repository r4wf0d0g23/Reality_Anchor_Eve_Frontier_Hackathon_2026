import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import {
    GPCProofConfig,
    GPCProofInputs,
    boundConfigToJSON,
    revealedClaimsToJSON,
    GPCIdentifier,
    ProtoPODGPCCircuitDesc,
    gpcPreProve,
    gpcPostProve
} from '@pcd/gpc';
import {
    PROTO_POD_GPC_FAMILY_NAME,
    ProtoPODGPC,
    paramMaxVirtualEntries,
    ProtoPODGPCCircuitParams
} from "@pcd/gpcircuits";
import { groth16 } from "snarkjs";
import { POD, podBytesHash, podIntHash, deriveSignerPublicKey } from '@pcd/pod';
import { writeJsonFile, loadPublicKey } from '../../../shared/utils/fsUtils';
// Identity and loadPrivateKey imports removed - not needed without ownership verification
import { locationCustomAuthConfig } from '../configs/locationCustomAuthConfig';
import { supportedParameterSets } from '../../circuits/utils/circuitParameterSets';
import { generateDistanceAttestationPod } from '../../../shared/pods/utils/generateDistanceAttestationPod';
import { DistanceAttestationData } from '../../../shared/types/distanceType';
import { LocationAttestationData } from '../../../shared/types/locationType';

// Get __dirname equivalent - use relative paths from project root to avoid Jest/ESM issues
// @ts-ignore - __dirname is available in CommonJS (Jest transformed code)
const currentDir = typeof __dirname !== 'undefined' 
    ? __dirname 
    : path.resolve(process.cwd(), 'src', 'off-chain', 'proofs', 'utils');

const ARTIFACTS_BASE_DIR = path.resolve(process.cwd(), 'src', 'off-chain', 'circuits', 'artifacts');
const PROOFS_DIR = path.resolve(process.cwd(), 'outputs', 'proofs', 'off-chain', 'distance');

const CIRCUIT_ID = 'distance';
const EXPECTED_POD_DATA_TYPE = 'evefrontier.location_attestation';

interface LocationProofData {
    proof: any;
    boundConfig: any;
    revealedClaims: any;
    publicSignals: string[];
    pod: POD;
    podData: LocationAttestationData;
    contentID: string; // Revealed contentID from the proof
}

interface DistanceProofResult {
    proof: any;
    boundConfig: any;
    revealedClaims: any;
    publicSignals: string[];
    distancePod: POD;
    distancePodPath: string;
    filePath: string;
}

/**
 * Verifies a location proof (placeholder for now).
 * TODO: Implement actual proof verification
 */
async function verifyLocationProof(proofData: LocationProofData): Promise<boolean> {
    // Placeholder - implement actual verification later
    console.log('  Verifying location proof (placeholder)...');
    return true;
}

/**
 * Verifies that the pod_data_type field matches the expected value using podBytesHash.
 */
function verifyPodDataType(revealedClaims: any, expectedType: string): boolean {
    // The revealedClaims should contain the hash of pod_data_type
    // We need to find it in the revealed claims and compare with podBytesHash(expectedType)
    const expectedHash = podBytesHash(expectedType);
    
    // TODO: Find the actual revealed claim for pod_data_type and compare
    // For now, we'll assume it's verified if the proof structure is valid
    console.log(`  Verifying pod_data_type hash: ${expectedHash.toString()}`);
    return true; // Placeholder
}

/**
 * Verifies that the timestamp field matches using podIntHash.
 */
function verifyTimestamp(revealedClaims: any, expectedTimestamp: bigint): boolean {
    const expectedHash = podIntHash(expectedTimestamp);
    
    // TODO: Find the actual revealed claim for timestamp and compare
    console.log(`  Verifying timestamp hash: ${expectedHash.toString()}`);
    return true; // Placeholder
}

/**
 * Verifies that the signature of the POD matches the expected signer public key.
 */
function verifyPodSignature(pod: POD, expectedPublicKey: string): boolean {
    const isValid = pod.verifySignature();
    if (!isValid) {
        return false;
    }
    
    // Verify the signerPublicKey matches
    return pod.signerPublicKey === expectedPublicKey;
}

/**
 * Calculates Manhattan distance squared between two 3D coordinates.
 */
function manhattanDistanceSquared(
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number
): bigint {
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    const dz = Math.abs(z1 - z2);
    const distance = dx + dy + dz;
    return BigInt(distance * distance);
}

/**
 * Generates a distance attestation proof from two location attestation proofs.
 * 
 * @param locationProof1 First location proof data
 * @param locationProof2 Second location proof data
 * @param timeThresholdMs Maximum allowed time difference in milliseconds (default: 3000)
 * @param outputFileName Optional custom filename
 * @returns The distance proof result
 */
export async function generateDistanceProof(
    locationProof1: LocationProofData,
    locationProof2: LocationProofData,
    timeThresholdMs: number = 3000,
    outputFileName?: string
): Promise<DistanceProofResult> {
    const startTime = Date.now();
    console.log('=== Generating Distance Attestation Proof ===');

    // 1. Verify location proofs (placeholder)
    console.log('Verifying location proofs...');
    const proof1Valid = await verifyLocationProof(locationProof1);
    const proof2Valid = await verifyLocationProof(locationProof2);
    
    if (!proof1Valid || !proof2Valid) {
        throw new Error('One or more location proofs failed verification');
    }

    // 2. Verify pod_data_type for both proofs
    console.log('Verifying pod_data_type fields...');
    if (!verifyPodDataType(locationProof1.revealedClaims, EXPECTED_POD_DATA_TYPE)) {
        throw new Error('Location proof 1 pod_data_type verification failed');
    }
    if (!verifyPodDataType(locationProof2.revealedClaims, EXPECTED_POD_DATA_TYPE)) {
        throw new Error('Location proof 2 pod_data_type verification failed');
    }

    // 3. Verify contentIDs match between POD and proof
    console.log('Verifying contentIDs...');
    const pod1ContentID = locationProof1.pod.contentID.toString();
    const pod2ContentID = locationProof2.pod.contentID.toString();
    
    if (pod1ContentID !== locationProof1.contentID) {
        throw new Error(`Location proof 1 contentID mismatch: POD=${pod1ContentID}, Proof=${locationProof1.contentID}`);
    }
    if (pod2ContentID !== locationProof2.contentID) {
        throw new Error(`Location proof 2 contentID mismatch: POD=${pod2ContentID}, Proof=${locationProof2.contentID}`);
    }

    // 4. Verify signatures match .env signer
    console.log('Verifying POD signatures...');
    const expectedPublicKey = loadPublicKey();
    
    if (!verifyPodSignature(locationProof1.pod, expectedPublicKey)) {
        throw new Error('Location proof 1 signature verification failed');
    }
    if (!verifyPodSignature(locationProof2.pod, expectedPublicKey)) {
        throw new Error('Location proof 2 signature verification failed');
    }

    // 5. Verify timestamps and check time threshold
    console.log('Verifying timestamps...');
    const timestamp1 = locationProof1.podData.timestamp;
    const timestamp2 = locationProof2.podData.timestamp;
    
    // Verify timestamp hashes
    if (!verifyTimestamp(locationProof1.revealedClaims, timestamp1)) {
        throw new Error('Location proof 1 timestamp verification failed');
    }
    if (!verifyTimestamp(locationProof2.revealedClaims, timestamp2)) {
        throw new Error('Location proof 2 timestamp verification failed');
    }

    // Check time threshold
    const timeDiff = timestamp1 > timestamp2 
        ? Number(timestamp1 - timestamp2)
        : Number(timestamp2 - timestamp1);
    
    if (timeDiff > timeThresholdMs) {
        throw new Error(`Time difference (${timeDiff}ms) exceeds threshold (${timeThresholdMs}ms)`);
    }

    // 6. Extract data from POD data (already verified via POD signature and contentID match)
    // Use objectIds from POD data (cleartext, verified via proof)
    const objectId1 = locationProof1.podData.objectId;
    const objectId2 = locationProof2.podData.objectId;
    
    // Use contentIDs (context IDs) for objectLocation (not merkle roots)
    const objectLocation1 = locationProof1.contentID; // POD contentID (context ID)
    const objectLocation2 = locationProof2.contentID; // POD contentID (context ID)
    
    // Use coordinates from POD data (already verified via POD signature)
    const coord1 = locationProof1.podData.coordinates;
    const coord2 = locationProof2.podData.coordinates;

    // 6. Calculate distance squared (Manhattan distance)
    const distanceSquared = manhattanDistanceSquared(
        coord1.x, coord1.y, coord1.z,
        coord2.x, coord2.y, coord2.z
    );

    // 7. Create distance attestation POD using POD data
    // Use max_timestamp (maximum of the two location timestamps)
    const maxTimestamp = timestamp1 > timestamp2 ? timestamp1 : timestamp2;
    
    const distanceData: DistanceAttestationData = {
        objectId1: objectId1,
        objectId2: objectId2,
        objectLocation1: objectLocation1,  // Use contentID (context ID) instead of merkle root
        objectLocation2: objectLocation2,  // Use contentID (context ID) instead of merkle root
        distanceSquaredMeters: distanceSquared,
        pod_data_type: 'evefrontier.distance_attestation',
        timestamp: maxTimestamp  // Use max_timestamp (maximum of location timestamps)
    };

    const { jsonPod: distancePodJson, filePath: distancePodPath } = await generateDistanceAttestationPod(distanceData);
    const distancePodObj = POD.fromJSON(distancePodJson);
    
    // Store distance POD path for cleanup (if needed)
    // Note: This is returned in the result but caller should handle cleanup

    // 8. Generate proof for distance POD
    console.log('Generating distance proof...');
    
    // Get circuit parameters
    const circuitParams = supportedParameterSets.find(p => p.circuitId === CIRCUIT_ID);
    if (!circuitParams) {
        throw new Error(`Circuit parameters not found for circuitId: ${CIRCUIT_ID}`);
    }

    // Generate canonical circuit name from parameters (same format as compileCircuits.ts)
    const canonicalName = ProtoPODGPC.circuitNameForParams(circuitParams as ProtoPODGPCCircuitParams);

    const circuitDesc: ProtoPODGPCCircuitDesc = {
        family: PROTO_POD_GPC_FAMILY_NAME,
        name: canonicalName, // Use canonical name, not CIRCUIT_ID
        cost: 0,
        ...circuitParams
    };

    // Prepare proof config and inputs
    const proofConfig: GPCProofConfig = {
        ...locationCustomAuthConfig,
        circuitIdentifier: `${PROTO_POD_GPC_FAMILY_NAME}_${canonicalName}` as GPCIdentifier
    };

    // No owner needed - we're not using ownership verification (includeOwnerV4: false)
    const proofInputs: GPCProofInputs = {
        pods: {
            distance: distancePodObj
        }
        // owner removed - not needed without ownership verification
    };

    // Call gpcPreProve
    const preProveResult = gpcPreProve(proofConfig, proofInputs, [circuitDesc]);
    const { circuitInputs, boundConfig } = preProveResult;

    // Define artifact paths using canonical circuit name
    const circuitArtifactsDir = path.join(ARTIFACTS_BASE_DIR, CIRCUIT_ID);
    const finalArtifactBasename = `${PROTO_POD_GPC_FAMILY_NAME}_${canonicalName}`;
    const wasmPath = path.join(circuitArtifactsDir, `${finalArtifactBasename}.wasm`);
    const pkeyPath = path.join(circuitArtifactsDir, `${finalArtifactBasename}-pkey.zkey`);

    // Check if artifacts exist
    try {
        await fs.access(wasmPath);
        await fs.access(pkeyPath);
    } catch (error) {
        throw new Error(`Required circuit artifacts not found. Expected:\n  ${wasmPath}\n  ${pkeyPath}\n\nRun 'pnpm circuit:compile' first.`);
    }

    // Ensure output directory exists
    await fs.mkdir(PROOFS_DIR, { recursive: true });

    // Generate proof using snarkjs
    let snarkjsProof: any;
    let snarkjsPublicSignals: string[];

    try {
        const { proof, publicSignals } = await groth16.fullProve(
            circuitInputs,
            wasmPath,
            pkeyPath
        );
        snarkjsProof = proof;
        snarkjsPublicSignals = publicSignals;
        console.log('Distance proof generated successfully.');
    } catch (error: any) {
        console.error('Error during proof generation:', error.message);
        throw error;
    } finally {
        // Always terminate snarkjs workers to prevent memory leaks
        // This ensures proper cleanup whether called from tests or standalone
        try {
            if (typeof (groth16 as any)?.thread?.terminateAll === 'function') {
                await (groth16 as any).thread.terminateAll();
            }
        } catch (terminateError) {
            // Ignore termination errors - workers may already be terminated
            // This is safe to ignore as it's best-effort cleanup
        }
    }

    // Reconstruct circuit outputs
    const circuitOutputs = ProtoPODGPC.outputsFromPublicSignals(
        snarkjsPublicSignals.map(BigInt),
        circuitDesc.maxEntries,
        paramMaxVirtualEntries(circuitDesc),
        circuitDesc.includeOwnerV3,
        circuitDesc.includeOwnerV4
    );

    // Call gpcPostProve
    const { revealedClaims } = gpcPostProve(
        snarkjsProof,
        boundConfig,
        circuitDesc,
        proofInputs,
        circuitOutputs
    );

    // Save proof files
    const timestamp = Date.now();
    const fileName = outputFileName || `distance_proof_${timestamp}.json`;
    const filePath = path.join(PROOFS_DIR, fileName);

    const proofData = {
        proof: snarkjsProof,
        boundConfig: boundConfigToJSON(boundConfig),
        revealedClaims: revealedClaimsToJSON(revealedClaims),
        publicSignals: snarkjsPublicSignals
    };

    await writeJsonFile(filePath, proofData);
    const endTime = Date.now();
    const durationMs = endTime - startTime;
    console.log(`Distance proof saved to: ${filePath}`);
    console.log(`⏱️  Distance proof generation took ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

    return {
        proof: snarkjsProof,
        boundConfig,
        revealedClaims,
        publicSignals: snarkjsPublicSignals,
        distancePod: distancePodObj,
        distancePodPath,
        filePath
    };
}

