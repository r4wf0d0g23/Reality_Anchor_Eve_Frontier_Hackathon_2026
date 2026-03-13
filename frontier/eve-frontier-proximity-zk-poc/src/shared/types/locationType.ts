
export interface SolarSystemCoords {
  x: number;
  y: number;
  z: number;
}

/**
 * Data structure representing a Location Attestation POD.
 */
export interface LocationAttestationData {
    objectId: string;              // on-chain ID of the object whose location is attested
    solarSystem: number;           // solar system ID of the object's location
    coordinates: SolarSystemCoords; // location coordinates used for distance calculation step
    pod_data_type: string;         // 'evefrontier.location_attestation'
    timestamp: bigint;             // timestamp of the location attestation POD
    salt: string;                   // 32-byte salt (hex string) for Merkle root randomization
}