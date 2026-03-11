import { Transaction } from "@mysten/sui/transactions";
import {
  CLOCK,
  CRADLEOS_PKG,
  NETWORK_NODE_TYPE,
  RAW_CHARACTER_ID,
  RAW_NETWORK_NODE_ID,
  RAW_NODE_OWNER_CAP,
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
  getObject: (options: unknown) => Promise<unknown>;
  listOwnedObjects: (options: unknown) => Promise<unknown>;
};

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
  const onlineCandidates = [
    readPath(fields, "online"),
    readPath(fields, "is_online"),
    readPath(fields, "status", "online"),
    readPath(fields, "status"),
    readPath(fields, "state"),
  ];
  const onlineRaw = onlineCandidates.find((v) => v !== undefined);
  const isOnline =
    boolish(onlineRaw) ??
    (typeof onlineRaw === "string"
      ? ["online", "active", "running"].includes(onlineRaw.toLowerCase())
      : false);

  const fuelCurrent =
    numish(readPath(fields, "fuel")) ??
    numish(readPath(fields, "fuel_level")) ??
    numish(readPath(fields, "fuel_current")) ??
    numish(readPath(fields, "fuelRemaining")) ??
    0;
  const fuelMax =
    numish(readPath(fields, "fuel_capacity")) ??
    numish(readPath(fields, "max_fuel")) ??
    numish(readPath(fields, "fuel_max")) ??
    100;
  const fuelLevelPct =
    fuelCurrent <= 1 && fuelMax <= 1
      ? Math.max(0, Math.min(100, fuelCurrent * 100))
      : fuelMax > 0
        ? Math.max(0, Math.min(100, (fuelCurrent / fuelMax) * 100))
        : Math.max(0, Math.min(100, fuelCurrent));

  const runtimeMs =
    numish(readPath(fields, "runtime_remaining_ms")) ??
    numish(readPath(fields, "remaining_runtime_ms")) ??
    null;
  const runtimeSeconds =
    numish(readPath(fields, "runtime_remaining_secs")) ??
    numish(readPath(fields, "runtime_remaining_s")) ??
    numish(readPath(fields, "remaining_runtime_secs")) ??
    null;
  const runtimeHours =
    numish(readPath(fields, "runtime_remaining_hours")) ??
    numish(readPath(fields, "remaining_runtime_hours")) ??
    (runtimeMs !== null ? runtimeMs / (1000 * 60 * 60) : null) ??
    (runtimeSeconds !== null ? runtimeSeconds / 3600 : null) ??
    0;

  return {
    objectId: RAW_NETWORK_NODE_ID,
    objectType: stringish(readPath(fields, "type")) || NETWORK_NODE_TYPE,
    isOnline,
    fuelLevelPct: Number(fuelLevelPct.toFixed(1)),
    runtimeHoursRemaining: Number(runtimeHours.toFixed(2)),
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

export async function fetchNodeDashboard(client: CoreLikeClient): Promise<NodeDashboardData> {
  const response = await client.getObject({
    id: RAW_NETWORK_NODE_ID,
    include: { content: true, type: true, owner: true },
  });

  const fields = asRecord(readPath(response, "data", "content", "fields")) ?? {};
  return extractNodeMetrics({
    ...fields,
    type: readPath(response, "data", "type"),
    owner: readPath(response, "data", "owner"),
  });
}

export async function fetchCorpOverview(client: CoreLikeClient): Promise<CorpOverviewData | null> {
  const owned = await client.listOwnedObjects({
    owner: RAW_CHARACTER_ID,
    filter: { objectType: `${CRADLEOS_PKG}::corp_registry::CorpRegistry` },
    include: { content: true, type: true },
    limit: 1,
  });

  const hit = readPath(owned, "data", "0");
  const objectId = readPath(hit, "objectId");
  const fields = asRecord(readPath(hit, "content", "fields"));
  if (typeof objectId !== "string" || !fields) return null;
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
