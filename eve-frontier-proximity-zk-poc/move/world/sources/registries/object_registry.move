/// Object Registry
/// Unified registry for:
/// - Deterministic object ID generation (via derived_object::claim)
/// - Location type, location data, and distance data storage
/// Location data is keyed by object ID
/// Distance data is keyed by objectId1+objectId2
module world::object_registry;

use sui::table::{Self, Table};
use sui::address;
use sui::{event, types, derived_object};
use sui::object as sui_object;
use world::location::{Self, LocationType, LocationData};

/// Distance data stored for fixed location pairs
/// Stores both max_timestamp and distance_squared_meters
public struct DistanceData has store, copy, drop {
    max_timestamp: u64,
    distance_squared_meters: u64,
}

/// One-Time Witness for the object registry module
/// Ensures ObjectRegistry can only be created once during package publishing
public struct OBJECT_REGISTRY has drop {}

/// Object Registry
/// Provides deterministic object ID generation and stores location/distance data
public struct ObjectRegistry has key {
    id: UID,                                    // For derived_object::claim (deterministic IDs)
    location_types: Table<address, LocationType>,      // objectId -> LocationType
    location_data: Table<address, LocationData>,        // objectId -> LocationData
    distances: Table<vector<u8>, DistanceData>,       // objectId1||objectId2 -> DistanceData
}

public struct ObjectRegistryCreated has copy, drop {
    registry_id: ID,
}

/// Initialize ObjectRegistry during package publishing
/// Uses One-Time Witness pattern to ensure it can only be created once
fun init(otw: OBJECT_REGISTRY, ctx: &mut TxContext) {
    // Verify that OBJECT_REGISTRY is a valid One-Time Witness
    assert!(types::is_one_time_witness(&otw), 0);
    
    let registry = ObjectRegistry {
        id: sui_object::new(ctx),
        location_types: table::new(ctx),
        location_data: table::new(ctx),
        distances: table::new(ctx),
    };

    event::emit(ObjectRegistryCreated {
        registry_id: sui_object::id(&registry),
    });

    // Share ObjectRegistry so it can be accessed by anyone
    transfer::share_object(registry);
}

/// Create key from two object IDs for distance data
/// Concatenates both addresses (32 bytes each = 64 bytes total)
fun create_distance_key(object_id1: address, object_id2: address): vector<u8> {
    let mut key = vector::empty<u8>();
    let addr1_bytes = address::to_bytes(object_id1);
    let addr2_bytes = address::to_bytes(object_id2);
    let mut i = 0;
    while (i < 32) {
        vector::push_back(&mut key, *vector::borrow(&addr1_bytes, i));
        i = i + 1;
    };
    i = 0;
    while (i < 32) {
        vector::push_back(&mut key, *vector::borrow(&addr2_bytes, i));
        i = i + 1;
    };
    key
}

// === Location Type Functions ===

// === Deterministic Object ID Functions ===

/// Borrow the registry ID for derived_object::claim
/// This allows modules to call derived_object::claim directly (required by bytecode verifier)
public(package) fun borrow_registry_id(registry: &mut ObjectRegistry): &mut UID {
    &mut registry.id
}

/// Check if an object exists for the given item_id
public fun object_exists(registry: &ObjectRegistry, item_id: u64): bool {
    derived_object::exists(&registry.id, item_id)
}

/// Compute the derived object address for a given item_id
/// This allows off-chain code to know the object ID before creation
/// Returns the address that will be used for the object with this item_id
public fun compute_derived_address(registry: &ObjectRegistry, item_id: u64): address {
    let parent_id = sui_object::uid_to_inner(&registry.id);
    derived_object::derive_address(parent_id, item_id)
}

// === Location Type Functions ===

/// Store location type for an object
public(package) fun store_location_type(
    registry: &mut ObjectRegistry,
    object_id: address,
    location_type: LocationType
) {
    if (table::contains(&registry.location_types, object_id)) {
        let existing = table::borrow_mut(&mut registry.location_types, object_id);
        *existing = location_type;
    } else {
        table::add(&mut registry.location_types, object_id, location_type);
    };
}

/// Get location type for an object
public fun get_location_type(
    registry: &ObjectRegistry,
    object_id: address
): std::option::Option<LocationType> {
    if (table::contains(&registry.location_types, object_id)) {
        std::option::some(*table::borrow(&registry.location_types, object_id))
    } else {
        std::option::none()
    }
}

// === Location Data Functions ===

/// Store location data for an object
/// Only updates if new timestamp >= existing timestamp
public(package) fun store_location_data(
    registry: &mut ObjectRegistry,
    object_id: address,
    location_data: LocationData
): bool {
    if (table::contains(&registry.location_data, object_id)) {
        let existing = table::borrow(&registry.location_data, object_id);
        // Check if new data is stale
        if (location::timestamp(&location_data) < location::timestamp(existing)) {
            return false
        };
        // Update existing data
        let existing_mut = table::borrow_mut(&mut registry.location_data, object_id);
        *existing_mut = location_data;
    } else {
        table::add(&mut registry.location_data, object_id, location_data);
    };
    true
}

/// Get location data for an object
public fun get_location_data(
    registry: &ObjectRegistry,
    object_id: address
): std::option::Option<LocationData> {
    if (table::contains(&registry.location_data, object_id)) {
        std::option::some(*table::borrow(&registry.location_data, object_id))
    } else {
        std::option::none()
    }
}

// === Distance Data Functions ===

/// Store distance data for a fixed location pair
/// Updates existing entry if it exists, otherwise adds a new entry
public(package) fun store_distance_data(
    registry: &mut ObjectRegistry,
    object_id1: address,
    object_id2: address,
    distance_data: DistanceData
) {
    let key = create_distance_key(object_id1, object_id2);
    if (table::contains(&registry.distances, key)) {
        let existing = table::borrow_mut(&mut registry.distances, key);
        *existing = distance_data;
    } else {
        table::add(&mut registry.distances, key, distance_data);
    };
}

/// Get distance data for a fixed location pair
/// Returns Some(DistanceData) if found, None otherwise
public fun get_distance_data(
    registry: &ObjectRegistry,
    object_id1: address,
    object_id2: address
): std::option::Option<DistanceData> {
    let key = create_distance_key(object_id1, object_id2);
    if (table::contains(&registry.distances, key)) {
        std::option::some(*table::borrow(&registry.distances, key))
    } else {
        std::option::none()
    }
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    // In tests, we can't use the real OTW, so we create ObjectRegistry directly
    // This is only for testing purposes
    let registry = ObjectRegistry {
        id: sui_object::new(ctx),
        location_types: table::new(ctx),
        location_data: table::new(ctx),
        distances: table::new(ctx),
    };
    transfer::share_object(registry);
}

/// Test-only function to create ObjectRegistry for testing
/// In production, ObjectRegistry is created in init()
#[test_only]
public fun create_registry_for_testing(ctx: &mut TxContext): ObjectRegistry {
    ObjectRegistry {
        id: sui_object::new(ctx),
        location_types: table::new(ctx),
        location_data: table::new(ctx),
        distances: table::new(ctx),
    }
}

/// Test-only helper to get the registry ID for proof generation
/// This allows off-chain scripts to compute deterministic object IDs
#[test_only]
public fun get_registry_id(registry: &ObjectRegistry): ID {
    object::uid_to_inner(&registry.id)
}

/// Test-only function to transfer ObjectRegistry
/// Used in tests to consume the registry
#[test_only]
public fun transfer_registry(registry: ObjectRegistry, recipient: address) {
    transfer::transfer(registry, recipient);
}

/// Get max timestamp from DistanceData
public fun max_timestamp(data: &DistanceData): u64 {
    data.max_timestamp
}

/// Get distance squared meters from DistanceData
public fun distance_squared_meters(data: &DistanceData): u64 {
    data.distance_squared_meters
}

/// Create DistanceData from components
public fun create_distance_data(
    max_timestamp: u64,
    distance_squared_meters: u64
): DistanceData {
    DistanceData {
        max_timestamp,
        distance_squared_meters,
    }
}

