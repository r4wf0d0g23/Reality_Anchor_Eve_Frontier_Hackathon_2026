/// Distance data and functions
/// Uses ObjectRegistry for storage
module world::distance;

use world::object_registry::{Self, ObjectRegistry, DistanceData};

/// Store distance data for a fixed location pair
/// Updates existing entry if it exists, otherwise adds a new entry
public(package) fun store_distance_data(
    registry: &mut ObjectRegistry,
    object_id1: address,
    object_id2: address,
    distance_data: DistanceData
) {
    object_registry::store_distance_data(registry, object_id1, object_id2, distance_data);
}

/// Get distance data for a fixed location pair
/// Returns Some(DistanceData) if found, None otherwise
public fun get_distance_data(
    registry: &ObjectRegistry,
    object_id1: address,
    object_id2: address
): std::option::Option<DistanceData> {
    object_registry::get_distance_data(registry, object_id1, object_id2)
}

/// Get max timestamp from distance data
public fun max_timestamp(data: &DistanceData): u64 {
    object_registry::max_timestamp(data)
}

/// Get distance squared meters from distance data
public fun distance_squared_meters(data: &DistanceData): u64 {
    object_registry::distance_squared_meters(data)
}

/// Create DistanceData from components
public fun create_distance_data(
    max_timestamp: u64,
    distance_squared_meters: u64
): DistanceData {
    object_registry::create_distance_data(max_timestamp, distance_squared_meters)
}
