import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import {
  fetchPlayerStructures,
  parseAvailableEnergy,
  rpcGetObject,
  buildStructureOnlineTransaction,
  buildStructureOfflineTransaction,
  buildBatchOnlineTransaction,
  buildBatchOfflineTransaction,
  buildRenameTransaction,
  type LocationGroup,
  type PlayerStructure,
} from "../lib";

function readDigest(result: unknown): string | undefined {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    return (r["digest"] ?? r["txDigest"] ?? r["transactionDigest"]) as string | undefined;
  }
  return undefined;
}

const KIND_ICON: Record<string, string> = {
  NetworkNode: "📡",
  Gate: "🔀",
  Assembly: "⚙️",
  Turret: "🔫",
  StorageUnit: "📦",
};

/**
 * Derive a human-readable storage unit size label from energy cost.
 * EVE Frontier storage unit tiers by energy requirement:
 *   Heavy  ≥ 400 ⚡  (large industrial containers)
 *   Standard 60–399   (standard storage)
 *   Mini   < 60       (smallest deployable)
 */
function storageUnitSize(energyCost?: number): string {
  if (energyCost == null || energyCost === 0) return "";
  if (energyCost >= 400) return "Heavy";
  if (energyCost >= 60)  return "Standard";
  return "Mini";
}

/** Short location hash for display — last 8 hex chars. */

function StatusBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span style={{
      padding: "2px 10px",
      borderRadius: "12px",
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      background: isOnline ? "rgba(0,255,150,0.12)" : "rgba(255,100,50,0.12)",
      color: isOnline ? "#00ff96" : "#ff6432",
      border: `1px solid ${isOnline ? "#00ff9640" : "#ff643240"}`,
    }}>
      {isOnline ? "● ONLINE" : "○ OFFLINE"}
    </span>
  );
}

function StructureRow({
  structure,
  characterId,
  onTxSuccess,
}: {
  structure: PlayerStructure;
  characterId: string;
  onTxSuccess?: (digest?: string) => void;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(structure.displayName === structure.label ? "" : structure.displayName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const handleOnline = async () => {
    setBusy(true); setErr(null);
    try {
      const tx = buildStructureOnlineTransaction(structure, characterId);
      const signer = new CurrentAccountSigner(dAppKit);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      onTxSuccess?.(readDigest(result));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handleOffline = async () => {
    setBusy(true); setErr(null);
    try {
      const tx = await buildStructureOfflineTransaction(structure, characterId);
      const signer = new CurrentAccountSigner(dAppKit);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      onTxSuccess?.(readDigest(result));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const handleRename = async () => {
    const name = nameInput.trim();
    if (!name) { setRenaming(false); return; }
    setBusy(true); setErr(null);
    try {
      const tx = buildRenameTransaction(structure, characterId, name);
      const signer = new CurrentAccountSigner(dAppKit);
      const result = await signer.signAndExecuteTransaction({ transaction: tx });
      setRenaming(false);
      onTxSuccess?.(readDigest(result));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  const canOnline = !!account && !busy && !structure.isOnline;
  const canOffline = !!account && !busy && structure.isOnline;
  // All 5 structure kinds expose update_metadata_name in the world contract
  const canRename = !!account && !busy;

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,160,50,0.15)",
      borderRadius: "6px",
      padding: "12px 16px",
      marginBottom: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "18px" }}>{KIND_ICON[structure.kind] ?? "⚙️"}</span>

        {/* Name / inline rename */}
        {renaming ? (
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <input
              ref={inputRef}
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
              placeholder={structure.label}
              style={{
                background: "rgba(255,160,50,0.08)",
                border: "1px solid rgba(255,160,50,0.4)",
                borderRadius: "4px",
                color: "#ffa032",
                fontSize: "13px",
                fontWeight: 600,
                padding: "3px 8px",
                outline: "none",
                width: "160px",
              }}
            />
            <button className="accent-button" onClick={handleRename} disabled={busy} style={{ padding: "3px 10px", fontSize: "12px" }}>
              {busy ? "…" : "Save"}
            </button>
            <button className="ghost-button" onClick={() => setRenaming(false)} style={{ padding: "3px 10px", fontSize: "12px" }}>
              ✕
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#ffa032", fontWeight: 600, minWidth: "110px" }}>{structure.displayName}</span>
            {/* Object ID chip — always unique, links to chain explorer */}
            <a
              href={`https://suiscan.xyz/testnet/object/${structure.objectId}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Object ID: ${structure.objectId}`}
              style={{
                display: "inline-block",
                fontFamily: "monospace",
                fontSize: "10px",
                color: "#444",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "4px",
                padding: "1px 5px",
                letterSpacing: "0.04em",
                textDecoration: "none",
                cursor: "pointer",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#888")}
              onMouseLeave={e => (e.currentTarget.style.color = "#444")}
            >
              #{structure.objectId.slice(-6)}
            </a>
            {canRename && (
              <button
                onClick={() => setRenaming(true)}
                title="Rename"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#555",
                  fontSize: "13px",
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >
                ✎
              </button>
            )}
          </div>
        )}

        {/* Storage unit size badge — right of name */}
        {structure.kind === "StorageUnit" && storageUnitSize(structure.energyCost) && (
          <span style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em",
            padding: "2px 7px", borderRadius: "4px",
            background: "rgba(255,160,50,0.10)", border: "1px solid rgba(255,160,50,0.22)",
            color: "#cc8020", flexShrink: 0,
          }}>
            {storageUnitSize(structure.energyCost).toUpperCase()}
          </span>
        )}

        <StatusBadge isOnline={structure.isOnline} />

        {structure.kind === "NetworkNode" && structure.fuelLevelPct !== undefined && (
          <span style={{ fontSize: "12px", color: "#888", marginLeft: "4px" }}>
            ⛽ {structure.fuelLevelPct.toFixed(1)}% · ⏱ {structure.runtimeHoursRemaining?.toFixed(0)}h
          </span>
        )}

        {/* Energy cost badge (non-NetworkNode structures) */}
        {structure.kind !== "NetworkNode" && structure.energyCost !== undefined && structure.energyCost > 0 && (
          <span style={{
            fontSize: "10px",
            color: "#666",
            background: "rgba(255,160,50,0.06)",
            border: "1px solid rgba(255,160,50,0.15)",
            borderRadius: "4px",
            padding: "1px 5px",
            fontFamily: "monospace",
          }}>
            ⚡{structure.energyCost}
          </span>
        )}

        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          <button
            className="accent-button"
            onClick={handleOnline}
            disabled={!canOnline}
            style={{ padding: "4px 12px", fontSize: "12px" }}
          >
            {busy ? "…" : "Online"}
          </button>
          <button
            className="ghost-button"
            onClick={handleOffline}
            disabled={!canOffline}
            style={{ padding: "4px 12px", fontSize: "12px" }}
          >
            {busy ? "…" : "Offline"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ color: "#ff6432", fontSize: "11px", marginTop: "6px" }}>
          ⚠ {err}
        </div>
      )}
    </div>
  );
}

// ── Batch Online / Offline controls ─────────────────────────────────────────

function GroupBatchControls({
  structures,
  characterId,
  nodeId,
  onAllDone,
}: {
  structures: PlayerStructure[];
  characterId: string;
  nodeId?: string;
  onAllDone: () => void;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busy, setBusy] = useState<"online" | "offline" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [availableEnergy, setAvailableEnergy] = useState<number | null>(null);

  // Fetch available energy from the NetworkNode
  useEffect(() => {
    if (!nodeId) return;
    rpcGetObject(nodeId).then((fields: Record<string, unknown>) => {
      setAvailableEnergy(parseAvailableEnergy(fields));
    }).catch(() => {});
  }, [nodeId, structures]);

  const offlineStructures = structures.filter(s => !s.isOnline && s.kind !== "NetworkNode");
  const onlineStructures  = structures.filter(s => s.isOnline && s.kind !== "NetworkNode");

  // Compute which offline structures can actually be brought online within energy budget
  const affordableOffline = (() => {
    if (availableEnergy === null) return offlineStructures; // unknown — try all
    let budget = availableEnergy;
    const result: PlayerStructure[] = [];
    for (const s of offlineStructures.slice().sort((a, b) => (a.energyCost ?? 0) - (b.energyCost ?? 0))) {
      const cost = s.energyCost ?? 0;
      if (cost === 0 || budget >= cost) {
        result.push(s);
        budget -= cost;
      }
    }
    return result;
  })();

  // Energy that would be consumed by bringing all affordable offline structures online
  const pendingCost = affordableOffline.reduce((sum, s) => sum + (s.energyCost ?? 0), 0);

  const runBatch = async (targets: PlayerStructure[], action: "online" | "offline") => {
    if (!account || !targets.length) return;
    setBusy(action); setErr(null);
    try {
      const tx = action === "online"
        ? buildBatchOnlineTransaction(targets, characterId)
        : await buildBatchOfflineTransaction(targets, characterId);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      onAllDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (structures.length <= 1) return null;

  const skipped = offlineStructures.length - affordableOffline.length;

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px",
      padding: "8px 12px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,160,50,0.10)",
      borderRadius: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ color: "#555", fontSize: "11px", letterSpacing: "0.06em" }}>BATCH</span>

        <button
          className="accent-button"
          onClick={() => runBatch(affordableOffline, "online")}
          disabled={!!busy || !account || affordableOffline.length === 0}
          style={{ padding: "4px 14px", fontSize: "12px" }}
        >
          {busy === "online" ? "Signing…" : `⚡ Online (${affordableOffline.length})`}
        </button>

        <button
          className="ghost-button"
          onClick={() => runBatch(onlineStructures, "offline")}
          disabled={!!busy || !account || onlineStructures.length === 0}
          style={{ padding: "4px 14px", fontSize: "12px" }}
        >
          {busy === "offline" ? "Signing…" : `○ Offline All (${onlineStructures.length})`}
        </button>

        {/* Energy tally */}
        {availableEnergy !== null && (
          <span style={{ marginLeft: "auto", fontSize: "11px", color: availableEnergy < 50 ? "#ff6432" : "#888" }}>
            ⚡ {availableEnergy - (busy === "online" ? pendingCost : 0)} / {availableEnergy + onlineStructures.reduce((s, x) => s + (x.energyCost ?? 0), 0)} available
          </span>
        )}
      </div>

      {skipped > 0 && (
        <div style={{ fontSize: "10px", color: "#ff6432" }}>
          ⚠ {skipped} structure{skipped > 1 ? "s" : ""} skipped — insufficient node energy
          {offlineStructures.filter(s => !affordableOffline.includes(s)).map(s =>
            ` · ${s.displayName} (⚡${s.energyCost ?? "?"})`
          ).join("")}
        </div>
      )}

      {err && (
        <div style={{ color: "#ff6432", fontSize: "11px" }}>⚠ {err}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  onTxSuccess?: (digest?: string) => void;
};

export function StructurePanel({ onTxSuccess }: Props) {
  const account = useCurrentAccount();
  const [activeTab, setActiveTab] = useState(0);
  const [characterId, setCharacterId] = useState<string | null>(null);

  const { data: groups, isLoading, error, refetch } = useQuery<LocationGroup[]>({
    queryKey: ["playerStructures", account?.address],
    queryFn: async () => {
      if (!account?.address) return [];
      const groups = await fetchPlayerStructures(account.address);
      // Extract character ID from the first structure's ownerCap chain (via lib internals),
      // but since fetchPlayerStructures resolves it internally, query CharacterCreatedEvent here too.
      const res = await fetch("https://fullnode.testnet.sui.io:443", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "suix_queryEvents",
          params: [{ MoveEventType: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75::character::CharacterCreatedEvent" }, null, 50, false],
        }),
      });
      const j = await res.json() as { result: { data: Array<{ parsedJson: { character_address: string; character_id: string } }> } };
      const match = j.result.data.find(e => e.parsedJson.character_address.toLowerCase() === account.address.toLowerCase());
      setCharacterId(match?.parsedJson.character_id ?? null);
      return groups;
    },
    enabled: !!account?.address,
    staleTime: 30_000,
  });

  const handleTxSuccess = (digest?: string) => {
    onTxSuccess?.(digest);
    setTimeout(() => refetch(), 2000);
  };

  if (!account) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "32px", color: "#888" }}>
        Connect EVE Vault to view your structures
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "32px", color: "#888" }}>
        Scanning structures…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ color: "#ff6432", padding: "16px" }}>
        Failed to load structures: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "32px", color: "#888" }}>
        No structures found for this character
      </div>
    );
  }

  const activeGroup = groups[activeTab] ?? groups[0];

  return (
    <div>
      {/* Location Tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "16px", flexWrap: "wrap" }}>
        {groups.map((group, idx) => (
          <button
            key={group.key}
            onClick={() => setActiveTab(idx)}
            style={{
              padding: "6px 16px",
              borderRadius: "20px",
              border: `1px solid ${idx === activeTab ? "#ffa032" : "rgba(255,160,50,0.25)"}`,
              background: idx === activeTab ? "rgba(255,160,50,0.15)" : "transparent",
              color: idx === activeTab ? "#ffa032" : "#888",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: idx === activeTab ? 600 : 400,
              transition: "all 0.15s",
            }}
          >
            🌐 {group.tabLabel}
            <span style={{ marginLeft: "6px", fontSize: "11px", opacity: 0.7 }}>
              ({group.structures.length})
            </span>
          </button>
        ))}
      </div>

      {/* Batch controls */}
      {characterId && (
        <GroupBatchControls
          structures={activeGroup.structures}
          characterId={characterId}
          nodeId={activeGroup.structures.find(s => s.kind === "NetworkNode")?.objectId}
          onAllDone={() => setTimeout(() => refetch(), 2000)}
        />
      )}

      {/* Structure List */}
      <div>
        {activeGroup.structures.map((s) => (
          <StructureRow
            key={s.objectId}
            structure={s}
            characterId={characterId ?? ""}
            onTxSuccess={handleTxSuccess}
          />
        ))}
      </div>
    </div>
  );
}
