pragma circom 2.2.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";

/**
 * Location Attestation Circuit
 * 
 * Verifies that coordinates and timestamp are cryptographically bound to a Poseidon Merkle root.
 * 
 * Public Inputs (3 total):
 * 1. merkleRoot - Poseidon Merkle root (1 field element)
 * 2. coordinatesHash - Poseidon hash(x, y, z, salt) for distance circuit (1 field element)
 *    - Includes salt for brute-force protection
 * 3. signatureAndKeyHash - Poseidon hash of (Ed25519 signature || public key) (1 field element)
 *    - Signature (64 bytes) + public key (32 bytes) = 96 bytes → 4 field elements → Poseidon(4) → 1 field element
 * 
 * Public Outputs (1 total):
 * 1. timestamp - Timestamp (1 field element) - verified in Merkle root, output for distance circuit
 * 
 * Note: We verify coordinate and timestamp leaf hashes are in the Merkle root via multiproof verification.
 * Coordinates (u64) are hashed directly: poseidon1(coordinate_value), no BCS encoding needed.
 * Timestamp (u64) is also hashed directly: poseidon1(timestamp_value).
 * Field identification comes from leaf index (z_coord_x, z_coord_y, z_coord_z, z_timestamp are adjacent in sorted order), not from hash content.
 * 
 * Note: Both signature and public key are hashed together to keep within public input limits.
 * 
 * Private Inputs (Witness):
 * - coordinates[3] - x, y, z coordinates (u64 values as field elements, unsigned)
 * - salt - Salt value (field element, reduced modulo BN254 field) for brute-force protection
 * - timestamp - Timestamp value (u64 as field element)
 * - siblingLevel1 - Sibling at level 1 (parent4567)
 * 
 * Circuit Logic:
 * 1. Compute leaf hashes from coordinates and timestamp directly using Poseidon(1)
 * 2. Verify multiproof for all 4 values (coord_x, coord_y, coord_z, timestamp) - optimized single proof
 * 3. Compute coordinate hash for distance circuit (includes salt for brute-force protection)
 * 4. Output timestamp as public output for use in distance circuit
 */

// No BCS conversion needed - coordinates are u64 values that fit in field elements
// We hash them directly: poseidon1(coordinate_value)

// MerkleVerifierLevel: verifies one level of a Merkle path
// Based on reference implementation from https://github.com/mjerkov/membership
template MerkleVerifierLevel() {
    signal input sibling;
    signal input low;        // Current hash (leaf or previous level's root)
    signal input selector;    // Path index (0 = left, 1 = right)
    signal output root;
    
    component sw = Switcher();
    component hash = Poseidon(2);
    
    sw.sel <== selector;
    sw.L <== low;           // Current hash goes to left input
    sw.R <== sibling;       // Sibling goes to right input
    
    hash.inputs[0] <== sw.outL;
    hash.inputs[1] <== sw.outR;
    
    root <== hash.out;
}

// Optimized multiproof verification for 4 adjacent leaves
// Tree structure (depth 3, 8 leaves):
//   Level 0: (0,1), (2,3), (4,5), (6,7)
//   Level 1: (parent01, parent23), (parent45, parent67)
//   Level 2: (parent0123, parent4567) → root
// 
// For our coordinate and timestamp fields at indices 4, 5, 6, 7:
//   - leaf0 = timestamp (index 4)
//   - leaf1 = x_coord (index 5)
//   - leaf2 = y_coord (index 6)
//   - leaf3 = z_coord (index 7)
//   - Compute parent45 from leaf0 and leaf1 (level 0)
//   - Compute parent67 from leaf2 and leaf3 (level 0)
//   - Compute parent4567 from parent45 and parent67 (level 1)
//   - Compute root from parent4567 and parent0123 (level 2)
//   - siblingLevel1 = parent0123 (computed from leaves 0-3: objectId, pod_data_type, salt, solarSystem)
// All 4 leaves are verified in the Merkle root
template VerifyMultiProof4Leaves() {
    signal input leaf0;  // timestamp leaf hash (index 4 in sorted tree)
    signal input leaf1;  // x_coord leaf hash (index 5 in sorted tree)
    signal input leaf2;  // y_coord leaf hash (index 6 in sorted tree)
    signal input leaf3;  // z_coord leaf hash (index 7 in sorted tree)
    signal input siblingLevel1;  // Sibling at level 2 (parent0123, from leaves 0-3)
    signal input root;   // Merkle root
    
    // Level 0: timestamp (left) and x_coord (right) are siblings (indices 4, 5)
    component hashLevel0Pair0 = Poseidon(2);
    hashLevel0Pair0.inputs[0] <== leaf0;  // timestamp (left, index 4)
    hashLevel0Pair0.inputs[1] <== leaf1;  // x_coord (right, index 5)
    var parent45 = hashLevel0Pair0.out;
    
    // Level 0: y_coord (left) and z_coord (right) are siblings (indices 6, 7)
    component hashLevel0Pair1 = Poseidon(2);
    hashLevel0Pair1.inputs[0] <== leaf2;  // y_coord (left, index 6)
    hashLevel0Pair1.inputs[1] <== leaf3;  // z_coord (right, index 7)
    var parent67 = hashLevel0Pair1.out;
    
    // Level 1: parent45 (left) and parent67 (right) are siblings
    component hashLevel1 = Poseidon(2);
    hashLevel1.inputs[0] <== parent45;  // left child
    hashLevel1.inputs[1] <== parent67;  // right child
    var parent4567 = hashLevel1.out;
    
    // Level 2: parent0123 (left) and parent4567 (right) are siblings
    // Path indices 0,1,1 indicate parent4567 is on the right at level 2
    // So root = poseidon2(parent0123, parent4567)
    component hashLevel2 = Poseidon(2);
    hashLevel2.inputs[0] <== siblingLevel1;  // left child (parent0123, from leaves 0-3)
    hashLevel2.inputs[1] <== parent4567;  // right child (from coordinate and timestamp fields)
    
    // Verify computed root matches public input
    root === hashLevel2.out;
}

template LocationAttestationCircuit() {
    // ========== PUBLIC INPUTS ==========
    signal input merkleRoot;                    // Poseidon Merkle root (1 field element)
    signal input coordinatesHash;               // Poseidon hash(x, y, z, salt) for distance circuit (1 field element)
    signal input signatureAndKeyHash;           // Poseidon hash(signature || public key) (1 field element)
    
    // ========== PUBLIC OUTPUTS ==========
    // None - timestamp is verified in Merkle proof, distance circuit can read from locationData
    
    // ========== PRIVATE INPUTS (Witness) ==========
    signal input coordinates[3];                // [x, y, z] coordinates (u64 values as field elements, unsigned)
    signal input salt;                          // Salt value (field element) for brute-force protection
    signal input timestampWitness;              // Timestamp value (u64 as field element)
    signal input siblingLevel1;                 // Sibling at level 1 (parent4567)
    
    // ========== VERIFICATION ==========
    
    // 1. Compute leaf hashes from coordinates and timestamp directly (no BCS conversion needed)
    // Coordinates and timestamp are u64 values that fit in field elements, so we hash them directly
    // Field identification comes from leaf index (x_coord, y_coord, z_coord, timestamp are adjacent)
    
    component coordXHash = Poseidon(1);
    coordXHash.inputs[0] <== coordinates[0]; // x coordinate (u64 as field element)
    var coordXLeafHash = coordXHash.out;
    
    component coordYHash = Poseidon(1);
    coordYHash.inputs[0] <== coordinates[1]; // y coordinate (u64 as field element)
    var coordYLeafHash = coordYHash.out;
    
    component coordZHash = Poseidon(1);
    coordZHash.inputs[0] <== coordinates[2]; // z coordinate (u64 as field element)
    var coordZLeafHash = coordZHash.out;
    
    component timestampHash = Poseidon(1);
    timestampHash.inputs[0] <== timestampWitness; // timestamp (u64 as field element)
    var timestampLeafHash = timestampHash.out;
    
    // 2. Verify multiproof for all 4 values (x_coord, y_coord, z_coord, timestamp) - optimized single proof
    // Since x_coord, y_coord, z_coord, timestamp are adjacent in sorted order, they share path elements.
    // Tree structure (depth 3, 8 leaves):
    //   Level 0: (x_coord, y_coord) → parent, (z_coord, timestamp) → parent
    //   Level 1: (parent, parent) → parent, (parent, parent) → parent
    //   Level 2: (parent, parent) → root
    component verifyMultiProof = VerifyMultiProof4Leaves();
    verifyMultiProof.leaf0 <== timestampLeafHash;  // timestamp (index 4)
    verifyMultiProof.leaf1 <== coordXLeafHash;     // x_coord (index 5)
    verifyMultiProof.leaf2 <== coordYLeafHash;     // y_coord (index 6)
    verifyMultiProof.leaf3 <== coordZLeafHash;     // z_coord (index 7)
    verifyMultiProof.siblingLevel1 <== siblingLevel1;
    verifyMultiProof.root <== merkleRoot;
    
    // 3. Compute coordinate hash for distance circuit
    // This is a Poseidon hash of the 3 coordinates + salt (for brute-force protection)
    component coordHash = Poseidon(4);
    coordHash.inputs[0] <== coordinates[0]; // x
    coordHash.inputs[1] <== coordinates[1]; // y
    coordHash.inputs[2] <== coordinates[2]; // z
    coordHash.inputs[3] <== salt;            // salt
    coordHash.out === coordinatesHash; // Verify matches public input
    
    // Note: Timestamp is verified as part of the Merkle proof (z_timestamp leaf)
    // The distance circuit can read it from the location proof's public signals if needed
    // No need for a public output here - the Merkle proof already cryptographically binds it
}

component main { public [merkleRoot, coordinatesHash, signatureAndKeyHash] } = LocationAttestationCircuit();
