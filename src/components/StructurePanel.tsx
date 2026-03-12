import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import {
  fetchPlayerStructures,
  buildStructureOnlineTransaction,
  buildStructureOfflineTransaction,
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
  Gate: "🚪",
  Assembly: "🔧",
  Turret: "🔫",
  StorageUnit: "📦",
};

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

  const canOnline = !!account && !busy && !structure.isOnline;
  const canOffline = !!account && !busy && structure.isOnline;

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
        <span style={{ color: "#ffa032", fontWeight: 600, minWidth: "110px" }}>{structure.label}</span>
        <StatusBadge isOnline={structure.isOnline} />

        {structure.kind === "NetworkNode" && structure.fuelLevelPct !== undefined && (
          <span style={{ fontSize: "12px", color: "#888", marginLeft: "8px" }}>
            ⛽ {structure.fuelLevelPct.toFixed(1)}% · ⏱ {structure.runtimeHoursRemaining?.toFixed(0)}h
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
      // Fetch character ID for this wallet (needed for borrow_owner_cap)
      const res = await fetch("https://fullnode.testnet.sui.io:443", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "suix_getOwnedObjects",
          params: [account.address, { filter: { StructType: "0xd12a70c74c1e759445d6f209b01d43d860e97fcf2ef72ccbbd00afd828043f75::character::Character" }, options: { showType: true } }, null, 1],
        }),
      });
      const charJson = await res.json() as { result: { data: Array<{ data: { objectId: string } }> } };
      const charId = charJson.result.data[0]?.data.objectId ?? null;
      setCharacterId(charId);
      if (!charId) return [];
      return fetchPlayerStructures(account.address);
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
            key={group.locationHash}
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
