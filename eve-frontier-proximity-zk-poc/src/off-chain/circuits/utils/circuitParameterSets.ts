import { ProtoPODGPCCircuitParams } from "@pcd/gpcircuits";

/**
 * Supported circuit parameter sets for off-chain POD/GPC circuits.
 * These parameters define the constraints and capabilities of each circuit.
 */
export interface SupportedGPCCircuitParams extends ProtoPODGPCCircuitParams {
    circuitId: string; // Human-readable identifier (e.g., 'location', 'distance')
}

/**
 * Circuit parameter sets for the circuits used in this project.
 * 
 * These parameters determine:
 * - maxEntries: Maximum number of POD entries
 * - maxSigners: Maximum number of signers
 * - maxVEntries: Maximum virtual entries (for membership proofs, etc.)
 * - Other constraints based on circuit requirements
 */
/**
 * Calculate merkle tree depth needed for a given number of entries.
 * Each POD entry has 2 leaves (one for the name, one for the value).
 * Depth = ceil(log2(maxEntries * 2))
 */
function calculateMerkleDepth(maxEntries: number): number {
    const totalLeaves = maxEntries * 2;
    return Math.ceil(Math.log2(totalLeaves));
}

export const supportedParameterSets: SupportedGPCCircuitParams[] = [
    {
        circuitId: 'location',
        maxObjects: 1,  // Single POD
        maxEntries: 10, // Location POD has: objectId, solarSystem, x_coord, y_coord, z_coord, timestamp, pod_data_type, salt, poseidon_merkle_root, ed25519_signature
        merkleMaxDepth: calculateMerkleDepth(10), // 10 entries * 2 leaves = 20 leaves, depth = ceil(log2(20)) = 5
        maxNumericValues: 0, // No numeric value constraints
        maxEntryInequalities: 0, // No entry inequalities
        maxLists: 0, // No lists
        maxListElements: 0, // No list elements
        maxTuples: 0, // No tuples
        tupleArity: 0, // No tuple arity
        includeOwnerV3: false, // No owner verification V3
        includeOwnerV4: false, // No owner verification V4
    },
    {
        circuitId: 'distance',
        maxObjects: 2,  // Location POD (server-attested) + Custom POD (player/corporation-attested)
        maxEntries: 10, // Location POD has 10 entries. Custom POD entries vary by use case (waypoint, contract, claim, etc.)
        merkleMaxDepth: calculateMerkleDepth(10), // 10 entries * 2 leaves = 20 leaves, depth = ceil(log2(20)) = 5
        maxNumericValues: 0, // No numeric value constraints (would need POD entries to constrain)
        maxEntryInequalities: 0, // No entry inequalities (would need POD entries to compare)
        maxLists: 0, // No lists
        maxListElements: 0, // No list elements
        maxTuples: 0, // No tuples
        tupleArity: 0, // No tuple arity
        includeOwnerV3: false, // No owner verification V3
        includeOwnerV4: false, // No owner verification V4
    }
];

