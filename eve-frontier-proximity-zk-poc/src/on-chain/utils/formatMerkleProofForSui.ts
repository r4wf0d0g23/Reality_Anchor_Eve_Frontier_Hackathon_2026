import fs from 'fs/promises';
import path from 'path';

/**
 * Merkle multiproof structure from OpenZeppelin's SimpleMerkleTree
 */
export interface MerkleMultiProof {
    leaves: string[];      // Leaf hashes (0x-prefixed hex strings)
    proof: string[];       // Proof hashes (sibling nodes)
    proofFlags: boolean[]; // Direction flags: false = left, true = right
}

/**
 * Formats a Merkle multiproof for on-chain verification in Move.
 * 
 * Converts hex strings to byte arrays and prepares the proof structure
 * for the Move merkle_verify module.
 * 
 * @param proofFilePath - Path to the Merkle proof JSON file (optional, can use proofData instead)
 * @param root - The Merkle root (0x-prefixed hex string)
 * @param proofData - Optional proof data object (if provided, proofFilePath is ignored)
 * @returns Object containing formatted proof data for Move
 */
export async function formatMerkleProofForSui(
    proofFilePath: string,
    root: string,
    proofData?: MerkleMultiProof
): Promise<{
    root: string;
    leaves: string[];
    proof: string[];
    proofFlags: boolean[];
}> {
    // Use provided proofData or read from file
    let proof: MerkleMultiProof;
    if (proofData) {
        proof = proofData;
    } else {
        proof = JSON.parse(await fs.readFile(proofFilePath, 'utf-8'));
    }
    
    // Ensure root doesn't have 0x prefix (Move expects hex without prefix for x"..." syntax)
    const rootHex = root.startsWith('0x') ? root.slice(2) : root;
    
    // Ensure all leaves and proof hashes are without 0x prefix
    const leaves = proof.leaves.map(h => h.startsWith('0x') ? h.slice(2) : h);
    const proofHashes = proof.proof.map(h => h.startsWith('0x') ? h.slice(2) : h);
    
    return {
        root: rootHex,
        leaves,
        proof: proofHashes,
        proofFlags: proof.proofFlags
    };
}

/**
 * Formats a Merkle multiproof data structure directly (without reading from file).
 * 
 * @param proofData - The Merkle multiproof data structure
 * @param root - The Merkle root (0x-prefixed hex string)
 * @returns Object containing formatted proof data for Move
 */
export function formatMerkleProofDataForSui(
    proofData: MerkleMultiProof,
    root: string
): {
    root: string;
    leaves: string[];
    proof: string[];
    proofFlags: boolean[];
} {
    // Ensure root doesn't have 0x prefix (Move expects hex without prefix for x"..." syntax)
    const rootHex = root.startsWith('0x') ? root.slice(2) : root;
    
    // Ensure all leaves and proof hashes are without 0x prefix
    const leaves = proofData.leaves.map(h => h.startsWith('0x') ? h.slice(2) : h);
    const proofHashes = proofData.proof.map(h => h.startsWith('0x') ? h.slice(2) : h);
    
    return {
        root: rootHex,
        leaves,
        proof: proofHashes,
        proofFlags: proofData.proofFlags
    };
}

/**
 * Converts a hex string (with or without 0x prefix) to Move byte array format.
 * 
 * @param hex - Hex string (e.g., "0xabcd" or "abcd")
 * @returns Move byte array string (e.g., "x\"abcd\"")
 */
export function hexToMoveBytes(hex: string): string {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    return `x"${cleanHex}"`;
}

/**
 * Formats a Merkle proof as Move code for use in tests or on-chain verification.
 * 
 * @param proofFilePath - Path to the Merkle proof JSON file
 * @param root - The Merkle root (0x-prefixed hex string)
 * @returns Move code string for creating the proof
 */
export async function formatMerkleProofAsMoveCode(
    proofFilePath: string,
    root: string
): Promise<string> {
    const formatted = await formatMerkleProofForSui(proofFilePath, root);
    
    // Generate Move code
    const leavesCode = formatted.leaves.map(h => hexToMoveBytes(h)).join(',\n        ');
    const proofCode = formatted.proof.map(h => hexToMoveBytes(h)).join(',\n        ');
    const flagsCode = formatted.proofFlags.map(f => f ? 'true' : 'false').join(', ');
    
    return `
let leaves = vector[
    ${leavesCode}
];
let proof_hashes = vector[
    ${proofCode}
];
let proof_flags = vector[${flagsCode}];

let proof = merkle_verify::create_multiproof(leaves, proof_hashes, proof_flags);
let root = ${hexToMoveBytes(formatted.root)};

assert!(merkle_verify::verify_merkle_multiproof(root, proof), E_INVALID_PROOF);
`;
}

