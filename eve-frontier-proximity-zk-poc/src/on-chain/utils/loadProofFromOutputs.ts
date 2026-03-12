import fs from 'fs/promises';
import path from 'path';

/**
 * Loads a proof file from the outputs directory.
 * 
 * @param proofFileName - Name of the proof file (e.g., "1763741296811_0x8888...json")
 * @param proofType - Type of proof: "location-attestation" or "distance-attestation"
 * @returns The proof data object
 */
export async function loadProofFromOutputs(
    proofFileName: string,
    proofType: 'location-attestation' | 'distance-attestation'
): Promise<{
    proof: any;
    publicSignals: string[];
    inputs: any;
    filePath: string;
}> {
    const proofsDir = path.resolve(
        process.cwd(),
        'outputs',
        'proofs',
        'on-chain',
        proofType
    );
    
    const proofFilePath = path.join(proofsDir, proofFileName);
    
    try {
        const proofData = JSON.parse(await fs.readFile(proofFilePath, 'utf-8'));
        return {
            proof: proofData.proof,
            publicSignals: proofData.publicSignals,
            inputs: proofData.inputs,
            filePath: proofFilePath
        };
    } catch (error: any) {
        throw new Error(`Failed to load proof from ${proofFilePath}: ${error.message}`);
    }
}

/**
 * Lists available proof files in the outputs directory.
 * 
 * @param proofType - Type of proof: "location-attestation" or "distance-attestation"
 * @returns Array of proof file names
 */
export async function listAvailableProofs(
    proofType: 'location-attestation' | 'distance-attestation'
): Promise<string[]> {
    const proofsDir = path.resolve(
        process.cwd(),
        'outputs',
        'proofs',
        'on-chain',
        proofType
    );
    
    try {
        const files = await fs.readdir(proofsDir);
        return files.filter(f => f.endsWith('.json') && !f.endsWith('_input.json'));
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

