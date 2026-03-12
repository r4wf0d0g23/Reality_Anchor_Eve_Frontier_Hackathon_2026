import { GPCProofConfig, GPCProofEntryConfig } from "@pcd/gpc";
import { PODName } from "@pcd/pod";

// Define POD integer range constants (as defined in @pcd/pod)
// const POD_INT_MIN = -(1n << 63n);
// const POD_INT_MAX = (1n << 63n) - 1n;

// Common structure for location attestation entries
// Note: POD entry names match generateLocationAttestationPod structure
// - Coordinates are named x_coord, y_coord, z_coord (not coord_x, coord_y, coord_z)
// - Merkle root is poseidon_merkle_root (Poseidon-based, not SHA256)
// - POD signature is EDDSA-Poseidon (different from ed25519_signature which signs the merkle root)
const locationAttestationConfig: Record<PODName, GPCProofEntryConfig> = {
  objectId: { isRevealed: true },
  solarSystem: { isRevealed: false },
  x_coord: { isRevealed: false },
  y_coord: { isRevealed: false }, 
  z_coord: { isRevealed: false },  
  timestamp: { isRevealed: true },
  pod_data_type: { isRevealed: true },
  salt: { isRevealed: false }, // Salt is private (not revealed in proof)
  poseidon_merkle_root: { isRevealed: true },  // Poseidon Merkle root for cryptographic binding
  ed25519_signature: { isRevealed: true },   // Ed25519 signature of merkle root (for on-chain verification)
};

// GPC Proof Configuration for Location Attestation (Single POD)
//
// Use Case: Prove knowledge of an object's location without revealing the exact coordinates
// - The location proof can be shared with other players to prove you know where something is
//   without revealing where it is (coordinates remain private)
// - Useful for privacy-preserving location verification, data marketplaces, and selective
//   information sharing where location knowledge needs to be proven but coordinates kept secret
export const fullLocationProofConfig: GPCProofConfig = {
  pods: {
    location: { // Single POD configuration key
      contentID: {
        isRevealed: true // contentID of the POD itself is revealed
      },
      signerPublicKey: {
        isRevealed: true // signer's public key revealed (similar to contentID, not a POD entry)
      },
      entries: locationAttestationConfig
    }
  }
};