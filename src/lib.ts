import { Transaction } from "@mysten/sui/transactions";
import {
  CLOCK,
  CRADLEOS_PKG,
  ENERGY_CONFIG,
  FUEL_CONFIG,
  NETWORK_NODE_TYPE,
  RAW_CHARACTER_ID,
  RAW_NETWORK_NODE_ID,
  RAW_NODE_OWNER_CAP,
  SUI_TESTNET_RPC,
  WORLD_PKG,
  STRUCTURE_TYPES,
  type StructureKind,
} from "./constants";

export type NodeDashboardData = {
  objectId: string;
  objectType: string;
  isOnline: boolean;
  fuelLevelPct: number;
  runtimeHoursRemaining: number;
  raw: Record<string, unknown> | null;
};

export type CorpOverviewData = {
  objectId: string;
  name: string;
  tribeId: string;
  memberCount: number;
  commander: string;
  raw: Record<string, unknown> | null;
};

type CoreLikeClient = {
  getObject: (options: { objectId: string; include?: Record<string, boolean> }) => Promise<{ object: { objectId: string; type: string; owner?: unknown; json?: Record<string, unknown> | null } }>;
  listOwnedObjects: (options: { owner: string; type?: string; include?: Record<string, boolean>; limit?: number }) => Promise<{ objects: Array<{ objectId: string; type?: string; json?: Record<string, unknown> | null }> }>;
};

async function rpcGetObject(objectId: string): Promise<Record<string, unknown>> {
  const res = await fetch(SUI_TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "sui_getObject",
      params: [objectId, { showContent: true, showType: true, showOwner: true }],
    }),
  });
  const json = await res.json() as { result: { data: { content: { fields: Record<string, unknown> }; type: string; owner: unknown } } };
  return { ...json.result.data.content.fields, _type: json.result.data.type, _owner: json.result.data.owner };
}

async function rpcGetOwnedObjects(owner: string, typeFilter: string, limit = 50): Promise<Array<{ objectId: string; fields: Record<string, unknown> }>> {
  const res = await fetch(SUI_TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "suix_getOwnedObjects",
      params: [owner, { filter: { StructType: typeFilter }, options: { showContent: true, showType: true } }, null, limit],
    }),
  });
  const json = await res.json() as { result: { data: Array<{ data: { objectId: string; content: { fields: Record<string, unknown> } } }> } };
  return (json.result.data ?? []).map(item => ({
    objectId: item.data.objectId,
    fields: item.data.content?.fields ?? {},
  }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readPath(obj: unknown, ...path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    const rec = asRecord(current);
    if (!rec || !(key in rec)) return undefined;
    current = rec[key];
  }
  return current;
}

function numish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}



function stringish(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "—";
}

function extractNodeMetrics(fields: Record<string, unknown>): NodeDashboardData {
  // Status: fields.status.fields.status.variant = "ONLINE" | "OFFLINE"
  const statusVariant = readPath(fields, "status", "fields", "status", "variant");
  const isOnline = statusVariant === "ONLINE";

  // Fuel: fields.fuel.fields.{quantity, max_capacity, unit_volume, burn_rate_in_ms}
  const fuelFields = asRecord(readPath(fields, "fuel", "fields")) ?? {};
  const quantity = numish(fuelFields["quantity"]) ?? 0;           // items
  const unitVolume = numish(fuelFields["unit_volume"]) ?? 28;     // cu per item
  const maxCapacity = numish(fuelFields["max_capacity"]) ?? 100000; // cu
  const burnRateMs = numish(fuelFields["burn_rate_in_ms"]) ?? 3600000; // ms per item

  const fuelVolume = quantity * unitVolume;
  const fuelLevelPct = maxCapacity > 0
    ? Math.max(0, Math.min(100, (fuelVolume / maxCapacity) * 100))
    : 0;

  // Runtime: quantity items × burn_rate_in_ms per item → hours
  const runtimeHours = (quantity * burnRateMs) / (1000 * 60 * 60);

  return {
    objectId: RAW_NETWORK_NODE_ID,
    objectType: stringish(readPath(fields, "_type")) || NETWORK_NODE_TYPE,
    isOnline,
    fuelLevelPct: Number(fuelLevelPct.toFixed(1)),
    runtimeHoursRemaining: Number(runtimeHours.toFixed(1)),
    raw: fields,
  };
}

function decodeMaybeAscii(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    try {
      return new TextDecoder().decode(new Uint8Array(value as number[]));
    } catch {
      return value.join(",");
    }
  }
  return "Unknown Corp";
}

function extractCorpMetrics(fields: Record<string, unknown>, objectId: string): CorpOverviewData {
  const membersValue = readPath(fields, "members") ?? readPath(fields, "member_table");
  const memberCount =
    numish(readPath(fields, "member_count")) ??
    (Array.isArray(membersValue) ? membersValue.length : null) ??
    numish(readPath(membersValue, "size")) ??
    0;

  return {
    objectId,
    name: decodeMaybeAscii(readPath(fields, "name")),
    tribeId: stringish(readPath(fields, "tribe_id") ?? readPath(fields, "tribeId")),
    memberCount,
    commander: stringish(readPath(fields, "commander") ?? readPath(fields, "owner") ?? readPath(fields, "admin")),
    raw: fields,
  };
}

export async function fetchNodeDashboard(_client: CoreLikeClient): Promise<NodeDashboardData> {
  const fields = await rpcGetObject(RAW_NETWORK_NODE_ID);
  return extractNodeMetrics(fields);
}

export async function fetchCorpOverview(_client: CoreLikeClient): Promise<CorpOverviewData | null> {
  const results = await rpcGetOwnedObjects(
    RAW_CHARACTER_ID,
    `${CRADLEOS_PKG}::corp_registry::CorpRegistry`,
  );
  if (!results.length) return null;
  const { objectId, fields } = results[0];
  return extractCorpMetrics(fields, objectId);
}

export function buildBringOnlineTransaction() {
  const tx = new Transaction();

  const [cap, receipt] = tx.moveCall({
    target: `${WORLD_PKG}::character::borrow_owner_cap`,
    typeArguments: [NETWORK_NODE_TYPE],
    arguments: [tx.object(RAW_CHARACTER_ID), tx.object(RAW_NODE_OWNER_CAP)],
  });

  tx.moveCall({
    target: `${WORLD_PKG}::network_node::online`,
    arguments: [tx.object(RAW_NETWORK_NODE_ID), cap, tx.object(CLOCK)],
  });

  tx.moveCall({
    target: `${WORLD_PKG}::character::return_owner_cap`,
    typeArguments: [NETWORK_NODE_TYPE],
    arguments: [tx.object(RAW_CHARACTER_ID), cap, receipt],
  });

  return tx;
}

const GATE_TYPE_FULL = `${WORLD_PKG}::gate::Gate`;
const ASSEMBLY_TYPE_FULL = `${WORLD_PKG}::assembly::Assembly`;

export async function buildBringOfflineTransaction(): Promise<Transaction> {
  // Fetch live connected assembly IDs and their types
  const fields = await rpcGetObject(RAW_NETWORK_NODE_ID);
  const connectedIds = (fields["connected_assembly_ids"] as string[] | undefined) ?? [];

  // Resolve type for each connected assembly
  const assemblyMeta: Array<{ id: string; type: string }> = await Promise.all(
    connectedIds.map(async (id) => {
      const res = await fetch(SUI_TESTNET_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [id, { showType: true }] }),
      });
      const json = await res.json() as { result: { data: { type: string } } };
      return { id, type: json.result.data.type };
    })
  );

  const tx = new Transaction();

  const [cap, receipt] = tx.moveCall({
    target: `${WORLD_PKG}::character::borrow_owner_cap`,
    typeArguments: [NETWORK_NODE_TYPE],
    arguments: [tx.object(RAW_CHARACTER_ID), tx.object(RAW_NODE_OWNER_CAP)],
  });

  let offlineHotPotato = tx.moveCall({
    target: `${WORLD_PKG}::network_node::offline`,
    arguments: [tx.object(RAW_NETWORK_NODE_ID), tx.object(FUEL_CONFIG), cap, tx.object(CLOCK)],
  })[0];

  // Drain connected assemblies from the hot potato
  for (const { id, type } of assemblyMeta) {
    if (type === GATE_TYPE_FULL) {
      offlineHotPotato = tx.moveCall({
        target: `${WORLD_PKG}::gate::offline_connected_gate`,
        arguments: [tx.object(id), offlineHotPotato, tx.object(RAW_NETWORK_NODE_ID), tx.object(ENERGY_CONFIG)],
      })[0];
    } else if (type === ASSEMBLY_TYPE_FULL) {
      offlineHotPotato = tx.moveCall({
        target: `${WORLD_PKG}::assembly::offline_connected_assembly`,
        arguments: [tx.object(id), offlineHotPotato, tx.object(RAW_NETWORK_NODE_ID), tx.object(ENERGY_CONFIG)],
      })[0];
    }
    // other assembly types (turret, storage_unit) can be added here
  }

  tx.moveCall({
    target: `${WORLD_PKG}::network_node::destroy_offline_assemblies`,
    arguments: [offlineHotPotato],
  });

  tx.moveCall({
    target: `${WORLD_PKG}::character::return_owner_cap`,
    typeArguments: [NETWORK_NODE_TYPE],
    arguments: [tx.object(RAW_CHARACTER_ID), cap, receipt],
  });

  return tx;
}

// ─── Dynamic Player Structures ───────────────────────────────────────────────

export type PlayerStructure = {
  objectId: string;
  ownerCapId: string;
  kind: StructureKind;
  typeFull: string;
  label: string;        // kind label (e.g. "Network Node")
  displayName: string;  // metadata.name if set, else label
  isOnline: boolean;
  locationHash: string;
  solarSystemId?: number;
  energySourceId?: string;
  fuelLevelPct?: number;
  runtimeHoursRemaining?: number;
};

export type LocationGroup = {
  key: string;               // solarSystemId as string, or "unknown"
  solarSystemId?: number;
  tabLabel: string;
  structures: PlayerStructure[];
};

async function findCharacterForWallet(walletAddress: string): Promise<string | null> {
  // Character is a Shared object — can't find via getOwnedObjects.
  // Query CharacterCreatedEvent, paginate all pages, match character_address.
  let cursor: string | null = null;
  do {
    const res = await fetch(SUI_TESTNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "suix_queryEvents",
        params: [
          { MoveEventType: `${WORLD_PKG}::character::CharacterCreatedEvent` },
          cursor, 50, false,
        ],
      }),
    });
    const json = await res.json() as {
      result: {
        data: Array<{ parsedJson: { character_address: string; character_id: string } }>;
        hasNextPage: boolean;
        nextCursor: string | null;
      }
    };
    const match = json.result.data.find(
      e => e.parsedJson.character_address.toLowerCase() === walletAddress.toLowerCase()
    );
    if (match) return match.parsedJson.character_id;
    cursor = json.result.hasNextPage ? json.result.nextCursor : null;
  } while (cursor);
  return null;
}

/** Fetch all LocationRevealedEvents and return a map: assemblyId -> solarSystemId */
async function buildLocationEventMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let cursor: string | null = null;
  do {
    const res = await fetch(SUI_TESTNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "suix_queryEvents",
        params: [
          { MoveEventType: `${WORLD_PKG}::location::LocationRevealedEvent` },
          cursor, 100, false,
        ],
      }),
    });
    const json = await res.json() as {
      result: {
        data: Array<{ parsedJson: { assembly_id: string; solarsystem: string | number } }>;
        hasNextPage: boolean;
        nextCursor: string | null;
      };
    };
    for (const e of json.result.data) {
      const sysId = Number(e.parsedJson.solarsystem);
      if (e.parsedJson.assembly_id && sysId && !isNaN(sysId)) {
        map.set(e.parsedJson.assembly_id, sysId);
      }
    }
    cursor = json.result.hasNextPage ? json.result.nextCursor : null;
  } while (cursor);
  return map;
}

async function resolveSystemName(solarSystemId: number): Promise<string> {
  try {
    const res = await fetch(`/intel/system/${solarSystemId}`);
    if (res.ok) {
      const json = await res.json() as { name?: string };
      if (json.name) return json.name;
    }
  } catch { /* fallback */ }
  return `System ${solarSystemId}`;
}

export async function fetchPlayerStructures(walletAddress: string): Promise<LocationGroup[]> {
  const characterId = await findCharacterForWallet(walletAddress);
  if (!characterId) return [];

  // Discover all OwnerCaps
  const capEntries: Array<{ capId: string; structureId: string; kind: StructureKind; typeFull: string; label: string }> = [];
  await Promise.all(
    STRUCTURE_TYPES.map(async ({ type: structType, kind, label }) => {
      const ownerCapType = `${WORLD_PKG}::access::OwnerCap<${structType}>`;
      const caps = await rpcGetOwnedObjects(characterId, ownerCapType, 50);
      for (const { objectId: capId, fields } of caps) {
        const structureId = fields["authorized_object_id"] as string;
        if (structureId) capEntries.push({ capId, structureId, kind, typeFull: structType, label });
      }
    })
  );
  if (!capEntries.length) return [];

  // Fetch location events + structure objects in parallel
  const [locationMap, structureObjects] = await Promise.all([
    buildLocationEventMap(),
    Promise.all(
      capEntries.map(async ({ capId, structureId, kind, typeFull, label }) => {
        const fields = await rpcGetObject(structureId);

        // Location hash
        const locFields = asRecord(readPath(fields, "location", "fields")) ?? {};
        const locationHashBytes = (locFields["location_hash"] as number[] | undefined) ?? [];
        const locationHash = locationHashBytes.map((b: number) => b.toString(16).padStart(2, "0")).join("");

        // Status
        const statusVariant = readPath(fields, "status", "fields", "status", "variant");
        const isOnline = statusVariant === "ONLINE";

        // Connected NetworkNode
        const esRaw = fields["energy_source_id"];
        const energySourceId = typeof esRaw === "string" ? esRaw : undefined;

        // Display name: metadata.name if set, else kind label
        const metaName = stringish(readPath(fields, "metadata", "fields", "name")).trim();
        const displayName = metaName || label;

        // Fuel (NetworkNode only)
        let fuelLevelPct: number | undefined;
        let runtimeHoursRemaining: number | undefined;
        if (kind === "NetworkNode") {
          const fuelFields = asRecord(readPath(fields, "fuel", "fields")) ?? {};
          const qty = numish(fuelFields["quantity"]) ?? 0;
          const uv = numish(fuelFields["unit_volume"]) ?? 28;
          const mc = numish(fuelFields["max_capacity"]) ?? 100000;
          const br = numish(fuelFields["burn_rate_in_ms"]) ?? 3600000;
          fuelLevelPct = mc > 0 ? (qty * uv / mc) * 100 : 0;
          runtimeHoursRemaining = qty * br / 3_600_000;
        }

        return { objectId: structureId, ownerCapId: capId, kind, typeFull, label, displayName, isOnline, locationHash, energySourceId, fuelLevelPct, runtimeHoursRemaining } as PlayerStructure;
      })
    ),
  ]);

  // Attach solarSystemId from event map
  const structures = structureObjects.map(s => ({
    ...s,
    solarSystemId: locationMap.get(s.objectId),
  }));

  // Group by solarSystemId (resolved) or "unknown" (all unresolved together)
  const groups = new Map<string, { solarSystemId?: number; structs: PlayerStructure[] }>();
  for (const s of structures) {
    const key = s.solarSystemId ? String(s.solarSystemId) : "unknown";
    if (!groups.has(key)) groups.set(key, { solarSystemId: s.solarSystemId, structs: [] });
    groups.get(key)!.structs.push(s);
  }

  // Resolve tab labels
  const result: LocationGroup[] = await Promise.all(
    Array.from(groups.entries()).map(async ([key, { solarSystemId, structs }]) => {
      let tabLabel = "Your Structures";
      if (solarSystemId) {
        tabLabel = await resolveSystemName(solarSystemId);
      }
      return { key, solarSystemId, tabLabel, structures: structs };
    })
  );

  // Sort: resolved systems first, unknown last
  result.sort((a, b) => (a.key === "unknown" ? 1 : 0) - (b.key === "unknown" ? 1 : 0));
  return result;
}

// ─── Generic Structure Tx Builders ───────────────────────────────────────────

export function buildStructureOnlineTransaction(
  structure: PlayerStructure,
  characterId: string,
): Transaction {
  const tx = new Transaction();

  const [cap, receipt] = tx.moveCall({
    target: `${WORLD_PKG}::character::borrow_owner_cap`,
    typeArguments: [structure.typeFull],
    arguments: [tx.object(characterId), tx.object(structure.ownerCapId)],
  });

  if (structure.kind === "NetworkNode") {
    tx.moveCall({
      target: `${WORLD_PKG}::network_node::online`,
      arguments: [tx.object(structure.objectId), cap, tx.object(CLOCK)],
    });
  } else if (structure.kind === "Gate") {
    tx.moveCall({
      target: `${WORLD_PKG}::gate::online`,
      arguments: [tx.object(structure.objectId), tx.object(structure.energySourceId!), tx.object(ENERGY_CONFIG), cap],
    });
  } else if (structure.kind === "Assembly") {
    tx.moveCall({
      target: `${WORLD_PKG}::assembly::online`,
      arguments: [tx.object(structure.objectId), tx.object(structure.energySourceId!), tx.object(ENERGY_CONFIG), cap],
    });
  }

  tx.moveCall({
    target: `${WORLD_PKG}::character::return_owner_cap`,
    typeArguments: [structure.typeFull],
    arguments: [tx.object(characterId), cap, receipt],
  });

  return tx;
}

export async function buildStructureOfflineTransaction(
  structure: PlayerStructure,
  characterId: string,
): Promise<Transaction> {
  const tx = new Transaction();

  const [cap, receipt] = tx.moveCall({
    target: `${WORLD_PKG}::character::borrow_owner_cap`,
    typeArguments: [structure.typeFull],
    arguments: [tx.object(characterId), tx.object(structure.ownerCapId)],
  });

  if (structure.kind === "NetworkNode") {
    const fields = await rpcGetObject(structure.objectId);
    const connectedIds = (fields["connected_assembly_ids"] as string[] | undefined) ?? [];
    const assemblyMeta: Array<{ id: string; type: string }> = await Promise.all(
      connectedIds.map(async (id) => {
        const res = await fetch(SUI_TESTNET_RPC, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [id, { showType: true }] }),
        });
        const j = await res.json() as { result: { data: { type: string } } };
        return { id, type: j.result.data.type };
      })
    );

    let hotPotato = tx.moveCall({
      target: `${WORLD_PKG}::network_node::offline`,
      arguments: [tx.object(structure.objectId), tx.object(FUEL_CONFIG), cap, tx.object(CLOCK)],
    })[0];

    for (const { id, type } of assemblyMeta) {
      if (type === GATE_TYPE_FULL) {
        hotPotato = tx.moveCall({
          target: `${WORLD_PKG}::gate::offline_connected_gate`,
          arguments: [tx.object(id), hotPotato, tx.object(structure.objectId), tx.object(ENERGY_CONFIG)],
        })[0];
      } else if (type === ASSEMBLY_TYPE_FULL) {
        hotPotato = tx.moveCall({
          target: `${WORLD_PKG}::assembly::offline_connected_assembly`,
          arguments: [tx.object(id), hotPotato, tx.object(structure.objectId), tx.object(ENERGY_CONFIG)],
        })[0];
      }
    }
    tx.moveCall({ target: `${WORLD_PKG}::network_node::destroy_offline_assemblies`, arguments: [hotPotato] });
  } else if (structure.kind === "Gate") {
    tx.moveCall({
      target: `${WORLD_PKG}::gate::offline`,
      arguments: [tx.object(structure.objectId), tx.object(structure.energySourceId!), tx.object(ENERGY_CONFIG), cap],
    });
  } else if (structure.kind === "Assembly") {
    tx.moveCall({
      target: `${WORLD_PKG}::assembly::offline`,
      arguments: [tx.object(structure.objectId), tx.object(structure.energySourceId!), tx.object(ENERGY_CONFIG), cap],
    });
  }

  tx.moveCall({
    target: `${WORLD_PKG}::character::return_owner_cap`,
    typeArguments: [structure.typeFull],
    arguments: [tx.object(characterId), cap, receipt],
  });

  return tx;
}
