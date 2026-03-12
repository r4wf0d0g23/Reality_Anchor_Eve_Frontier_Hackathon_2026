export const WORLD_PKG = "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75";
// v7 package — defense security levels + aggression mode
export const CRADLEOS_PKG = "0x036c2c0db070507940bd49d86e91f357f68ae94c3c33375c0ebc75044aeafade";
// Original v4 package ID — Sui event indexer normalizes upgraded-package events back to
// the original package ID. Use this for ALL suix_queryEvents calls (CoinLaunched, etc.)
export const CRADLEOS_EVENTS_PKG = "0xee8cd44d4373a8fbb644edbd96281f0e25eacaec6209408c00a2b7c76a179546";
// CradleMintController and CoinMetadata are shared objects from v4 init — same IDs across upgrades
export const CRADLE_MINT_CONTROLLER = "0x50a5c166ee46cd9a48b49649b6ac0b6cb01090470c96317bd9d69d7e50e19a50";
export const CRDL_COIN_TYPE = `${CRADLEOS_PKG}::cradle_coin::CRADLE_COIN`;
export const RAW_CHARACTER_ID = "0x5ef314c39748d5027fe4aef711f92497a4ea9618886f107916f2df0f16034c1c";
export const RAW_NETWORK_NODE_ID = "0xbce555aedb0c1322232c4243ce62cfc6210293cb69be6b4fe212ab9b4ba49fd7";
export const RAW_NODE_OWNER_CAP = "0x1e69832d1977a6963ea93b4cf2feeb7e432cde4ae463ff2989f35de3c78765f2";
export const FUEL_CONFIG = "0x0f354c803af170ac0d1ac9068625c6321996b3013dc67bdaf14d06f93fa1671f";
export const ENERGY_CONFIG = "0x9285364e8104c04380d9cc4a001bbdfc81a554aad441c2909c2d3bd52a0c9c62";
export const CLOCK = "0x6";
export const SUI_TESTNET_RPC = "https://fullnode.testnet.sui.io:443";

// Well-known tribes that don't have CradleOS vaults but still need policy coverage
export const WELL_KNOWN_TRIBES: Array<{ tribeId: number; coinSymbol: string; label: string }> = [
  { tribeId: 1000167, coinSymbol: "—", label: "Default Spawn Tribe" },
];
export const WORLD_API = "https://world-api-utopia.uat.pub.evefrontier.com";

export const NETWORK_NODE_TYPE = `${WORLD_PKG}::network_node::NetworkNode`;
export const GATE_TYPE = `${WORLD_PKG}::gate::Gate`;
export const ASSEMBLY_TYPE = `${WORLD_PKG}::assembly::Assembly`;
export const TURRET_TYPE = `${WORLD_PKG}::turret::Turret`;
export const STORAGE_UNIT_TYPE = `${WORLD_PKG}::storage_unit::StorageUnit`;
export const CHARACTER_TYPE = `${WORLD_PKG}::character::Character`;
export const CORP_REGISTRY_TYPE = `${CRADLEOS_PKG}::corp_registry::CorpRegistry`;
export const CORP_TYPE       = `${CRADLEOS_PKG}::corp::Corp`;
export const MEMBER_CAP_TYPE = `${CRADLEOS_PKG}::corp::MemberCap`;
export const TREASURY_TYPE   = `${CRADLEOS_PKG}::treasury::Treasury`;
export const REGISTRY_TYPE   = `${CRADLEOS_PKG}::registry::Registry`;
export const TRIBE_VAULT_TYPE = `${CRADLEOS_PKG}::tribe_vault::TribeVault`;
export const TRIBE_DEX_TYPE   = `${CRADLEOS_PKG}::tribe_dex::TribeDex`;

export const MIST_PER_SUI = 1_000_000_000n;
export const CRDL_PER_TRIBE = 1n; // 1 CRDL per tribe coin unit (default display scale)

export const STRUCTURE_TYPES = [
  { type: NETWORK_NODE_TYPE, kind: "NetworkNode" as const, mod: "network_node", label: "Network Node" },
  { type: GATE_TYPE,         kind: "Gate"        as const, mod: "gate",         label: "Gate"         },
  { type: ASSEMBLY_TYPE,     kind: "Assembly"    as const, mod: "assembly",     label: "Assembly"     },
  { type: TURRET_TYPE,       kind: "Turret"      as const, mod: "turret",       label: "Turret"       },
  { type: STORAGE_UNIT_TYPE, kind: "StorageUnit" as const, mod: "storage_unit", label: "Storage Unit" },
] as const;

export type StructureKind = "NetworkNode" | "Gate" | "Assembly" | "Turret" | "StorageUnit";
