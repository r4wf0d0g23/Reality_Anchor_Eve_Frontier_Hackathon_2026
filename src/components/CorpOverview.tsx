import { useQuery } from "@tanstack/react-query";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { fetchCorpOverview } from "../lib";

export function CorpOverview() {
  const client = useCurrentClient();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["corp-overview"],
    queryFn: () => fetchCorpOverview(client as never),
    refetchInterval: 30000,
  });

  return (
    <section className="hud-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Corporation Registry</p>
          <h2>Corp Overview</h2>
        </div>
        <button className="ghost-button" onClick={() => refetch()} disabled={isLoading || isRefetching}>
          {isRefetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p className="error-text">Failed to load corp registry: {(error as Error).message}</p> : null}

      {!data && !isLoading ? (
        <div className="empty-state">
          <p>No CradleOS CorpRegistry found for the current seed data yet.</p>
          <p className="muted-text">This panel is wired for on-chain reads and will populate once a registry object exists.</p>
        </div>
      ) : (
        <div className="stat-grid">
          <div className="stat-card">
            <span className="stat-label">Corp Name</span>
            <strong>{data?.name ?? "Loading…"}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Tribe ID</span>
            <strong>{data?.tribeId ?? "—"}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Member Count</span>
            <strong>{data?.memberCount ?? 0}</strong>
          </div>
          <div className="stat-card">
            <span className="stat-label">Registry Object</span>
            <code>{data?.objectId ?? "—"}</code>
          </div>
        </div>
      )}
    </section>
  );
}
