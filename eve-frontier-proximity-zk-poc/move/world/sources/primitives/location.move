module world::location {
    /// Object location type
    public struct LocationType has copy, drop, store {
        is_fixed: bool,  // true = fixed location, false = dynamic location
    }

    /// Location data stored on-chain for an object
    public struct LocationData has store, copy, drop {
        merkle_root: vector<u8>,           // Merkle root from location attestation
        coordinates_hash: vector<u8>,      // Coordinates hash from location attestation
        timestamp: u64,                     // Timestamp from location attestation
    }

    /// Key for storing location type in dynamic field
    public struct LOCATION_TYPE_KEY has copy, drop, store {}

    /// Key for storing location data in dynamic field
    public struct LOCATION_DATA_KEY has copy, drop, store {}

    /// Create LOCATION_TYPE_KEY instance (needed for dynamic field access)
    public fun location_type_key(): LOCATION_TYPE_KEY {
        LOCATION_TYPE_KEY {}
    }

    /// Create LOCATION_DATA_KEY instance (needed for dynamic field access)
    public fun location_data_key(): LOCATION_DATA_KEY {
        LOCATION_DATA_KEY {}
    }

    /// Create LocationType from boolean
    public fun create_location_type(is_fixed: bool): LocationType {
        LocationType { is_fixed }
    }

    /// Create LocationData from components
    public fun create_location_data(
        merkle_root: vector<u8>,
        coordinates_hash: vector<u8>,
        timestamp: u64
    ): LocationData {
        LocationData {
            merkle_root,
            coordinates_hash,
            timestamp,
        }
    }

    /// Get location type from LocationType struct
    public fun is_fixed(location_type: &LocationType): bool {
        location_type.is_fixed
    }

    /// Get merkle root from LocationData
    public fun merkle_root(data: &LocationData): vector<u8> {
        data.merkle_root
    }

    /// Get coordinates hash from LocationData
    public fun coordinates_hash(data: &LocationData): vector<u8> {
        data.coordinates_hash
    }

    /// Get timestamp from LocationData
    public fun timestamp(data: &LocationData): u64 {
        data.timestamp
    }
}
