pragma circom 2.2.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";

/**
 * Distance Attestation Circuit
 * 
 * Verifies Manhattan distance calculation between two location attestations.
 * 
 * Public Inputs (5 total):
 * 1. locationMerkleRoot1 - Location 1 Merkle root (1 field element)
 * 2. locationMerkleRoot2 - Location 2 Merkle root (1 field element)
 * 3. coordinatesHash1 - Poseidon hash(x1, y1, z1, salt1) from location proof 1 (1 field element)
 * 4. coordinatesHash2 - Poseidon hash(x2, y2, z2, salt2) from location proof 2 (1 field element)
 * 5. distanceSquaredMeters - Distance squared (1 field element)
 * 
 * Public Outputs (1 total):
 * 1. maxTimestamp - Maximum of timestamp1 and timestamp2 (1 field element)
 *    - Timestamps are verified in location proofs, this is the max for data encapsulation
 * 
 * Note: Timestamps are verified in location circuits and passed as public outputs.
 * Distance circuit reads timestamps from location proof public signals and computes max.
 * 
 * Private Inputs (Witness):
 * - x1, y1, z1 - Coordinates from location 1 (u64 values as field elements, unsigned)
 * - salt1 - Salt from location 1 (field element, reduced modulo BN254 field) for brute-force protection
 * - x2, y2, z2 - Coordinates from location 2 (u64 values as field elements, unsigned)
 * - salt2 - Salt from location 2 (field element, reduced modulo BN254 field) for brute-force protection
 * - timestamp1 - Timestamp from location 1 (u64 as field element) - from location proof public output
 * - timestamp2 - Timestamp from location 2 (u64 as field element) - from location proof public output
 * - objectLocation1 - Should match locationMerkleRoot1 (for verification)
 * - objectLocation2 - Should match locationMerkleRoot2 (for verification)
 * 
 * Circuit Logic:
 * 1. Verify coordinatesHash1 = Poseidon(x1, y1, z1, salt1)
 * 2. Verify coordinatesHash2 = Poseidon(x2, y2, z2, salt2)
 * 3. Verify objectLocation1 matches locationMerkleRoot1
 * 4. Verify objectLocation2 matches locationMerkleRoot2
 * 5. Calculate and verify Manhattan distance squared
 * 6. Compute and output max(timestamp1, timestamp2)
 */

// Helper template to compute absolute difference for u64 coordinates
// For u64, we compare x1 and x2 to determine which is larger
template AbsDiff() {
    signal input a;  // First coordinate (u64)
    signal input b;  // Second coordinate (u64)
    signal output out;  // |a - b|
    
    // Check if a < b
    component isLess = LessThan(64); // u64 values fit in 64 bits
    isLess.in[0] <== a;
    isLess.in[1] <== b;
    
    // If a < b, then a - b wraps, so we compute b - a instead
    // If a >= b, then a - b is positive
    signal diff1;
    diff1 <== a - b;  // This wraps if a < b
    
    signal diff2;
    diff2 <== b - a;  // This is positive if a < b
    
    // Use Mux1 to select: if a < b, use diff2 (b - a), else use diff1 (a - b)
    component mux = Mux1();
    mux.c[0] <== diff1;  // a >= b case
    mux.c[1] <== diff2;  // a < b case
    mux.s <== isLess.out;
    
    out <== mux.out;
}

template DistanceAttestationCircuit() {
    // ========== PUBLIC INPUTS ==========
    signal input locationMerkleRoot1;           // Location 1 Merkle root (1 field element)
    signal input locationMerkleRoot2;           // Location 2 Merkle root (1 field element)
    signal input coordinatesHash1;             // Poseidon hash from location proof 1 (1 field element)
    signal input coordinatesHash2;             // Poseidon hash from location proof 2 (1 field element)
    signal input distanceSquaredMeters;          // Distance squared (1 field element)
    
    // ========== PUBLIC OUTPUTS ==========
    signal output maxTimestamp;                 // Maximum of timestamp1 and timestamp2 (1 field element)
    
    // ========== PRIVATE INPUTS (Witness) ==========
    signal input x1, y1, z1;                    // Coordinates from location 1 (u64 values as field elements, unsigned)
    signal input salt1;                         // Salt from location 1 (for brute-force protection)
    signal input x2, y2, z2;                    // Coordinates from location 2 (u64 values as field elements, unsigned)
    signal input salt2;                         // Salt from location 2 (for brute-force protection)
    signal input timestamp1;                    // Timestamp from location 1 (u64 as field element)
    signal input timestamp2;                    // Timestamp from location 2 (u64 as field element)
    signal input objectLocation1;               // Should match locationMerkleRoot1 (1 field element)
    signal input objectLocation2;               // Should match locationMerkleRoot2 (1 field element)
    
    // ========== VERIFICATION ==========
    
    // 1. Verify coordinatesHash1 = Poseidon(x1, y1, z1, salt1)
    component hashCoords1 = Poseidon(4);
    hashCoords1.inputs[0] <== x1;
    hashCoords1.inputs[1] <== y1;
    hashCoords1.inputs[2] <== z1;
    hashCoords1.inputs[3] <== salt1;
    hashCoords1.out === coordinatesHash1;
    
    // 2. Verify coordinatesHash2 = Poseidon(x2, y2, z2, salt2)
    component hashCoords2 = Poseidon(4);
    hashCoords2.inputs[0] <== x2;
    hashCoords2.inputs[1] <== y2;
    hashCoords2.inputs[2] <== z2;
    hashCoords2.inputs[3] <== salt2;
    hashCoords2.out === coordinatesHash2;
    
    // 3. Verify objectLocation1 matches locationMerkleRoot1
    component verifyLocation1 = IsEqual();
    verifyLocation1.in[0] <== objectLocation1;
    verifyLocation1.in[1] <== locationMerkleRoot1;
    verifyLocation1.out === 1;
    
    // 4. Verify objectLocation2 matches locationMerkleRoot2
    component verifyLocation2 = IsEqual();
    verifyLocation2.in[0] <== objectLocation2;
    verifyLocation2.in[1] <== locationMerkleRoot2;
    verifyLocation2.out === 1;
    
    // 5. Calculate and verify Manhattan distance squared
    // Manhattan Distance = |x1 - x2| + |y1 - y2| + |z1 - z2|
    // Distance Squared = (Manhattan Distance)²
    // 
    // Note: Coordinates are u64 (unsigned), so we use AbsDiff to compute absolute differences
    // by comparing which coordinate is larger.
    
    // dx = |x1 - x2|
    component absDiffX = AbsDiff();
    absDiffX.a <== x1;
    absDiffX.b <== x2;
    
    // dy = |y1 - y2|
    component absDiffY = AbsDiff();
    absDiffY.a <== y1;
    absDiffY.b <== y2;
    
    // dz = |z1 - z2|
    component absDiffZ = AbsDiff();
    absDiffZ.a <== z1;
    absDiffZ.b <== z2;
    
    // distance = dx + dy + dz
    signal sumXY;
    sumXY <== absDiffX.out + absDiffY.out;
    
    signal distance;
    distance <== sumXY + absDiffZ.out;
    
    // distanceSquared = distance²
    signal distanceSquared;
    distanceSquared <== distance * distance;
    
    // Verify distanceSquared matches public input
    distanceSquared === distanceSquaredMeters;
    
    // 6. Compute and output max(timestamp1, timestamp2)
    // Check if timestamp1 < timestamp2
    component isTimestamp1Less = LessThan(64); // u64 values fit in 64 bits
    isTimestamp1Less.in[0] <== timestamp1;
    isTimestamp1Less.in[1] <== timestamp2;
    
    // If timestamp1 < timestamp2, use timestamp2, else use timestamp1
    component muxTimestamp = Mux1();
    muxTimestamp.c[0] <== timestamp1;  // timestamp1 >= timestamp2 case
    muxTimestamp.c[1] <== timestamp2;  // timestamp1 < timestamp2 case
    muxTimestamp.s <== isTimestamp1Less.out;
    
    maxTimestamp <== muxTimestamp.out;
}

component main { public [locationMerkleRoot1, locationMerkleRoot2, coordinatesHash1, coordinatesHash2, distanceSquaredMeters] } = DistanceAttestationCircuit();
