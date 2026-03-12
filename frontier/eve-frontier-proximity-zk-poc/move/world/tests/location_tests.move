#[test_only]
module world::location_tests {
    use world::location;

    /// Test creating LocationType
    #[test]
    fun test_create_location_type() {
        let fixed_type = location::create_location_type(true);
        assert!(location::is_fixed(&fixed_type), 1);
        
        let dynamic_type = location::create_location_type(false);
        assert!(!location::is_fixed(&dynamic_type), 2);
    }

    /// Test creating LocationData
    #[test]
    fun test_create_location_data() {
        let merkle_root = b"test_merkle_root_32_bytes_long!!";
        let coordinates_hash = b"test_coords_hash_32_bytes_long!!";
        let timestamp = 1000u64;
        
        let location_data = location::create_location_data(merkle_root, coordinates_hash, timestamp);
        
        // Test getters
        assert!(location::merkle_root(&location_data) == merkle_root, 1);
        assert!(location::coordinates_hash(&location_data) == coordinates_hash, 2);
        assert!(location::timestamp(&location_data) == timestamp, 3);
    }

    /// Test LocationData getters
    #[test]
    fun test_location_data_getters() {
        let merkle_root = b"test_merkle_root_32_bytes_long!!";
        let coordinates_hash = b"test_coords_hash_32_bytes_long!!";
        let timestamp = 1234u64;
        
        let location_data = location::create_location_data(merkle_root, coordinates_hash, timestamp);
        
        // Test get_merkle_root
        let merkle_root_result = location::merkle_root(&location_data);
        assert!(merkle_root_result == merkle_root, 1);
        
        // Test get_coordinates_hash
        let coords_hash_result = location::coordinates_hash(&location_data);
        assert!(coords_hash_result == coordinates_hash, 2);
        
        // Test get_timestamp
        let timestamp_result = location::timestamp(&location_data);
        assert!(timestamp_result == timestamp, 3);
    }
}
