/**
 * TurretPolicyPanel — Tribe defense policy editor + passage intel log.
 *
 * Founder:
 *   • Create the TribeDefensePolicy + PassageLog for the vault
 *   • Toggle each known tribe as Friendly / Hostile
 *   • Batch-save relation changes in one tx
 *   • Toggle Enforce Policy (members apply policy to their turrets)
 *
 * Members:
 *   • View current policy (read-only)
 *   • Log a passage event from one of their turrets
 *
 * Intel Feed:
 *   • Shows all PassageLogged events for this vault (newest first)
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { Transaction } from "@mysten/sui/transactions";
import { CRADLEOS_PKG, CRADLEOS_EVENTS_PKG, SUI_TESTNET_RPC, WELL_KNOWN_TRIBES } from "../constants";

// defense_policy was NEW in v5 — its events index under CRADLEOS_PKG (v5), not CRADLEOS_EVENTS_PKG (v4)
// tribe_vault events (CoinLaunched) remain under CRADLEOS_EVENTS_PKG (original v4)
import {
  rpcGetObject, numish,
  fetchCharacterTribeId, fetchTribeVault, getCachedVaultId,
  type TribeVaultState,
} from "../lib";

// ── Types ─────────────────────────────────────────────────────────────────────

type PolicyState = {
  objectId: string;
  vaultId: string;
  enforce: boolean;
  version: number;
  relationsTableId: string;
};

type KnownTribe = {
  tribeId: number;
  coinSymbol: string;
  vaultId: string;
};

type PassageEvent = {
  logId: string;
  entryIndex: number;
  turretId: string;
  reporter: string;
  entityId: string;
  note: string;
  timestampMs: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(a: string | undefined | null) {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Fetch TribeDefensePolicy state. */
async function fetchPolicyState(policyId: string): Promise<PolicyState | null> {
  try {
    const fields = await rpcGetObject(policyId);
    const relField = fields["relations"] as { fields?: { id?: { id?: string } } } | undefined;
    return {
      objectId: policyId,
      vaultId: String(fields["vault_id"] ?? ""),
      enforce: Boolean(fields["enforce"]),
      version: numish(fields["version"]) ?? 0,
      relationsTableId: relField?.fields?.id?.id ?? "",
    };
  } catch { return null; }
}

/** Fetch current relations from the policy's relations Table. */
async function fetchRelations(relationsTableId: string): Promise<Map<number, boolean>> {
  const map = new Map<number, boolean>();
  if (!relationsTableId) return map;
  try {
    const res = await fetch(SUI_TESTNET_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getDynamicFields", params: [relationsTableId, null, 100] }),
    });
    const j = await res.json() as { result?: { data?: Array<{ name: { value: string | number }; objectId: string }> } };
    const entries = j.result?.data ?? [];
    await Promise.all(entries.map(async (entry) => {
      const obj = await fetch(SUI_TESTNET_RPC, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [entry.objectId, { showContent: true }] }),
      });
      const od = await obj.json() as { result?: { data?: { content?: { fields?: Record<string, unknown> } } } };
      const f = od.result?.data?.content?.fields ?? {};
      const val = (f["value"] as { fields?: Record<string, unknown> })?.fields ?? (f["value"] as Record<string, unknown>) ?? {};
      const tribeId = numish(entry.name.value) ?? 0;
      const relation = numish(val["value"] ?? f["value"]) ?? 0;
      map.set(tribeId, relation === 1);
    }));
  } catch { /* */ }
  return map;
}

/** Fetch all known tribes by querying CoinLaunched events.
 *  Deduplicates by tribeId — keeps the most recent vault per tribe (descending order). */
async function fetchKnownTribes(): Promise<KnownTribe[]> {
  try {
    const res = await fetch(SUI_TESTNET_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "suix_queryEvents",
        // descending=true → newest first; first occurrence of each tribeId wins
        params: [{ MoveEventType: `${CRADLEOS_EVENTS_PKG}::tribe_vault::CoinLaunched` }, null, 200, true],
      }),
    });
    const j = await res.json() as { result?: { data?: Array<{ parsedJson: Record<string, unknown> }> } };
    const seen = new Set<number>();
    const result: KnownTribe[] = [];
    for (const e of (j.result?.data ?? [])) {
      const tribeId = numish(e.parsedJson["tribe_id"]) ?? 0;
      if (seen.has(tribeId)) continue;
      seen.add(tribeId);
      result.push({
        tribeId,
        coinSymbol: String(e.parsedJson["coin_symbol"] ?? "?"),
        vaultId: String(e.parsedJson["vault_id"] ?? ""),
      });
    }
    return result;
  } catch { return []; }
}

/** Fetch policy object ID for a vault — localStorage cache first, then event query. */
async function fetchPolicyIdForVault(vaultId: string): Promise<string | null> {
  // Check localStorage cache first (populated by handleCreate)
  try {
    const cached = localStorage.getItem(`cradleos:policy:${vaultId}`);
    if (cached) return cached;
  } catch { /* */ }
  // Fallback: query PolicyCreated events (defense_policy is a v5-new module → v5 pkg ID)
  try {
    const res = await fetch(SUI_TESTNET_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "suix_queryEvents",
        params: [{ MoveEventType: `${CRADLEOS_PKG}::defense_policy::PolicyCreated` }, null, 50, true],
      }),
    });
    const j = await res.json() as { result?: { data?: Array<{ parsedJson: Record<string, unknown> }> } };
    const match = (j.result?.data ?? []).find(e => String(e.parsedJson["vault_id"]) === vaultId);
    if (match) {
      const id = String(match.parsedJson["policy_id"]);
      try { localStorage.setItem(`cradleos:policy:${vaultId}`, id); } catch { /* */ }
      return id;
    }
    return null;
  } catch { return null; }
}

/** Fetch PassageLog object ID for a vault (cached in localStorage). */
function getPassageLogId(vaultId: string): string | null {
  try { return localStorage.getItem(`cradleos:passagelog:${vaultId}`); } catch { return null; }
}
export function setPassageLogId(vaultId: string, logId: string): void {
  try { localStorage.setItem(`cradleos:passagelog:${vaultId}`, logId); } catch { /* */ }
}

/** Fetch recent PassageLogged events for a vault. */
async function fetchPassageEvents(vaultId: string): Promise<PassageEvent[]> {
  try {
    const res = await fetch(SUI_TESTNET_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "suix_queryEvents",
        params: [{ MoveEventType: `${CRADLEOS_PKG}::defense_policy::PassageLogged` }, null, 50, true],
      }),
    });
    const j = await res.json() as { result?: { data?: Array<{ parsedJson: Record<string, unknown>; timestampMs?: string }> } };
    return (j.result?.data ?? [])
      .filter(e => String(e.parsedJson["vault_id"]) === vaultId)
      .map(e => ({
        logId: String(e.parsedJson["log_id"] ?? ""),
        entryIndex: numish(e.parsedJson["entry_index"]) ?? 0,
        turretId: String(e.parsedJson["turret_id"] ?? ""),
        reporter: String(e.parsedJson["reporter"] ?? ""),
        entityId: String(e.parsedJson["entity_id"] ?? ""),
        note: String(e.parsedJson["note"] ?? ""),
        timestampMs: numish(e.parsedJson["timestamp_ms"]) ?? 0,
      }));
  } catch { return []; }
}

// ── Tx builders ───────────────────────────────────────────────────────────────

function buildCreatePolicyTransaction(vaultId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CRADLEOS_PKG}::defense_policy::create_policy_entry`,
    arguments: [tx.object(vaultId)],
  });
  return tx;
}

function buildSetRelationsBatchTransaction(
  policyId: string,
  vaultId: string,
  tribeIds: number[],
  friendlies: boolean[],
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CRADLEOS_PKG}::defense_policy::set_relations_batch_entry`,
    arguments: [
      tx.object(policyId),
      tx.object(vaultId),
      tx.pure.vector("u32", tribeIds.map(n => n >>> 0)),
      tx.pure.vector("bool", friendlies),
    ],
  });
  return tx;
}

function buildSetEnforceTransaction(policyId: string, vaultId: string, enforce: boolean): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CRADLEOS_PKG}::defense_policy::set_enforce_entry`,
    arguments: [tx.object(policyId), tx.object(vaultId), tx.pure.bool(enforce)],
  });
  return tx;
}

function buildLogPassageTransaction(
  logId: string,
  turretId: string,
  entityId: string,
  note: string,
  timestampMs: number,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CRADLEOS_PKG}::defense_policy::log_passage_entry`,
    arguments: [
      tx.object(logId),
      tx.pure.address(turretId),
      tx.pure.address(entityId),
      tx.pure.vector("u8", Array.from(new TextEncoder().encode(note))),
      tx.pure.u64(BigInt(timestampMs)),
    ],
  });
  return tx;
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function TurretPolicyPanel() {
  const _account0 = useCurrentAccount();
  // Vault discovery (same as TribeVaultPanel)
  const { data: tribeId } = useQuery<number | null>({
    queryKey: ["characterTribeId", _account0?.address],
    queryFn: () => _account0 ? fetchCharacterTribeId(_account0.address) : Promise.resolve(null),
    enabled: !!_account0?.address,
  });
  const { data: vault, isLoading: vaultLoading } = useQuery<TribeVaultState | null>({
    queryKey: ["tribeVault", tribeId, _account0?.address],
    queryFn: async () => {
      if (!tribeId || !_account0) return null;
      let vaultId = getCachedVaultId(tribeId);
      if (!vaultId) {
        // fallback — scan CoinLaunched events
        vaultId = null;
      }
      if (!vaultId) return null;
      return fetchTribeVault(vaultId);
    },
    enabled: !!tribeId && !!_account0,
    staleTime: 15_000,
  });

  if (!_account0) return (
    <div className="card" style={{ textAlign: "center", padding: "32px", color: "#888" }}>
      Connect EVE Vault to manage defense policy
    </div>
  );
  if (vaultLoading || !vault) return (
    <div className="card" style={{ textAlign: "center", padding: "32px", color: "#888" }}>
      {vaultLoading ? "Loading vault…" : "No tribe vault found. Create one in the Tribe Coin tab first."}
    </div>
  );
  return <TurretPolicyPanelInner vault={vault} />;
}

function TurretPolicyPanelInner({ vault }: { vault: TribeVaultState }) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const isFounder = !!account && vault.founder.toLowerCase() === account.address.toLowerCase();

  // Draft relation changes (tribeId → friendly bool) — only committed on save
  const [draft, setDraft] = useState<Map<number, boolean>>(new Map());
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logErr, setLogErr] = useState<string | null>(null);
  const [logTurret, setLogTurret] = useState("");
  const [logEntity, setLogEntity] = useState("");
  const [logNote, setLogNote] = useState("");
  // Manually added tribes (IDs without vaults)
  const [manualTribes, setManualTribes] = useState<KnownTribe[]>([]);
  const [addTribeInput, setAddTribeInput] = useState("");

  // Discover policy object ID
  const { data: policyId, refetch: refetchPolicyId } = useQuery<string | null>({
    queryKey: ["policyId", vault.objectId],
    queryFn: () => fetchPolicyIdForVault(vault.objectId),
    staleTime: 60_000,
  });

  const { data: policy } = useQuery<PolicyState | null>({
    queryKey: ["policyState", policyId],
    queryFn: () => policyId ? fetchPolicyState(policyId) : Promise.resolve(null),
    enabled: !!policyId,
    staleTime: 15_000,
  });

  const { data: relations } = useQuery<Map<number, boolean>>({
    queryKey: ["policyRelations", policy?.relationsTableId],
    queryFn: () => policy?.relationsTableId ? fetchRelations(policy.relationsTableId) : Promise.resolve(new Map()),
    enabled: !!policy?.relationsTableId,
    staleTime: 15_000,
  });

  const { data: tribes } = useQuery<KnownTribe[]>({
    queryKey: ["knownTribes"],
    queryFn: fetchKnownTribes,
    staleTime: 120_000,
  });

  const { data: passages } = useQuery<PassageEvent[]>({
    queryKey: ["passageEvents", vault.objectId],
    queryFn: () => fetchPassageEvents(vault.objectId),
    staleTime: 30_000,
  });

  const logId = getPassageLogId(vault.objectId);

  // Invalidate after any tx
  const invalidate = () => {
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["policyId"] });
      queryClient.invalidateQueries({ queryKey: ["policyState"] });
      queryClient.invalidateQueries({ queryKey: ["policyRelations"] });
      queryClient.invalidateQueries({ queryKey: ["passageEvents"] });
    }, 2500);
  };

  const handleCreate = async () => {
    if (!account) return;
    setCreateBusy(true); setCreateErr(null);
    try {
      const tx = buildCreatePolicyTransaction(vault.objectId);
      const signer = new CurrentAccountSigner(dAppKit);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });

      // Extract created shared object IDs from effects and identify by type
      const digest = (result as Record<string, unknown>)["digest"] as string | undefined;
      if (digest) {
        try {
          const res = await fetch(SUI_TESTNET_RPC, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0", id: 1,
              method: "sui_getTransactionBlock",
              params: [digest, { showEffects: true }],
            }),
          });
          const j = await res.json() as { result?: { effects?: { created?: Array<{ owner: unknown; reference: { objectId: string } }> } } };
          const created = (j.result?.effects?.created ?? [])
            .filter(c => c.owner && typeof c.owner === "object" && "Shared" in (c.owner as object))
            .map(c => c.reference.objectId);
          // Identify TribeDefensePolicy vs PassageLog by fetching type
          for (const id of created) {
            const objRes = await fetch(SUI_TESTNET_RPC, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getObject", params: [id, { showType: true }] }),
            });
            const od = await objRes.json() as { result?: { data?: { type?: string } } };
            const t = od.result?.data?.type ?? "";
            if (t.includes("TribeDefensePolicy")) {
              try { localStorage.setItem(`cradleos:policy:${vault.objectId}`, id); } catch { /* */ }
            } else if (t.includes("PassageLog")) {
              setPassageLogId(vault.objectId, id);
            }
          }
        } catch { /* fall through to event discovery */ }
      }
      invalidate();
      refetchPolicyId();
    } catch (e) { setCreateErr(e instanceof Error ? e.message : String(e)); }
    finally { setCreateBusy(false); }
  };

  const handleSaveRelations = async () => {
    if (!account || !policyId || draft.size === 0) return;
    setSaveBusy(true); setSaveErr(null);
    try {
      const ids = Array.from(draft.keys());
      const friendly = ids.map(id => draft.get(id)!);
      const tx = buildSetRelationsBatchTransaction(policyId, vault.objectId, ids, friendly);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      setDraft(new Map());
      invalidate();
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaveBusy(false); }
  };

  const handleToggleEnforce = async () => {
    if (!account || !policyId || !policy) return;
    try {
      const tx = buildSetEnforceTransaction(policyId, vault.objectId, !policy.enforce);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      invalidate();
    } catch (e) { setSaveErr(e instanceof Error ? e.message : String(e)); }
  };

  const handleLogPassage = async () => {
    if (!account || !logId || !logTurret || !logEntity) return;
    setLogBusy(true); setLogErr(null);
    try {
      const tx = buildLogPassageTransaction(logId, logTurret, logEntity, logNote, Date.now());
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      setLogTurret(""); setLogEntity(""); setLogNote("");
      invalidate();
    } catch (e) { setLogErr(e instanceof Error ? e.message : String(e)); }
    finally { setLogBusy(false); }
  };

  const toggleDraft = (tribeId: number) => {
    const current = draft.has(tribeId) ? draft.get(tribeId)! : (relations?.get(tribeId) ?? false);
    setDraft(prev => new Map(prev).set(tribeId, !current));
  };

  const effectiveRelation = (tribeId: number): boolean => {
    if (draft.has(tribeId)) return draft.get(tribeId)!;
    return relations?.get(tribeId) ?? false;
  };

  // Filter out own tribe by both vault ID and tribe ID
  // Merge: on-chain tribes + well-known tribes + manually added tribes
  // Deduplicate by tribeId; filter out own tribe
  const ownTribeId = String(vault.tribeId);
  const mergedTribes: KnownTribe[] = [];
  const seenIds = new Set<string>();
  for (const t of [...(tribes ?? []), ...WELL_KNOWN_TRIBES.map(w => ({ ...w, vaultId: "" })), ...manualTribes]) {
    const key = String(t.tribeId);
    if (seenIds.has(key) || key === ownTribeId) continue;
    seenIds.add(key);
    mergedTribes.push(t);
  }
  const otherTribes = mergedTribes;

  // ── No policy yet ───────────────────────────────────────────────────────

  if (!policyId) {
    return (
      <div className="card">
        <div style={{ color: "#aaa", fontWeight: 600, marginBottom: "16px" }}>
          🛡 Tribe Defense Policy
        </div>
        <p style={{ color: "#666", fontSize: "13px", marginBottom: "20px" }}>
          No defense policy exists for this vault. Create one to manage tribe
          diplomatic relations and turret intel logging.
        </p>
        {isFounder && (
          <>
            <button className="accent-button" onClick={handleCreate} disabled={createBusy}>
              {createBusy ? "Creating…" : "Create Defense Policy"}
            </button>
            {createErr && <div style={{ color: "#ff6432", fontSize: "12px", marginTop: "8px" }}>⚠ {createErr}</div>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      {/* Header + enforce toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div style={{ color: "#ffa032", fontWeight: 700, fontSize: "18px" }}>🛡 Defense Policy</div>
        <div style={{ color: "#555", fontSize: "12px" }}>v{policy?.version ?? 0}</div>
        {isFounder && policy && (
          <button
            onClick={handleToggleEnforce}
            style={{
              marginLeft: "auto",
              background: policy.enforce ? "rgba(0,255,150,0.12)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${policy.enforce ? "#00ff9640" : "rgba(255,255,255,0.1)"}`,
              color: policy.enforce ? "#00ff96" : "#666",
              borderRadius: "6px", fontSize: "12px", padding: "5px 14px", cursor: "pointer",
            }}
          >
            {policy.enforce ? "⚡ Enforce: ON" : "○ Enforce: OFF"}
          </button>
        )}
        {!isFounder && policy && (
          <div style={{
            marginLeft: "auto",
            padding: "4px 12px", borderRadius: "6px", fontSize: "12px",
            background: policy.enforce ? "rgba(255,160,50,0.1)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${policy.enforce ? "rgba(255,160,50,0.3)" : "rgba(255,255,255,0.08)"}`,
            color: policy.enforce ? "#ffa032" : "#555",
          }}>
            {policy.enforce ? "⚡ Policy Enforced" : "○ Advisory Only"}
          </div>
        )}
      </div>

      {/* Tribe relations grid */}
      <div style={{
        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,160,50,0.12)",
        borderRadius: "8px", padding: "14px", marginBottom: "20px",
      }}>
        <div style={{ color: "#ffa032", fontWeight: 600, fontSize: "13px", marginBottom: "12px" }}>
          Tribe Relations
          {!isFounder && <span style={{ color: "#555", fontWeight: 400, marginLeft: "8px", fontSize: "11px" }}>read-only</span>}
        </div>

        {otherTribes.length === 0 ? (
          <div style={{ color: "#555", fontSize: "12px" }}>No other tribes found on-chain yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {otherTribes.map(tribe => {
              const isFriendly = effectiveRelation(tribe.tribeId);
              const hasDraftChange = draft.has(tribe.tribeId);
              return (
                <div key={tribe.tribeId} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "8px 12px",
                  background: isFriendly ? "rgba(0,255,150,0.04)" : "rgba(255,100,50,0.04)",
                  border: `1px solid ${isFriendly ? "rgba(0,255,150,0.15)" : "rgba(255,100,50,0.15)"}`,
                  borderRadius: "6px",
                }}>
                  <span style={{
                    fontSize: "12px", fontWeight: 700,
                    color: isFriendly ? "#00ff96" : "#ff6432",
                    minWidth: "60px", fontFamily: "monospace",
                  }}>
                    {tribe.coinSymbol}
                  </span>
                  <span style={{ color: "#555", fontSize: "11px", fontFamily: "monospace", flex: 1 }}>
                    tribe #{tribe.tribeId}
                    {WELL_KNOWN_TRIBES.find(w => w.tribeId === tribe.tribeId)?.label && (
                      <span style={{ color: "#444", marginLeft: "6px", fontFamily: "sans-serif" }}>
                        ({WELL_KNOWN_TRIBES.find(w => w.tribeId === tribe.tribeId)!.label})
                      </span>
                    )}
                  </span>
                  <span style={{
                    fontSize: "11px", fontWeight: 600,
                    color: isFriendly ? "#00ff96" : "#ff6432",
                  }}>
                    {isFriendly ? "● FRIENDLY" : "● HOSTILE"}
                  </span>
                  {hasDraftChange && (
                    <span style={{ fontSize: "10px", color: "#ffa032" }}>unsaved</span>
                  )}
                  {isFounder && (
                    <button
                      onClick={() => toggleDraft(tribe.tribeId)}
                      style={{
                        background: isFriendly ? "rgba(255,100,50,0.1)" : "rgba(0,255,150,0.1)",
                        border: `1px solid ${isFriendly ? "rgba(255,100,50,0.3)" : "#00ff9640"}`,
                        color: isFriendly ? "#ff6432" : "#00ff96",
                        borderRadius: "4px", fontSize: "11px", padding: "3px 10px", cursor: "pointer",
                      }}
                    >
                      {isFriendly ? "Set Hostile" : "Set Friendly"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isFounder && draft.size > 0 && (
          <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="accent-button"
              onClick={handleSaveRelations}
              disabled={saveBusy}
              style={{ padding: "6px 18px", fontSize: "12px" }}
            >
              {saveBusy ? "Saving…" : `Save ${draft.size} Change${draft.size > 1 ? "s" : ""} On-Chain`}
            </button>
            <button
              onClick={() => setDraft(new Map())}
              style={{
                background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
                color: "#555", borderRadius: "4px", fontSize: "11px", padding: "5px 12px", cursor: "pointer",
              }}
            >
              Discard
            </button>
            {saveErr && <div style={{ color: "#ff6432", fontSize: "11px" }}>⚠ {saveErr}</div>}
          </div>
        )}

        {/* Add tribe manually */}
        {isFounder && (
          <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              value={addTribeInput}
              onChange={e => setAddTribeInput(e.target.value.replace(/\D/g, ""))}
              placeholder="Add tribe ID (e.g. 1000167)"
              style={{
                width: "200px", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px",
                color: "#aaa", fontSize: "11px", padding: "5px 8px", outline: "none",
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={() => {
                const id = parseInt(addTribeInput, 10);
                if (!id || seenIds.has(String(id))) { setAddTribeInput(""); return; }
                setManualTribes(prev => [...prev, { tribeId: id, coinSymbol: "?", vaultId: "" }]);
                setAddTribeInput("");
              }}
              disabled={!addTribeInput}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                color: "#888", borderRadius: "4px", fontSize: "11px", padding: "5px 12px", cursor: "pointer",
              }}
            >
              + Add Tribe
            </button>
          </div>
        )}
      </div>

      {/* Passage intel log */}
      <div style={{
        background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px", padding: "14px", marginBottom: "20px",
      }}>
        <div style={{ color: "#aaa", fontWeight: 600, fontSize: "13px", marginBottom: "12px" }}>
          📡 Passage Intel Log
        </div>

        {/* Log entry form */}
        {logId && (
          <div style={{ marginBottom: "14px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#555", fontSize: "10px" }}>TURRET ID</span>
              <input
                value={logTurret}
                onChange={e => setLogTurret(e.target.value)}
                placeholder="0x..."
                style={{
                  width: "140px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "4px", color: "#fff", fontSize: "11px", padding: "5px 8px", outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#555", fontSize: "10px" }}>ENTITY ID (observed)</span>
              <input
                value={logEntity}
                onChange={e => setLogEntity(e.target.value)}
                placeholder="0x..."
                style={{
                  width: "140px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "4px", color: "#fff", fontSize: "11px", padding: "5px 8px", outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span style={{ color: "#555", fontSize: "10px" }}>NOTE</span>
              <input
                value={logNote}
                onChange={e => setLogNote(e.target.value)}
                placeholder="hostile capital..."
                style={{
                  width: "160px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "4px", color: "#fff", fontSize: "11px", padding: "5px 8px", outline: "none",
                }}
              />
            </div>
            <button
              onClick={handleLogPassage}
              disabled={logBusy || !logTurret || !logEntity}
              style={{
                background: "rgba(100,180,255,0.1)", border: "1px solid rgba(100,180,255,0.3)",
                color: "#64b4ff", borderRadius: "4px", fontSize: "12px", padding: "5px 14px", cursor: "pointer",
              }}
            >
              {logBusy ? "…" : "Log Entry"}
            </button>
            {logErr && <div style={{ color: "#ff6432", fontSize: "11px" }}>⚠ {logErr}</div>}
          </div>
        )}

        {/* Intel feed */}
        {(passages ?? []).length === 0 ? (
          <div style={{ color: "#555", fontSize: "12px" }}>No passage events logged yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", gap: "8px", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: "4px" }}>
              {["#", "TURRET", "ENTITY", "NOTE", "REPORTER", "TIME"].map(h => (
                <span key={h} style={{ color: "#444", fontSize: "10px", letterSpacing: "0.06em", flex: h === "NOTE" ? 2 : 1 }}>{h}</span>
              ))}
            </div>
            {(passages ?? []).map(ev => (
              <div key={ev.entryIndex} style={{
                display: "flex", gap: "8px", fontSize: "11px", color: "#888",
                padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)",
              }}>
                <span style={{ flex: 1, color: "#555" }}>#{ev.entryIndex}</span>
                <span style={{ flex: 1, fontFamily: "monospace" }}>{shortAddr(ev.turretId)}</span>
                <span style={{ flex: 1, fontFamily: "monospace", color: "#ffa032" }}>{shortAddr(ev.entityId)}</span>
                <span style={{ flex: 2, color: "#aaa" }}>{ev.note || "—"}</span>
                <span style={{ flex: 1, fontFamily: "monospace" }}>{shortAddr(ev.reporter)}</span>
                <span style={{ flex: 1, color: "#555" }}>
                  {ev.timestampMs ? new Date(ev.timestampMs).toLocaleTimeString() : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
