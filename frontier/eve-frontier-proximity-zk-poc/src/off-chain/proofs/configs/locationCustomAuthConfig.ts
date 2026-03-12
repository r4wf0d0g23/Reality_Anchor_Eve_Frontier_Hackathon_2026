// NOTE: The import for GPC types needs to be fixed based on your project structure.
import { GPCProofConfig, GPCProofEntryConfig } from "@pcd/gpc";
import { PODName } from "@pcd/pod";

// Define POD integer range constants (as defined in @pcd/pod)
// const POD_INT_MIN = -(1n << 63n);
// const POD_INT_MAX = (1n << 63n) - 1n;

// GPC Proof Configuration for Location + Custom POD Attestation
// Combines server-attested location PODs with player/corporation-attested custom PODs
//
// Use Cases:
// 1. **Player Waypoints/Beacons**: Player creates a POD marking a location of interest,
//    combined with server location POD to prove the waypoint is at a valid location
//
// 2. **Corporate Contracts/Offers**: Corporation POD attesting to a contract/offer,
//    combined with location POD to prove the contract is valid for a specific location/region
//
// 3. **Resource Claims**: Player POD claiming a resource at a location,
//    verified against server location POD to prove the claim is at a valid location
//
// 4. **Guild/Corporation Operations**: Corporation POD attesting to an operation,
//    combined with member location PODs to prove members are in the operation area
//
// 5. **Player-to-Player Interactions**: One player's POD (trade offer, message, etc.)
//    combined with location PODs to prove proximity-based interactions
//
// The proof verifies:
// - Both PODs are valid and signed by their respective signers
// - Location POD is server-attested (proves valid game location)
// - Custom POD is player/corporation-attested (proves player/corp intent/claim)
// - Both are from the same time window (time-synced)
// - Location coordinates remain private (privacy-preserving)
export const locationCustomAuthConfig: GPCProofConfig = {
  pods: {
    location: { // Server-attested location POD
      contentID: {
        isRevealed: true // contentID of the location POD is revealed
      },
      signerPublicKey: {
        isRevealed: true // Server's public key revealed
      },
      entries: {
        objectId: { isRevealed: true },
        solarSystem: { isRevealed: false },
        x_coord: { isRevealed: false }, // Coordinates remain private
        y_coord: { isRevealed: false },
        z_coord: { isRevealed: false },
        timestamp: { isRevealed: true }, // Revealed for time window comparison
        pod_data_type: { isRevealed: true },
        salt: { isRevealed: false },
        poseidon_merkle_root: { isRevealed: true },
        ed25519_signature: { isRevealed: true },
      }
    },
    custom: { // Player/Corporation-attested custom POD
      contentID: {
        isRevealed: true // contentID of the custom POD is revealed
      },
      signerPublicKey: {
        isRevealed: true // Player/Corporation's public key revealed
      },
      entries: {
        // Custom entries depend on use case - examples:
        // - waypoint_name, waypoint_type (for waypoints)
        // - contract_id, contract_terms (for contracts)
        // - resource_type, resource_claim_id (for resource claims)
        // - operation_id, operation_type (for corporation operations)
        // These would be defined based on the specific custom POD structure
        // For now, we use a flexible structure that can be extended
        timestamp: { isRevealed: true }, // Revealed for time window comparison
        pod_data_type: { isRevealed: true },
        // Additional custom entries would be added here based on use case
      }
    }
  }
};