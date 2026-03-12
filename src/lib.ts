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

async function rpcGetOwnedObjects(owner: string, typeFilter: string): Promise<Array<{ objectId: string; fields: Record<string, unknown> }>> {
  const res = await fetch(SUI_TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "suix_getOwnedObjects",
      params: [owner, { filter: { StructType: typeFilter }, options: { showContent: true, showType: true } }, null, 1],
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

function boolish(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
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

const GATE_TYPE = `${WORLD_PKG}::gate::Gate`;
const ASSEMBLY_TYPE = `${WORLD_PKG}::assembly::Assembly`;

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
    if (type === GATE_TYPE) {
      offlineHotPotato = tx.moveCall({
        target: `${WORLD_PKG}::gate::offline_connected_gate`,
        arguments: [tx.object(id), offlineHotPotato, tx.object(RAW_NETWORK_NODE_ID), tx.object(ENERGY_CONFIG)],
      })[0];
    } else if (type === ASSEMBLY_TYPE) {
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
