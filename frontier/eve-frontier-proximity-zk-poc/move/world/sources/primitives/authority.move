/// This module manages issuing capabilities for world objects for access control.
///
/// The module defines three levels of capabilities:
/// - `GovernorCap`: Top-level capability (defined in world module)
/// - `AdminCap`: Mid-level capability that can be created by the Governor
/// - `OwnerCap`: Object-level capability that can be created by Admins
///
/// This hierarchy allows for delegation of permissions:
/// - Governor can create/delete AdminCaps for specific addresses
/// - Admins can create/transfer/delete OwnerCaps
/// Future: Capability registry to support multi party access/shared control. (eg: A capability for corporatio/tribe with multiple members)
/// Capabilities based on different roles/permission in a corporation/tribe.

module world::authority;

use sui::{event, table::{Self, Table}, types};
// Note: GovernorCap would be defined in world module if needed
// use world::world::GovernorCap;

/// One-Time Witness for the authority module
/// Ensures ApprovedSigners can only be created once during package publishing
public struct AUTHORITY has drop {}

public struct AdminCap has key {
    id: UID,
    admin: address,
}

public struct OwnerCap has key {
    id: UID,
    owned_object_id: ID,
}

/// List of approved Ed25519 signer addresses for ZK proof verification
/// Maps signer address -> true if approved
public struct ApprovedSigners has key {
    id: UID,
    approved_signers: Table<address, bool>,
}

public struct AdminCapCreatedEvent has copy, drop {
    admin_cap_id: ID,
    admin: address,
}

public struct ApprovedSignersCreated has copy, drop {
    approved_signers_id: ID,
}

/// Initialize ApprovedSigners during package publishing
/// Uses One-Time Witness pattern to ensure it can only be created once
fun init(otw: AUTHORITY, ctx: &mut TxContext) {
    // Verify that AUTHORITY is a valid One-Time Witness
    assert!(types::is_one_time_witness(&otw), 0);
    
    // Create ApprovedSigners using one-time witness pattern
    // This ensures it can only be created once during package publishing
    let approved_signers = ApprovedSigners {
        id: object::new(ctx),
        approved_signers: table::new(ctx),
    };

    event::emit(ApprovedSignersCreated {
        approved_signers_id: object::id(&approved_signers),
    });

    // Share ApprovedSigners so anyone can read it for verification
    transfer::share_object(approved_signers);
}

// TODO: Add GovernorCap when world module is created
// public fun create_admin_cap(_: &GovernorCap, admin: address, ctx: &mut TxContext) {
public fun create_admin_cap(admin: address, ctx: &mut TxContext) {
    let admin_cap = AdminCap {
        id: object::new(ctx),
        admin: admin,
    };
    event::emit(AdminCapCreatedEvent {
        admin_cap_id: object::id(&admin_cap),
        admin: admin,
    });

    transfer::transfer(admin_cap, admin);
}

// TODO: Add GovernorCap when world module is created
// public fun delete_admin_cap(admin_cap: AdminCap, _: &GovernorCap) {
public fun delete_admin_cap(admin_cap: AdminCap) {
    let AdminCap { id, .. } = admin_cap;
    id.delete();
}

public fun create_owner_cap(_: &AdminCap, owned_object_id: ID, ctx: &mut TxContext): OwnerCap {
    OwnerCap {
        id: object::new(ctx),
        owned_object_id: owned_object_id,
    }
}

public fun transfer_owner_cap(owner_cap: OwnerCap, _: &AdminCap, owner: address) {
    transfer::transfer(owner_cap, owner);
}


// Ideally only the owner can delete the owner cap
public fun delete_owner_cap(owner_cap: OwnerCap, _: &AdminCap) {
    let OwnerCap { id, .. } = owner_cap;
    id.delete();
}

// Checks if the `OwnerCap` is allowed to access the object with the given `object_id`.
/// Returns true iff the `OwnerCap` has mutation access for the specified object.
public fun is_authorized(owner_cap: &OwnerCap, object_id: ID): bool {
    owner_cap.owned_object_id == object_id
}


/// Add a signer address to the approved list
/// Only callable by the admin
public fun add_approved_signer(
    approved_signers: &mut ApprovedSigners,
    signer: address,
    _admin: &AdminCap,
    _ctx: &TxContext
) {
    // Check if already approved
    assert!(!table::contains(&approved_signers.approved_signers, signer), 1);
    
    table::add(&mut approved_signers.approved_signers, signer, true);
}

/// Remove a signer address from the approved list
/// Only callable by the admin
public fun remove_approved_signer(
    approved_signers: &mut ApprovedSigners,
    signer: address,
    _admin: &AdminCap,
    _ctx: &TxContext
) {
    assert!(table::contains(&approved_signers.approved_signers, signer), 2);
    
    table::remove(&mut approved_signers.approved_signers, signer);
}

/// Check if a signer address is approved
public fun is_approved_signer(approved_signers: &ApprovedSigners, signer: address): bool {
    if (table::contains(&approved_signers.approved_signers, signer)) {
        *table::borrow(&approved_signers.approved_signers, signer)
    } else {
        false
    }
}

#[test_only]
public fun init_for_testing(ctx: &mut TxContext) {
    // In tests, we can't use the real OTW, so we create ApprovedSigners directly
    // This is only for testing purposes
    let approved_signers = ApprovedSigners {
        id: object::new(ctx),
        approved_signers: table::new(ctx),
    };
    transfer::share_object(approved_signers);
}

/// Test-only function to create ApprovedSigners for testing
/// In production, ApprovedSigners is created in init()
#[test_only]
public fun create_approved_signers_for_testing(ctx: &mut TxContext): ApprovedSigners {
    ApprovedSigners {
        id: object::new(ctx),
        approved_signers: table::new(ctx),
    }
}

#[test_only]
public fun transfer_admin_cap(admin: AdminCap, recipient: address) {
    transfer::transfer(admin, recipient);
}

#[test_only]
public fun transfer_approved_signers(approved_signers: ApprovedSigners, recipient: address) {
    transfer::transfer(approved_signers, recipient);
}

#[test_only]
public fun transfer_owner_cap_test(owner_cap: OwnerCap, recipient: address) {
    transfer::transfer(owner_cap, recipient);
}

