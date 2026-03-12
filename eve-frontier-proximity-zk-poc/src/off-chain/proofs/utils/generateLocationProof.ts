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
import { POD } from '@pcd/pod';
import { writeJsonFile } from '../../../shared/utils/fsUtils';
// loadPrivateKey and Identity imports removed - not needed without ownership verification
import { fullLocationProofConfig } from '../configs/locationProofConfig';
import { supportedParameterSets } from '../../circuits/utils/circuitParameterSets';

// Get __dirname equivalent - use relative paths from project root to avoid Jest/ESM issues
// @ts-ignore - __dirname is available in CommonJS (Jest transformed code)
const currentDir = typeof __dirname !== 'undefined' 
    ? __dirname 
    : path.resolve(process.cwd(), 'src', 'off-chain', 'proofs', 'utils');

const ARTIFACTS_BASE_DIR = path.resolve(process.cwd(), 'src', 'off-chain', 'circuits', 'artifacts');
const PROOFS_DIR = path.resolve(process.cwd(), 'outputs', 'proofs', 'off-chain', 'location');

const CIRCUIT_ID = 'location';

interface LocationProofResult {
    proof: any;
    boundConfig: any;
    revealedClaims: any;
    publicSignals: string[];
    filePath: string;
}

/**
 * Generates a zk-SNARK proof for a location attestation POD.
 * 
 * @param locationPod The location attestation POD to prove
 * @param outputFileName Optional custom filename (defaults to timestamp-based name)
 * @returns The proof result including proof, boundConfig, revealedClaims, and file paths
 */
export async function generateLocationProof(
    locationPod: POD,
    outputFileName?: string
): Promise<LocationProofResult> {
    const startTime = Date.now();
    console.log('=== Generating Location Attestation Proof ===');

    // 1. Get circuit parameters
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

    // 2. Prepare proof config and inputs
    const proofConfig: GPCProofConfig = {
        ...fullLocationProofConfig,
        circuitIdentifier: `${PROTO_POD_GPC_FAMILY_NAME}_${canonicalName}` as GPCIdentifier
    };

    // Create owner identity from the private key used to sign the POD
    // No owner needed - we're not using ownership verification (includeOwnerV4: false)
    const proofInputs: GPCProofInputs = {
        pods: {
            location: locationPod
        }
        // owner removed - not needed without ownership verification
    };

    // 3. Call gpcPreProve
    console.log('Calling gpcPreProve...');
    const preProveResult = gpcPreProve(proofConfig, proofInputs, [circuitDesc]);
    const { circuitInputs, boundConfig } = preProveResult;

    // 4. Define artifact paths using canonical circuit name
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

    // 5. Ensure output directory exists
    await fs.mkdir(PROOFS_DIR, { recursive: true });

    // 6. Generate proof using snarkjs
    console.log('Generating proof with snarkjs...');
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
        console.log('Proof generated successfully.');
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

    // 7. Reconstruct circuit outputs
    const circuitOutputs = ProtoPODGPC.outputsFromPublicSignals(
        snarkjsPublicSignals.map(BigInt),
        circuitDesc.maxEntries,
        paramMaxVirtualEntries(circuitDesc),
        circuitDesc.includeOwnerV3,
        circuitDesc.includeOwnerV4
    );

    // 8. Call gpcPostProve
    const { revealedClaims } = gpcPostProve(
        snarkjsProof,
        boundConfig,
        circuitDesc,
        proofInputs,
        circuitOutputs
    );

    // 9. Save proof files
    const timestamp = Date.now();
    const fileName = outputFileName || `location_proof_${timestamp}.json`;
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
    console.log(`Proof saved to: ${filePath}`);
    console.log(`⏱️  Location proof generation took ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);

    return {
        proof: snarkjsProof,
        boundConfig,
        revealedClaims,
        publicSignals: snarkjsPublicSignals,
        filePath
    };
}

