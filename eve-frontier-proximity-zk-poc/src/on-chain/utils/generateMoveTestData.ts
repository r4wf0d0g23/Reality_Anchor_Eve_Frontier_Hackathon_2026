import fs from 'fs/promises';
import path from 'path';
import { formatProofForSui } from './formatProofForSui';
import { formatMerkleProofForSui, hexToMoveBytes } from './formatMerkleProofForSui';

/**
 * Generates Move test code for Groth16 proof verification
 * 
 * @param proofFilePath - Path to the core proof JSON file
 * @returns Move test code string
 */
export async function generateGroth16MoveTest(proofFilePath: string): Promise<string> {
    const formatted = await formatProofForSui(proofFilePath);
    
    return `
    #[test]
    fun test_verify_core_proof_real_data() {
        // Verification key from core circuit
        let vkey_bytes = ${hexToMoveBytes(formatted.vkeyHex)};
        let pvk = groth16_verify::test_prepare_verification_key(vkey_bytes);
        
        // Proof points from actual proof
        let proof_points_bytes = ${hexToMoveBytes(formatted.proofPointsHex)};
        
        // Public inputs from actual proof
        let public_inputs_bytes = ${hexToMoveBytes(formatted.publicInputsHex)};
        
        // Verify the proof
        let verified = groth16_verify::test_verify_proof(
            &pvk,
            proof_points_bytes,
            public_inputs_bytes
        );
        
        assert!(verified, 1);
    }
`;
}

/**
 * Generates Move test code for Merkle proof verification
 * 
 * @param proofFilePath - Path to the Merkle proof JSON file
 * @param root - The Merkle root (0x-prefixed hex string)
 * @returns Move test code string
 */
export async function generateMerkleMoveTest(
    proofFilePath: string,
    root: string
): Promise<string> {
    const formatted = await formatMerkleProofForSui(proofFilePath, root);
    
    // Generate Move code for leaves
    const leavesCode = formatted.leaves.map(h => hexToMoveBytes(h)).join(',\n        ');
    
    // Generate Move code for proof hashes
    const proofCode = formatted.proof.map(h => hexToMoveBytes(h)).join(',\n        ');
    
    // Generate Move code for flags
    const flagsCode = formatted.proofFlags.map(f => f ? 'true' : 'false').join(', ');
    
    return `
    #[test]
    fun test_verify_merkle_proof_real_data() {
        // Merkle root
        let root = ${hexToMoveBytes(formatted.root)};
        
        // Leaves
        let leaves = vector[
            ${leavesCode}
        ];
        
        // Proof hashes
        let proof_hashes = vector[
            ${proofCode}
        ];
        
        // Proof flags
        let proof_flags = vector[${flagsCode}];
        
        // Create multiproof
        let proof = merkle_verify::create_multiproof(leaves, proof_hashes, proof_flags);
        
        // Verify
        let verified = merkle_verify::verify_merkle_multiproof(root, proof);
        
        assert!(verified, 1);
    }
`;
}

/**
 * Generates complete Move test file with real proof data
 * 
 * @param outputPath - Path to save the generated Move test file
 * @param coreProofPath - Path to core proof JSON file
 * @param merkleProofPath - Path to Merkle proof JSON file (optional)
 * @param merkleRoot - Merkle root for Merkle proof (optional)
 */
export async function generateMoveTestFile(
    outputPath: string,
    coreProofPath: string,
    merkleProofPath?: string,
    merkleRoot?: string
): Promise<void> {
    const groth16Test = await generateGroth16MoveTest(coreProofPath);
    
    let merkleTest = '';
    if (merkleProofPath && merkleRoot) {
        merkleTest = await generateMerkleMoveTest(merkleProofPath, merkleRoot);
    }
    
    const testFileContent = `#[test_only]
module world::verifier_integration_tests {
    use world::crypto::zkp::groth16_verify;
    use world::crypto::merkle::merkle_verify;

${groth16Test}

${merkleTest}
}
`;
    
    await fs.writeFile(outputPath, testFileContent, 'utf-8');
    console.log(`✓ Generated Move test file: ${outputPath}`);
}

