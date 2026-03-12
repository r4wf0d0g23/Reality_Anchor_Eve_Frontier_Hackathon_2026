#[test_only]
module world::authority_tests {
    use world::authority;
    use sui::test_scenario;

    /// Test that ApprovedSigners can be created for testing
    #[test]
    fun test_approved_signers_created_in_init() {
        let mut scenario_val = test_scenario::begin(@0x1);
        let ctx = test_scenario::ctx(&mut scenario_val);
        
        let approved_signers = authority::create_approved_signers_for_testing(ctx);
        
        // Verify it was created
        let signers_id = object::id(&approved_signers);
        assert!(signers_id != object::id_from_address(@0x0), 1);
        
        // Transfer to consume
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test adding an approved signer
    #[test]
    fun test_add_approved_signer() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let mut approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        let signer = @0x123;
        
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::add_approved_signer(&mut approved_signers, signer, &admin, ctx);
        };
        
        assert!(authority::is_approved_signer(&approved_signers, signer), 1);
        
        // Transfer objects to consume them
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test removing an approved signer
    #[test]
    fun test_remove_approved_signer() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let mut approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        let signer = @0x123;
        
        // Add then remove
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::add_approved_signer(&mut approved_signers, signer, &admin, ctx);
        };
        assert!(authority::is_approved_signer(&approved_signers, signer), 1);
        
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::remove_approved_signer(&mut approved_signers, signer, &admin, ctx);
        };
        assert!(!authority::is_approved_signer(&approved_signers, signer), 2);
        
        // Transfer objects to consume them
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test checking if an approved signer is approved
    #[test]
    fun test_is_approved_signer_approved() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let mut approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        let signer = @0x123;
        
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::add_approved_signer(&mut approved_signers, signer, &admin, ctx);
        };
        
        // Should return true
        assert!(authority::is_approved_signer(&approved_signers, signer), 1);
        
        // Transfer objects to consume them
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test checking if an unapproved signer is approved
    #[test]
    fun test_is_approved_signer_unapproved() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        let signer = @0x123;
        
        // Should return false - signer not approved
        assert!(!authority::is_approved_signer(&approved_signers, signer), 1);
        
        // Transfer object to consume it
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test adding duplicate signer (should abort)
    #[test]
    #[expected_failure(abort_code = 1, location = world::authority)]
    fun test_add_duplicate_signer() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let mut approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        let signer = @0x123;
        
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::add_approved_signer(&mut approved_signers, signer, &admin, ctx);
            // Try to add again - should abort
            authority::add_approved_signer(&mut approved_signers, signer, &admin, ctx);
        };
        
        // Transfer objects to consume them (though test will abort)
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test removing non-existent signer (should abort)
    #[test]
    #[expected_failure(abort_code = 2, location = world::authority)]
    fun test_remove_nonexistent_signer() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let mut approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        let signer = @0x123;
        
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            // Try to remove without adding - should abort
            authority::remove_approved_signer(&mut approved_signers, signer, &admin, ctx);
        };
        
        // Transfer objects to consume them (though test will abort)
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test creating owner cap
    #[test]
    fun test_create_owner_cap() {
        let mut scenario_val = test_scenario::begin(@0x1);
        {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
            let object_uid = object::new(ctx);
            let _object_id = object::uid_to_inner(&object_uid);
            object::delete(object_uid); // Consume the UID
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        
        let object_uid = object::new(test_scenario::ctx(&mut scenario_val));
        let object_id = object::uid_to_inner(&object_uid);
        object::delete(object_uid); // Consume the UID
        
        let owner_cap = {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::create_owner_cap(&admin, object_id, ctx)
        };
        
        assert!(authority::is_authorized(&owner_cap, object_id), 1);
        
        // Transfer objects to consume them
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        authority::transfer_owner_cap_test(owner_cap, @0x2);
        test_scenario::end(scenario_val);
    }

    /// Test is_authorized for owner cap
    #[test]
    fun test_is_authorized() {
        let mut scenario_val = test_scenario::begin(@0x1);
        let (object_id, wrong_object_id) = {
            let ctx = test_scenario::ctx(&mut scenario_val);
            let approved_signers = authority::create_approved_signers_for_testing(ctx);
            authority::transfer_approved_signers(approved_signers, @0x1); // Transfer to sender
            authority::create_admin_cap(@0x1, ctx);
            let object_uid1 = object::new(ctx);
            let object_id = object::uid_to_inner(&object_uid1);
            object::delete(object_uid1); // Consume the UID
            let object_uid2 = object::new(ctx);
            let wrong_object_id = object::uid_to_inner(&object_uid2);
            object::delete(object_uid2); // Consume the UID
            (object_id, wrong_object_id)
        };
        test_scenario::next_tx(&mut scenario_val, @0x1);
        let admin = test_scenario::take_from_sender<authority::AdminCap>(&scenario_val);
        let approved_signers = test_scenario::take_from_sender<authority::ApprovedSigners>(&scenario_val);
        
        let owner_cap = {
            let ctx = test_scenario::ctx(&mut scenario_val);
            authority::create_owner_cap(&admin, object_id, ctx)
        };
        
        assert!(authority::is_authorized(&owner_cap, object_id), 1);
        assert!(!authority::is_authorized(&owner_cap, wrong_object_id), 2);
        
        // Transfer objects to consume them
        authority::transfer_admin_cap(admin, @0x2);
        authority::transfer_approved_signers(approved_signers, @0x2);
        authority::transfer_owner_cap_test(owner_cap, @0x2);
        test_scenario::end(scenario_val);
    }
}
