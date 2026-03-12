import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as snarkjs from 'snarkjs';
import crypto from 'crypto';
import {
    PROTO_POD_GPC_FAMILY_NAME,
    PROTO_POD_GPC_PUBLIC_INPUT_NAMES,
    ProtoPODGPC,
    ProtoPODGPCCircuitParams
} from "@pcd/gpcircuits";
import { supportedParameterSets, SupportedGPCCircuitParams } from './circuitParameterSets';

// Get __dirname equivalent for ES modules
// @ts-ignore - import.meta is available when using tsx
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const CIRCUITS_BASE_DIR = path.resolve(__dirname, '..');
const ARTIFACTS_BASE_DIR = path.resolve(CIRCUITS_BASE_DIR, 'artifacts');
const BUILD_DIR_BASE = path.resolve(CIRCUITS_BASE_DIR, 'build');

// PTAU file for off-chain circuits (ppot_0080_16.ptau)
// Using ppot_0080_16.ptau (2^16 = 65,536 constraints) to support circuits with ~35k+ constraints
const PTAU_DIR = path.resolve(__dirname, '..', '..', '..', 'shared', 'ptau');
const PTAU_FILENAME_OFF_CHAIN = 'ppot_0080_16.ptau';
const PTAU_FILE_PATH_OFF_CHAIN = path.join(PTAU_DIR, PTAU_FILENAME_OFF_CHAIN);

// Path to @pcd/gpcircuits circuits directory
const GPC_CIRCUITS_DIR = path.resolve(process.cwd(), 'node_modules', '@pcd', 'gpcircuits', 'circuits');
const GPC_CIRCOM_SRC_FILE = 'proto-pod-gpc.circom';
const GPC_CIRCOM_SRC_PATH = path.join(GPC_CIRCUITS_DIR, GPC_CIRCOM_SRC_FILE);

// Temporary directory for wrapper circom files
const TMP_WRAPPER_DIR = path.join(BUILD_DIR_BASE, 'tmp_wrappers');

// --- Helper Functions ---

function logStep(message: string) {
    console.log(`\n=== ${message} ===`);
}

function runCommand(command: string, cwd?: string, env?: NodeJS.ProcessEnv) {
    console.log(`Executing: ${command}` + (cwd ? ` in ${cwd}` : ''));
    try {
        execSync(command, { stdio: 'inherit', cwd, env: { ...process.env, ...env } });
    } catch (error: any) {
        console.error(`Error executing command: ${command}`);
        console.error(error.message);
        throw new Error(`Command failed: ${command}`);
    }
}

async function circuitArtifactsExist(circuitParams: SupportedGPCCircuitParams): Promise<boolean> {
    const canonicalName = ProtoPODGPC.circuitNameForParams(circuitParams as ProtoPODGPCCircuitParams);
    const circuitArtifactsDir = path.join(ARTIFACTS_BASE_DIR, circuitParams.circuitId);
    const finalArtifactBasename = `${PROTO_POD_GPC_FAMILY_NAME}_${canonicalName}`;
    
    const wasmPath = path.join(circuitArtifactsDir, `${finalArtifactBasename}.wasm`);
    const pkeyPath = path.join(circuitArtifactsDir, `${finalArtifactBasename}-pkey.zkey`);
    const vkeyPath = path.join(circuitArtifactsDir, `${finalArtifactBasename}-vkey.json`);
    
    try {
        await fs.access(wasmPath);
        await fs.access(pkeyPath);
        await fs.access(vkeyPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Generate instantiation parameters string for ProtoPODGPC template
 * Order must match ProtoPODGPC template definition
 */
function getInstantiationParamsString(params: ProtoPODGPCCircuitParams): string {
    return [
        params.maxObjects,
        params.maxEntries,
        params.merkleMaxDepth,
        params.maxNumericValues,
        params.maxEntryInequalities,
        params.maxLists,
        params.maxListElements,
        params.maxTuples,
        params.tupleArity,
        params.includeOwnerV3 ? 1 : 0,
        params.includeOwnerV4 ? 1 : 0
    ].join(', ');
}

/**
 * Create wrapper circom file content that instantiates ProtoPODGPC with parameters
 */
function createWrapperCircomContent(params: ProtoPODGPCCircuitParams, relativeIncludePath: string): string {
    const instantiationParams = getInstantiationParamsString(params);
    const finalPublicSignals = PROTO_POD_GPC_PUBLIC_INPUT_NAMES.join(', ');
    
    // Ensure the relative path uses forward slashes for Circom includes
    const circomIncludePath = relativeIncludePath.replace(/\\/g, '/');
    
    return `pragma circom 2.1.8;

// Include the base ProtoPODGPC template
include "${circomIncludePath}";

// Instantiate the main component with hardcoded parameters
component main { public [ ${finalPublicSignals} ] } = 
    ProtoPODGPC(${instantiationParams});
`;
}

// --- Main Compilation Logic ---

async function compileCircuit(circuitParams: SupportedGPCCircuitParams): Promise<void> {
    const nodeMemoryOptionsEnv = { NODE_OPTIONS: "--max-old-space-size=16384" };
    const circuitId = circuitParams.circuitId;
    const canonicalName = ProtoPODGPC.circuitNameForParams(circuitParams as ProtoPODGPCCircuitParams);
    
    logStep(`Compiling circuit: ${circuitId} (${canonicalName})`);
    
    // Check if artifacts already exist
    if (await circuitArtifactsExist(circuitParams)) {
        console.log(`Circuit artifacts already exist for ${circuitId}. Skipping compilation.`);
        return;
    }
    
    // Check if ptau file exists
    try {
        await fs.access(PTAU_FILE_PATH_OFF_CHAIN);
    } catch {
        throw new Error(`PTAU file not found: ${PTAU_FILE_PATH_OFF_CHAIN}\nPlease run 'pnpm circuit:fetch-ptau:off-chain' first.`);
    }
    
    // Check if source circom file exists
    try {
        await fs.access(GPC_CIRCOM_SRC_PATH);
    } catch {
        throw new Error(`ProtoPODGPC source file not found: ${GPC_CIRCOM_SRC_PATH}`);
    }
    
    const buildDir = path.join(BUILD_DIR_BASE, circuitId);
    const circuitArtifactsDir = path.join(ARTIFACTS_BASE_DIR, circuitId);
    const tmpWrapperDir = path.join(TMP_WRAPPER_DIR, circuitId);
    const wrapperCircomFile = path.join(tmpWrapperDir, `${canonicalName}.circom`);
    
    // Build artifacts
    const r1csFileBuild = path.join(buildDir, `${canonicalName}.r1cs`);
    const wasmDirBuild = path.join(buildDir, `${canonicalName}_js`);
    const wasmFileBuild = path.join(wasmDirBuild, `${canonicalName}.wasm`);
    const zkeyFileBuildFinal = path.join(buildDir, `${canonicalName}_final.zkey`);
    const vkeyFileBuild = path.join(buildDir, `${canonicalName}_vkey.json`);
    
    // Final artifact paths
    const finalArtifactBasename = `${PROTO_POD_GPC_FAMILY_NAME}_${canonicalName}`;
    const wasmFileDest = path.join(circuitArtifactsDir, `${finalArtifactBasename}.wasm`);
    const zkeyFileDest = path.join(circuitArtifactsDir, `${finalArtifactBasename}-pkey.zkey`);
    const vkeyFileDest = path.join(circuitArtifactsDir, `${finalArtifactBasename}-vkey.json`);
    
    try {
        // Phase 1: Create directories and wrapper circom file
        logStep("Phase 1: Creating wrapper circom file");
        await fs.mkdir(buildDir, { recursive: true });
        await fs.mkdir(circuitArtifactsDir, { recursive: true });
        await fs.mkdir(tmpWrapperDir, { recursive: true });
        
        // Calculate relative path from wrapper to source circom file
        const relativeIncludePath = path.relative(tmpWrapperDir, GPC_CIRCOM_SRC_PATH);
        
        // Create wrapper circom file that instantiates ProtoPODGPC with parameters
        logStep("Creating wrapper circom file...");
        const wrapperContent = createWrapperCircomContent(circuitParams as ProtoPODGPCCircuitParams, relativeIncludePath);
        await fs.writeFile(wrapperCircomFile, wrapperContent, 'utf-8');
        console.log(`✓ Created wrapper: ${wrapperCircomFile}`);
        
        // Phase 2: Compile with circom
        logStep("Phase 2: Compiling circuit with circom...");
        // Add include paths for circomlib and other dependencies
        const nodeModulesPath = path.resolve(process.cwd(), 'node_modules');
        const circomlibPath = path.join(nodeModulesPath, 'circomlib', 'circuits');
        const gpcircuitsPath = path.join(nodeModulesPath, '@pcd', 'gpcircuits', 'circuits');
        const binaryMerkleRootPath = path.join(nodeModulesPath, '@zk-kit', 'binary-merkle-root.circom');
        
        const circomCommand = `circom ${wrapperCircomFile} --r1cs --wasm --output ${buildDir} -l ${circomlibPath} -l ${gpcircuitsPath} -l ${binaryMerkleRootPath} -l ${nodeModulesPath}`;
        runCommand(circomCommand, undefined, nodeMemoryOptionsEnv);
        
        // Check if compilation succeeded
        if (!fsSync.existsSync(r1csFileBuild)) {
            throw new Error(`R1CS file not generated: ${r1csFileBuild}`);
        }
        
        fsSync.statSync(r1csFileBuild);
        logStep("Circom compilation finished");
        
        // Get R1CS info
        const r1csInfo = await snarkjs.r1cs.info(r1csFileBuild);
        logStep(`R1CS Info: ${r1csInfo.nPubInputs} Public Inputs, ${r1csInfo.nOutputs} Outputs, ${r1csInfo.nConstraints} Constraints`);
        
        // Setup with snarkjs (Groth16)
        logStep("Performing Groth16 setup using snarkjs...");
        
        // Generate initial zkey
        logStep("Generating initial zkey...");
        const initialZkeyPath = path.join(buildDir, `${canonicalName}_0.zkey`);
        await snarkjs.zKey.newZKey(r1csFileBuild, PTAU_FILE_PATH_OFF_CHAIN, initialZkeyPath);
        fsSync.statSync(initialZkeyPath);
        
        // Make a contribution (for security, even if just one)
        logStep("Making contribution...");
        const entropy = crypto.randomBytes(32);
        await snarkjs.zKey.contribute(initialZkeyPath, zkeyFileBuildFinal, `${canonicalName}_contribution`, entropy);
        fsSync.statSync(zkeyFileBuildFinal);
        logStep(`Generated contribution key: ${zkeyFileBuildFinal}`);
        fsSync.unlinkSync(initialZkeyPath);
        
        // Export verification key
        logStep("Exporting verification key...");
        const vKeyData = await snarkjs.zKey.exportVerificationKey(zkeyFileBuildFinal);
        fsSync.writeFileSync(vkeyFileBuild, JSON.stringify(vKeyData, null, 2), 'utf-8');
        fsSync.statSync(vkeyFileBuild);
        logStep("Snarkjs setup finished");
        
        // Phase 3: Move artifacts
        logStep("Phase 3: Moving artifacts to artifacts directory...");
        
        // Move WASM
        if (fsSync.existsSync(wasmFileBuild)) {
            await fs.mkdir(path.dirname(wasmFileDest), { recursive: true });
            fsSync.renameSync(wasmFileBuild, wasmFileDest);
            console.log(`✓ Moved WASM: ${wasmFileDest}`);
        }
        
        // Move zkey (as pkey.zkey)
        if (fsSync.existsSync(zkeyFileBuildFinal)) {
            await fs.mkdir(path.dirname(zkeyFileDest), { recursive: true });
            fsSync.renameSync(zkeyFileBuildFinal, zkeyFileDest);
            console.log(`✓ Moved proving key: ${zkeyFileDest}`);
        }
        
        // Move vkey
        if (fsSync.existsSync(vkeyFileBuild)) {
            await fs.mkdir(path.dirname(vkeyFileDest), { recursive: true });
            fsSync.renameSync(vkeyFileBuild, vkeyFileDest);
            console.log(`✓ Moved verification key: ${vkeyFileDest}`);
        }
        
        logStep(`Compilation successful for circuit: ${circuitId}`);
        
    } catch (error: any) {
        console.error(`Error during compilation: ${error.message}`);
        throw error;
    } finally {
        // Cleanup temporary wrapper directory
        if (fsSync.existsSync(tmpWrapperDir)) {
            logStep(`Cleaning up temporary wrapper directory: ${tmpWrapperDir}...`);
            try {
                await fs.rm(tmpWrapperDir, { recursive: true, force: true });
            } catch (rmError: any) {
                console.warn(`Warning: Could not remove temporary wrapper directory: ${rmError.message}`);
            }
        }
        
        // Cleanup build directory
        if (fsSync.existsSync(buildDir)) {
            logStep(`Cleaning up build directory: ${buildDir}...`);
            try {
                await fs.rm(buildDir, { recursive: true, force: true });
            } catch (rmError: any) {
                console.warn(`Warning: Could not remove build directory: ${rmError.message}`);
            }
        }
    }
}

// Compile all circuits
async function compileAllCircuits(): Promise<void> {
    logStep("Compiling all off-chain POD/GPC circuits");
    
    for (const circuitParams of supportedParameterSets) {
        try {
            await compileCircuit(circuitParams);
        } catch (error: any) {
            console.error(`Failed to compile ${circuitParams.circuitId} circuit: ${error.message}`);
            throw error;
        }
    }
    
    logStep("All circuits compiled successfully");
    console.log("\nCompiled circuits:");
    supportedParameterSets.forEach((params) => {
        console.log(`  - ${params.circuitId} (${ProtoPODGPC.circuitNameForParams(params as ProtoPODGPCCircuitParams)})`);
    });
    
    // Cleanup base build directory (remove entire build folder after all circuits are done)
    if (fsSync.existsSync(BUILD_DIR_BASE)) {
        logStep(`Cleaning up base build directory: ${BUILD_DIR_BASE}...`);
        try {
            await fs.rm(BUILD_DIR_BASE, { recursive: true, force: true });
            console.log(`✓ Removed build directory: ${BUILD_DIR_BASE}`);
        } catch (rmError: any) {
            console.warn(`Warning: Could not remove base build directory: ${rmError.message}`);
        }
    }
    
    // Cleanup temporary wrapper base directory
    if (fsSync.existsSync(TMP_WRAPPER_DIR)) {
        logStep(`Cleaning up temporary wrapper base directory: ${TMP_WRAPPER_DIR}...`);
        try {
            await fs.rm(TMP_WRAPPER_DIR, { recursive: true, force: true });
            console.log(`✓ Removed temporary wrapper directory: ${TMP_WRAPPER_DIR}`);
        } catch (rmError: any) {
            console.warn(`Warning: Could not remove temporary wrapper directory: ${rmError.message}`);
        }
    }
}

// Export the functions
export { compileCircuit, compileAllCircuits };

// --- Script Execution ---
const args = process.argv.slice(2);
const circuitIdArg = args[0];

if (circuitIdArg && circuitIdArg !== 'all') {
    // Compile single circuit
    const circuitParams = supportedParameterSets.find(p => p.circuitId === circuitIdArg);
    if (!circuitParams) {
        console.error(`Unknown circuit ID: ${circuitIdArg}`);
        console.error(`Available circuits: ${supportedParameterSets.map(p => p.circuitId).join(', ')}`);
        process.exit(1);
    }
    
    compileCircuit(circuitParams)
        .then(async () => {
            if (typeof (snarkjs as any)?.thread?.terminateAll === 'function') {
                await (snarkjs as any).thread.terminateAll();
            }
            console.log(`\nScript finished successfully for ${circuitIdArg}.`);
            process.exit(0);
        })
        .catch(async (error) => {
            console.error("\nScript failed:", error.message);
            if (typeof (snarkjs as any)?.thread?.terminateAll === 'function') {
                await (snarkjs as any).thread.terminateAll();
            }
            process.exit(1);
        });
} else {
    // Compile all circuits
    compileAllCircuits()
        .then(async () => {
            if (typeof (snarkjs as any)?.thread?.terminateAll === 'function') {
                await (snarkjs as any).thread.terminateAll();
            }
            console.log("\nAll circuits compiled successfully.");
            process.exit(0);
        })
        .catch(async (error) => {
            console.error("\nScript failed:", error.message);
            if (typeof (snarkjs as any)?.thread?.terminateAll === 'function') {
                await (snarkjs as any).thread.terminateAll();
            }
            process.exit(1);
        });
}

