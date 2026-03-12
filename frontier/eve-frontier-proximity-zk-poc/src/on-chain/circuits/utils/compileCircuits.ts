import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import * as snarkjs from 'snarkjs';
import crypto from 'crypto';
import { PTAU_FILE_PATH_ON_CHAIN, PTAU_DOWNLOAD_URL_ON_CHAIN } from '../../../shared/utils/fetchPtauOnChain';
import { serializeVKeyForSui } from '../../../../scripts/serializeVKeyForSui';

// Get __dirname equivalent for ES modules
// @ts-ignore - import.meta is available when using ts-node/esm
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const CIRCUITS_BASE_DIR = path.resolve(__dirname, '..');
const ARTIFACTS_BASE_DIR = path.resolve(CIRCUITS_BASE_DIR, 'artifacts');
const BUILD_DIR_BASE = path.resolve(CIRCUITS_BASE_DIR, 'build');

// Circuit definitions
export type CircuitType = 'location-attestation' | 'distance-attestation';

const CIRCUIT_DEFINITIONS: Record<CircuitType, { circuitId: string; circomFile: string }> = {
    'location-attestation': {
        circuitId: 'location-attestation',
        circomFile: 'location-attestation.circom'
    },
    'distance-attestation': {
        circuitId: 'distance-attestation',
        circomFile: 'distance-attestation.circom'
    }
};

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

// Check if circuit artifacts already exist (including Sui vkey)
async function circuitArtifactsExist(circuitName: string): Promise<boolean> {
    const circuitArtifactsDir = path.join(ARTIFACTS_BASE_DIR, circuitName);
    
    const wasmPath = path.join(circuitArtifactsDir, `${circuitName}.wasm`);
    const zkeyPath = path.join(circuitArtifactsDir, `${circuitName}_final.zkey`);
    const vkeyPath = path.join(circuitArtifactsDir, `${circuitName}_vkey.json`);
    const suiVkeyPath = path.join(circuitArtifactsDir, `${circuitName}_vkey.hex`);
    
    try {
        await fs.access(wasmPath);
        await fs.access(zkeyPath);
        await fs.access(vkeyPath);
        await fs.access(suiVkeyPath);
        return true;
    } catch {
        return false;
    }
}

// --- Main Compilation Logic ---

async function compileCircuit(circuitType: CircuitType): Promise<void> {
    const nodeMemoryOptionsEnv = { NODE_OPTIONS: "--max-old-space-size=16384" };
    
    logStep(`Compiling ${circuitType} circuit`);
    
    // Get circuit definition
    const circuitDef = CIRCUIT_DEFINITIONS[circuitType];
    const circuitName = circuitDef.circuitId;
    const circomFileName = circuitDef.circomFile;
    
    // Check if artifacts already exist
    logStep(`Checking if ${circuitName} circuit artifacts already exist...`);
    if (await circuitArtifactsExist(circuitName)) {
        logStep(`Circuit ${circuitName} artifacts already exist. Skipping compilation.`);
        return;
    }
    
    // Paths
    const circuitDir = path.join(CIRCUITS_BASE_DIR, circuitName);
    const circomFilePath = path.join(circuitDir, circomFileName);
    const buildDir = path.join(BUILD_DIR_BASE, circuitName);
    
    // Build artifacts
    const r1csFileBuild = path.join(buildDir, `${circuitName}.r1cs`);
    const wasmDirBuild = path.join(buildDir, `${circuitName}_js`);
    const wasmFileBuild = path.join(wasmDirBuild, `${circuitName}.wasm`);
    const zkeyFileBuildFinal = path.join(buildDir, `${circuitName}_final.zkey`);
    const vkeyFileBuild = path.join(buildDir, `${circuitName}_vkey.json`);
    
    // Final artifact paths
    const circuitArtifactsDir = path.join(ARTIFACTS_BASE_DIR, circuitName);
    const wasmFileDest = path.join(circuitArtifactsDir, `${circuitName}.wasm`);
    const zkeyFileDest = path.join(circuitArtifactsDir, `${circuitName}_final.zkey`);
    const vkeyFileDest = path.join(circuitArtifactsDir, `${circuitName}_vkey.json`);
    const r1csFileDest = path.join(circuitArtifactsDir, `${circuitName}.r1cs`);
    const suiVkeyFileDest = path.join(circuitArtifactsDir, `${circuitName}_vkey.hex`);
    
    const projectRoot = process.cwd();
    
    try {
        // Phase 1: Check PTAU file
        logStep("Phase 1: Checking for PTAU file (on-chain circuits use smaller PTAU)");
        try {
            fsSync.statSync(PTAU_FILE_PATH_ON_CHAIN);
            logStep(`PTAU file found: ${PTAU_FILE_PATH_ON_CHAIN}`);
        } catch (error: any) {
            console.error(`\n❌ Error: Powers of Tau file not found!`);
            console.error(`   Expected location: ${PTAU_FILE_PATH_ON_CHAIN}`);
            console.error(`\n   To download it, run: pnpm exec tsx src/shared/utils/fetchPtauOnChain.ts`);
            console.error(`   Or manually download from: ${PTAU_DOWNLOAD_URL_ON_CHAIN}`);
            process.exit(1);
        }
        
        // Phase 2: Compile and setup
        logStep("Phase 2: Compile (circom) and Setup (snarkjs)");
        
        // Create build directory
        await fs.mkdir(buildDir, { recursive: true });
        
        // Compile with circom
        logStep(`Compiling ${circuitName} using circom...`);
        const circomExecutable = 'circom';
        const flags: string[] = [];
        
        // Use absolute path for output (relative paths can be tricky)
        flags.push(`--output ${buildDir}`);
        flags.push(`--prime bn128`);
        
        // Add include paths for node_modules
        // The circuit files use relative paths like ../../../node_modules/circomlib/circuits/poseidon.circom
        // These paths are relative to the circuit file location, so we need to add the project root
        flags.push(`-l ${path.join(projectRoot, 'node_modules')}`);
        
        flags.push('--r1cs');
        flags.push('--sym');
        flags.push('--wasm');
        flags.push('--O2'); // Optimization level 2
        
        // Use absolute path for circuit file
        const circomCommand = `${circomExecutable} ${circomFilePath} ${flags.join(' ')}`;
        runCommand(circomCommand, projectRoot, nodeMemoryOptionsEnv);
        fsSync.statSync(r1csFileBuild);
        logStep("Circom compilation finished");
        
        // Get R1CS info
        const r1csInfo = await snarkjs.r1cs.info(r1csFileBuild);
        logStep(`R1CS Info: ${r1csInfo.nPubInputs} Public Inputs, ${r1csInfo.nOutputs} Outputs, ${r1csInfo.nConstraints} Constraints`);
        
        // Setup with snarkjs (Groth16)
        logStep("Performing Groth16 setup using snarkjs...");
        
        // Generate initial zkey
        logStep("Generating initial zkey...");
        const initialZkeyPath = path.join(buildDir, `${circuitName}_0.zkey`);
        await snarkjs.zKey.newZKey(r1csFileBuild, PTAU_FILE_PATH_ON_CHAIN, initialZkeyPath);
        fsSync.statSync(initialZkeyPath);
        
        // Make a contribution (for security, even if just one)
        logStep("Making contribution...");
        const entropy = crypto.randomBytes(32);
        await snarkjs.zKey.contribute(initialZkeyPath, zkeyFileBuildFinal, `${circuitName}_contribution`, entropy);
        fsSync.statSync(zkeyFileBuildFinal);
        logStep(`Generated contribution key: ${zkeyFileBuildFinal}`);
        fsSync.unlinkSync(initialZkeyPath);
        
        // Export verification key
        logStep("Exporting verification key...");
        const vKeyData = await snarkjs.zKey.exportVerificationKey(zkeyFileBuildFinal);
        fsSync.writeFileSync(vkeyFileBuild, JSON.stringify(vKeyData, null, 2), 'utf-8');
        fsSync.statSync(vkeyFileBuild);
        logStep("Snarkjs setup finished");
        
    } catch (error: any) {
        console.error(`Error during compilation: ${error.message}`);
        throw error;
    }
    
    // Phase 3: Move artifacts
    try {
        logStep("Phase 3: Move Artifacts");
        await fs.mkdir(circuitArtifactsDir, { recursive: true });
        
        // Move R1CS
        logStep(`Moving R1CS to ${r1csFileDest}`);
        fsSync.renameSync(r1csFileBuild, r1csFileDest);
        
        // Move WASM
        logStep(`Moving WASM to ${wasmFileDest}`);
        fsSync.renameSync(wasmFileBuild, wasmFileDest);
        
        // Move ZKey
        logStep(`Moving ZKey to ${zkeyFileDest}`);
        fsSync.renameSync(zkeyFileBuildFinal, zkeyFileDest);
        
        // Move VKey
        logStep(`Moving VKey to ${vkeyFileDest}`);
        fsSync.renameSync(vkeyFileBuild, vkeyFileDest);
        
        // Serialize VKey for Sui
        logStep("Serializing verification key for Sui...");
        await serializeVKeyForSui(vkeyFileDest, suiVkeyFileDest);
        logStep(`Sui verification key saved to: ${suiVkeyFileDest}`);
        
    } catch (error: any) {
        console.error(`Error moving artifacts: ${error.message}`);
        throw error;
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
    
    logStep(`Compilation successful for circuit: ${circuitName}`);
}

// Compile all circuits
async function compileAllCircuits(): Promise<void> {
    logStep("Compiling all on-chain circuits (location-attestation, distance-attestation)");
    
    const circuits: CircuitType[] = ['location-attestation', 'distance-attestation'];
    
    for (const circuitType of circuits) {
        try {
            await compileCircuit(circuitType);
        } catch (error: any) {
            console.error(`Failed to compile ${circuitType} circuit: ${error.message}`);
            throw error;
        }
    }
    
    logStep("All circuits compiled successfully");
    console.log("\nCompiled circuits:");
    circuits.forEach((circuit) => {
        console.log(`  - ${circuit}`);
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
}

// Export the functions and circuit definitions
export { compileCircuit, compileAllCircuits, CIRCUIT_DEFINITIONS };

// --- Script Execution ---
const args = process.argv.slice(2);
const circuitTypeArg = args[0] as CircuitType;

if (circuitTypeArg && ['location-attestation', 'distance-attestation'].includes(circuitTypeArg)) {
    // Compile single circuit
    compileCircuit(circuitTypeArg)
        .then(async () => {
            if (typeof (snarkjs as any)?.thread?.terminateAll === 'function') {
                await (snarkjs as any).thread.terminateAll();
            }
            console.log(`\nScript finished successfully for ${circuitTypeArg}.`);
            process.exit(0);
        })
        .catch(async (error) => {
            console.error("\nScript failed:", error.message);
            if (typeof (snarkjs as any)?.thread?.terminateAll === 'function') {
                await (snarkjs as any).thread.terminateAll();
            }
            process.exit(1);
        });
} else if (args[0] === 'all' || args.length === 0) {
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
} else {
    console.error("Usage: node <script.js> [location-attestation|distance-attestation|all]");
    console.error("  If no argument provided, compiles all circuits.");
    process.exit(1);
}

