import { IMT } from '@zk-kit/imt';
import { poseidon2 } from 'poseidon-lite';
import { PodMerkleTreeResult } from './podMerkleUtils';
import fs from 'fs/promises';
import path from 'path';

/**
 * Helper to convert BigInt to big-endian hex string (matching Sui's native address::to_u256 convention)
 * This is used consistently across multiproof generation to ensure byte order matches Sui native behavior
 */
function bigIntToBigEndianHex(value: bigint): string {
    // Convert BigInt to big-endian hex string (most significant byte first)
    const hexStr = value.toString(16).padStart(64, '0');
    return '0x' + hexStr;
}

/**
 * Optimized multiproof data for on-chain verification.
 * Contains only the essential data needed for verification, not the full tree.
 */
export interface OptimizedMerkleMultiproof {
    leaves: string[];              // Leaf hashes to verify (hex strings with 0x prefix)
    proof: string[];               // Proof hashes (sibling nodes, hex strings with 0x prefix)
    proofFlags: boolean[];         // Direction flags: false = left, true = right
    root: string;                  // Merkle root (for verification)
}

/**
 * Full multiproof data (includes tree metadata for off-chain use).
 */
export interface MerkleMultiproof {
    leaves: string[];              // Leaf hashes to verify
    proof: string[];               // Proof hashes (sibling nodes)
    proofFlags: boolean[];         // Direction flags: false = left, true = right
    root: string;                  // Merkle root
    treeDepth?: number;            // Tree depth (for reference)
    leafIndices?: number[];        // Original leaf indices (for reference)
}

/**
 * Generates a Merkle multiproof for specified leaf indices using Poseidon hashing and IMT trees.
 * 
 * This implements the same logic as the Move on-chain verifier but uses Poseidon instead of SHA256.
 * 
 * Algorithm:
 * 1. Start with all specified leaves
 * 2. Process them level by level, using proof hashes when needed
 * 3. The proof flags indicate the direction of each hash operation
 * 
 * @param tree The IMT tree instance
 * @param leafIndices Array of leaf indices to include in the multiproof
 * @param includeMetadata Whether to include tree metadata in the result
 * @returns Merkle multiproof data structure
 */
export function generateMerkleMultiproof(
    tree: IMT,
    leafIndices: number[],
    includeMetadata: boolean = false
): MerkleMultiproof | OptimizedMerkleMultiproof {
    if (leafIndices.length === 0) {
        throw new Error('At least one leaf index must be provided');
    }

    // Get leaf hashes from indices (as big-endian hex strings)
    // IMT leaves are BigInt values (we created the tree with BigInt leaf hashes)
    const leaves: string[] = leafIndices.map(index => {
        const leaf = tree.leaves[index];
        if (leaf === undefined) {
            throw new Error(`Leaf index ${index} is out of bounds`);
        }
        // IMT leaves are BigInt values, but TypeScript types them as IMTNode (string | bigint)
        // Cast to bigint since we created the tree with BigInt values
        return bigIntToBigEndianHex(leaf as bigint);
    });

    // Sort leaves by their indices to ensure consistent processing order
    const sortedIndices = [...leafIndices].sort((a, b) => a - b);
    const sortedLeaves = sortedIndices.map(index => {
        const leaf = tree.leaves[index]!;
        // IMT leaves are BigInt values, but TypeScript types them as IMTNode (string | bigint)
        // Cast to bigint since we created the tree with BigInt values
        return bigIntToBigEndianHex(leaf as bigint);
    });

    // Generate multiproof using the OpenZeppelin algorithm adapted for Poseidon
    const { proof, proofFlags } = generateMultiproofForLeaves(
        tree,
        sortedIndices,
        sortedLeaves
    );

    // Get root as big-endian hex string
    // IMT root is a BigInt value, but TypeScript types it as IMTNode (string | bigint)
    // Cast to bigint since we created the tree with BigInt values
    const rootBigInt = tree.root as bigint;
    const root = bigIntToBigEndianHex(rootBigInt);

    if (includeMetadata) {
        return {
            leaves: sortedLeaves,
            proof,
            proofFlags,
            root,
            treeDepth: tree.depth,
            leafIndices: sortedIndices
        };
    } else {
        return {
            leaves: sortedLeaves,
            proof,
            proofFlags,
            root
        };
    }
}

/**
 * Generates proof hashes and flags for a set of leaves using the OpenZeppelin multiproof algorithm.
 * 
 * This is adapted from the Move implementation in merkle_verify.move, but uses Poseidon hashing.
 * 
 * The algorithm works by:
 * 1. Starting with all specified leaves (as BigInt values)
 * 2. Processing them level by level, pairing adjacent nodes
 * 3. When a node doesn't have a pair in our queue, we use a proof hash (sibling from tree)
 * 4. Proof flags indicate the direction: false = left, true = right
 * 
 * @param tree The IMT tree instance
 * @param leafIndices Sorted array of leaf indices
 * @param leafHashes Sorted array of leaf hashes (corresponding to leafIndices)
 * @returns Object containing proof hashes and proof flags
 */
function generateMultiproofForLeaves(
    tree: IMT,
    leafIndices: number[],
    leafHashes: string[]
): { proof: string[]; proofFlags: boolean[] } {
    const proof: string[] = [];
    const proofFlags: boolean[] = [];

    // Build a map of all nodes we have (leaves + will compute parents)
    // Key: "level-index"
    // leafHashes are big-endian hex strings, convert directly to BigInt (BigInt interprets hex as big-endian)
    const nodesWeHave = new Map<string, bigint>();
    leafIndices.forEach((index, i) => {
        const hexStr = leafHashes[i]!.startsWith('0x') ? leafHashes[i]! : '0x' + leafHashes[i]!;
        nodesWeHave.set(`0-${index}`, BigInt(hexStr));
    });

    // Start with all leaves as BigInt values
    let queue: Array<{ value: bigint; treeIndex: number }> = leafIndices.map((index, i) => {
        const hexStr = leafHashes[i]!.startsWith('0x') ? leafHashes[i]! : '0x' + leafHashes[i]!;
        return {
            value: BigInt(hexStr),
            treeIndex: index
        };
    });

    // Process level by level until we reach the root
    // We must run for tree.depth iterations to reach the root
    for (let level = 0; level < tree.depth; level++) {
        const nextLevel: Array<{ value: bigint; treeIndex: number }> = [];
        let i = 0;

        while (i < queue.length) {
            const left = queue[i]!;
            let right: { value: bigint; treeIndex: number };
            let useProof = false;

            // Determine right sibling
            if (i + 1 < queue.length) {
                // Check if the next item in queue is the actual sibling
                const potentialRight = queue[i + 1]!;
                const expectedSiblingIndex = left.treeIndex % 2 === 0 ? left.treeIndex + 1 : left.treeIndex - 1;
                
                if (potentialRight.treeIndex === expectedSiblingIndex) {
                    // Found pair in queue
                    right = potentialRight;
                    i += 2;
                } else {
                    // Next item is NOT the sibling (gap in leaves)
                    useProof = true;
                    i += 1; 
                }
            } else {
                // Last item, no pair in queue
                useProof = true;
                i += 1;
            }

            if (useProof) {
                // Need to get the sibling
                const siblingIndex = left.treeIndex % 2 === 0 ? left.treeIndex + 1 : left.treeIndex - 1;
                const siblingKey = `${level}-${siblingIndex}`;
                
                if (nodesWeHave.has(siblingKey)) {
                    // We have it (computed in previous steps or initial leaf)
                    right = {
                        value: nodesWeHave.get(siblingKey)!,
                        treeIndex: siblingIndex
                    };
                } else {
                    // Fetch from tree and add to proof
                    // Find a leaf in the subtree to generate proof
                    // For a node at `level` with index `treeIndex`, 
                    // a leaf that descends from it is `treeIndex * 2^level`.
                    const leafIndexForProof = left.treeIndex * (2 ** level);
                    
                    const leftProof = tree.createProof(leafIndexForProof);
                    
                    // Get sibling at current level
                    let siblingValue: bigint = 0n;
                    if (level >= 0 && level < leftProof.siblings.length) {
                        const siblingsAtLevel = leftProof.siblings[level];
                        if (siblingsAtLevel && siblingsAtLevel.length > 0) {
                            siblingValue = siblingsAtLevel[0]!;
                        }
                    }
                    
                    right = {
                        value: siblingValue,
                        treeIndex: siblingIndex
                    };
                    
                    // Add to proof (as little-endian hex)
                    const proofHash = bigIntToBigEndianHex(right.value);
                    proof.push(proofHash);
                }
            }

            // Hash pair
            let hashResult: bigint;
            const isLeftEven = left.treeIndex % 2 === 0;
            
            if (isLeftEven) {
                hashResult = poseidon2([left.value, right!.value]);
                proofFlags.push(true);
            } else {
                hashResult = poseidon2([right!.value, left.value]);
                proofFlags.push(false);
            }
            
            const parentIndex = Math.floor(left.treeIndex / 2);
            const parentKey = `${level + 1}-${parentIndex}`;
            nodesWeHave.set(parentKey, hashResult);
            
            nextLevel.push({
                value: hashResult,
                treeIndex: parentIndex
            });
        }

        queue = nextLevel;
    }

    return { proof, proofFlags };
}

/**
 * Verifies a Merkle multiproof using Poseidon hashing.
 * 
 * This implements the same algorithm as the Move on-chain verifier but uses Poseidon.
 * 
 * @param root The expected Merkle root (hex string with 0x prefix)
 * @param multiproof The multiproof data structure
 * @returns True if the proof is valid and matches the root, false otherwise
 */
export function verifyMerkleMultiproof(
    root: string,
    multiproof: MerkleMultiproof | OptimizedMerkleMultiproof
): boolean {
    if (multiproof.leaves.length === 0) {
        return false;
    }

    // Convert root to BigInt for comparison (root is big-endian hex string)
    const expectedRoot = BigInt(root);

    // OpenZeppelin's multiproof algorithm:
    // 1. Start with all leaves
    // 2. Process them level by level, using proof hashes when needed
    // 3. The proof flags indicate the direction of each hash operation

    let queue: bigint[] = multiproof.leaves.map(leaf => {
        const hexStr = leaf.startsWith('0x') ? leaf : '0x' + leaf;
        return BigInt(hexStr);
    });
    let proofIndex = 0;
    let flagIndex = 0;

    // Process queue until we have a single root or consume all proof hashes
    // We continue as long as there are > 1 items in queue OR we still have proof hashes to consume
    // This ensures we verify up to the root even for a single leaf in a larger tree
    while (queue.length > 1 || proofIndex < multiproof.proof.length) {
        const nextLevel: bigint[] = [];
        let j = 0;
        const queueLen = queue.length;

        while (j < queueLen) {
            const left = queue[j]!;

            // Get right sibling (either from queue or proof)
            let right: bigint;
            if (j + 1 < queueLen) {
                // Use next item in queue
                right = queue[j + 1]!;
                j += 2;
            } else {
                // Need to use proof hash
                if (proofIndex >= multiproof.proof.length) {
                    return false;
                }
                const proofHex = multiproof.proof[proofIndex]!.startsWith('0x') 
                    ? multiproof.proof[proofIndex]! 
                    : '0x' + multiproof.proof[proofIndex]!;
                right = BigInt(proofHex);
                proofIndex++;
                j += 1;
            }

            // Determine hash order based on flag
            let hashResult: bigint;
            if (flagIndex < multiproof.proofFlags.length) {
                const flag = multiproof.proofFlags[flagIndex]!;
                flagIndex++;
                if (flag) {
                    hashResult = poseidon2([left, right]);
                } else {
                    hashResult = poseidon2([right, left]);
                }
            } else {
                // Default to left, right
                hashResult = poseidon2([left, right]);
            }

            nextLevel.push(hashResult);
        }

        queue = nextLevel;
    }

    // Final root should match
    if (queue.length !== 1) {
        return false;
    }

    const computedRoot = queue[0]!;
    return computedRoot === expectedRoot;
}

/**
 * Generates an optimized multiproof from a full tree data structure.
 * 
 * This function accepts full tree data (from outputs/merkle/trees) and generates
 * an optimized proof containing only the essential data for on-chain verification.
 * 
 * Optionally saves the multiproof to disk for later inspection and reuse.
 * 
 * @param treeData The full tree data (from generatePodMerkleTree or loaded from file)
 * @param entryNames Array of entry names to include in the multiproof
 * @param saveToFile Optional: if provided, saves multiproof to this file path
 * @returns Optimized multiproof data for on-chain verification
 */
export async function generateOptimizedMultiproofFromTree(
    treeData: PodMerkleTreeResult,
    entryNames: string[],
    saveToFile?: string
): Promise<OptimizedMerkleMultiproof> {
    // Get leaf indices from entry names
    const leafIndices: number[] = [];
    for (const entryName of entryNames) {
        const leafInfo = treeData.leafMap.get(entryName);
        if (!leafInfo) {
            throw new Error(`Entry name '${entryName}' not found in tree`);
        }
        leafIndices.push(leafInfo.index);
    }

    // Generate multiproof
    const multiproof = generateMerkleMultiproof(
        treeData.tree,
        leafIndices,
        false // Don't include metadata for optimized version
    ) as OptimizedMerkleMultiproof;

    // Ensure root is set from treeData (should already be set, but ensure consistency)
    multiproof.root = treeData.root;

    // Save to file if requested
    if (saveToFile) {
        await fs.mkdir(path.dirname(saveToFile), { recursive: true });
        await fs.writeFile(saveToFile, JSON.stringify(multiproof, null, 2), 'utf-8');
    }

    return multiproof;
}

/**
 * Loads an optimized multiproof from a file.
 * 
 * @param filePath Path to the multiproof JSON file
 * @returns Optimized multiproof data
 */
export async function loadOptimizedMultiproofFromFile(
    filePath: string
): Promise<OptimizedMerkleMultiproof> {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as OptimizedMerkleMultiproof;
}

