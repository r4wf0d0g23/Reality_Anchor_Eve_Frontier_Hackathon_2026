import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import { RAW_NETWORK_NODE_ID } from "../constants";
import { buildBringOnlineTransaction, buildBringOfflineTransaction, fetchNodeDashboard } from "../lib";

type Props = {
  onTxSuccess?: (digest?: string) => void;
};

export function NodeDashboard({ onTxSuccess }: Props) {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["node-dashboard", RAW_NETWORK_NODE_ID],
    queryFn: () => fetchNodeDashboard(client as never),
    refetchInterval: 15000,
  });

  const statusTone = useMemo(() => {
    if (!data) return "var(--hud-muted)";
    return data.isOnline ? "var(--hud-good)" : "var(--hud-warn)";
  }, [data]);

  const handleBringOnline = async () => {
    if (!account) throw new Error("No connected wallet available for signing.");
    const tx = buildBringOnlineTransaction();
    const signer = new CurrentAccountSigner(dAppKit);
    const result = await signer.signAndExecuteTransaction({ transaction: tx });
    onTxSuccess?.(readDigest(result));
    await refetch();
  };

  const handleBringOffline = async () => {
    if (!account) throw new Error("No connected wallet available for signing.");
    const tx = await buildBringOfflineTransaction();
    const signer = new CurrentAccountSigner(dAppKit);
    const result = await signer.signAndExecuteTransaction({ transaction: tx });
    onTxSuccess?.(readDigest(result));
    await refetch();
  };

  return (
    <section className="hud-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Network Node</p>
          <h2>CradleOS Node Dashboard</h2>
        </div>
        <button className="ghost-button" onClick={() => refetch()} disabled={isLoading || isRefetching}>
          {isRefetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">Node ID</span>
          <code>{RAW_NETWORK_NODE_ID}</code>
        </div>
        <div className="stat-card">
          <span className="stat-label">Status</span>
          <strong style={{ color: statusTone }}>{data?.isOnline ? "ONLINE" : "OFFLINE"}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Fuel</span>
          <strong>{data ? `${data.fuelLevelPct}%` : "—"}</strong>
          <div className="fuel-bar">
            <div className="fuel-fill" style={{ width: `${data?.fuelLevelPct ?? 0}%` }} />
          </div>
        </div>
        <div className="stat-card">
          <span className="stat-label">Runtime Remaining</span>
          <strong>{data ? `${data.runtimeHoursRemaining}h` : "—"}</strong>
        </div>
      </div>

      {error ? <p className="error-text">Failed to load node state: {(error as Error).message}</p> : null}

      <div className="panel-footer">
        <p className="muted-text">
          Sends a programmable transaction to the connected wallet: borrow owner cap → online(node, cap, clock) → return owner cap.
        </p>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="accent-button" onClick={handleBringOnline} disabled={!account || data?.isOnline}>
            {!account ? "Connect Wallet to Continue" : "Bring Online"}
          </button>
          <button className="ghost-button" onClick={handleBringOffline} disabled={!account || !data?.isOnline}>
            Bring Offline
          </button>
        </div>
      </div>
    </section>
  );
}

function readDigest(result: unknown): string | undefined {
  if (result && typeof result === "object" && "digest" in result && typeof result.digest === "string") {
    return result.digest;
  }
  return undefined;
}
