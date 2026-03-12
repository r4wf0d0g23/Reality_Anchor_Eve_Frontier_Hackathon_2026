/**
 * Data structure representing a Distance Attestation POD.
 */
export interface DistanceAttestationData {
    objectId1: string;              // ID of the first object (e.g., ship) - Move Object ID
    objectId2: string;              // ID of the second object (e.g., assembly) - Move Object ID
    objectLocation1: string;        // sha256_merkle_root of object1 location attestation POD (for on-chain verification)
    objectLocation2: string;        // sha256_merkle_root of object2 location attestation POD (for on-chain verification)
    distanceSquaredMeters: bigint;  // Calculated distance squared
    pod_data_type: string;          // 'evefrontier.distance_attestation'
    timestamp: bigint;              // Timestamp of the distance attestation POD
}