import { useState, useCallback } from "react";
import { abbreviateAddress, useConnection } from "@evefrontier/dapp-kit";
import { useCurrentAccount, useWallets, useDAppKit } from "@mysten/dapp-kit-react";
import { StructurePanel } from "./components/StructurePanel";
import { TribeVaultPanel } from "./components/TribeVaultPanel";
import { TurretPolicyPanel } from "./components/TurretPolicyPanel";
import { RegistryPanel } from "./components/RegistryPanel";
import { MapPanel } from "./components/MapPanel";

type Tab = "structures" | "tribe" | "defense" | "registry" | "map";

function App() {
  const { handleDisconnect, hasEveVault, isConnected } = useConnection();
  const account = useCurrentAccount();
  const wallets = useWallets();
  const dAppKit = useDAppKit();
  const [lastDigest, setLastDigest] = useState<string | undefined>();
  const [connectError, setConnectError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<Tab>("structures");
  const [briefOpen, setBriefOpen] = useState(false);

  const TAB_BRIEF: Record<Tab, { title: string; steps: string[] }> = {
    map: {
      title: "Interactive starmap — all 24 502 EVE Frontier solar systems",
      steps: [
        "Scroll to zoom in and out",
        "Drag to pan across the galaxy",
        "Hover over any dot to see the system name",
        "Dots are colour-coded by region",
        "Hit ⊡ Fit to reset the view",
      ],
    },
    structures: {
      title: "Bring structures online via your Network Node",
      steps: [
        "Connect EVE Vault — your wallet address must own the structures",
        "Structures are grouped by solar system (tab per location)",
        "Bring All Online sends a single batched transaction",
        "Register structures to mint CRDL infra credits to your tribe vault",
        "Rename any structure with the ✎ button — writes on-chain",
      ],
    },
    tribe: {
      title: "Launch a tribe economy backed by registered infra",
      steps: [
        "Go to Registry tab first — register your tribe claim",
        "Once claim is active, return here and name your coin",
        "Register structures to mint CRDL to the tribe vault",
        "Issue tribe coins to members as contribution rewards",
        "Tribe coins trade against CRDL on the Tribe DEX",
      ],
    },
    defense: {
      title: "Set passage policy for ships entering your network",
      steps: [
        "Create a defense policy — linked to your tribe vault",
        "Add tribes by ID to set their passage status (allow / deny / toll)",
        "Default spawn tribe 1000167 is pre-loaded",
        "Add unlisted tribes manually via the tribe ID field",
        "Passage events are logged on-chain and readable here",
      ],
    },
    registry: {
      title: "Proof-based tribe vault ownership — prevent squatting",
      steps: [
        "Register a claim for your tribe ID before creating a vault",
        "Claims are epoch-stamped — first on-chain claim wins",
        "Attestor can verify and issue earlier-epoch proofs to legitimate founders",
        "Challenge + Take Vault is atomic — claim and ownership transfer in one tx",
        "Attestor (Raw's wallet) can invalidate fraudulent claims",
      ],
    },
  };

  const brief = TAB_BRIEF[activeTab];

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setBriefOpen(false);
  }, []);


  const handleConnect = async () => {
    const wallet = wallets.find(w => w.name.includes("Eve Vault")) || wallets[0];
    if (!wallet) { setConnectError("No wallet found"); return; }
    setConnectError(undefined);
    try {
      const result = await dAppKit.connectWallet({ wallet });
      console.log("[CradleOS] connect result:", result);
    } catch (err: any) {
      console.error("[CradleOS] connect error:", err);
      setConnectError(err?.message || String(err));
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar hud-panel">
        <div>
          <p className="eyebrow">EVE Frontier × Sui Hackathon</p>
          <h1>CradleOS Command Console</h1>
          <p className="muted-text">Network node activation, corp telemetry, wallet-signed actions only.</p>
        </div>

        {connectError && (
          <div style={{fontSize:'11px',color:'#ff6b6b',fontFamily:'monospace',marginBottom:'4px'}}>
            ERR: {connectError}
          </div>
        )}
        <div className="wallet-cluster">
          <div className="wallet-readout">
            <span className="stat-label">Wallet</span>
            <strong>{account ? abbreviateAddress(account.address) : "DISCONNECTED"}</strong>
          </div>
          {!hasEveVault && !isConnected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", alignItems: "flex-end" }}>
              <div style={{ fontSize: "11px", color: "#ff6432", letterSpacing: "0.05em", marginBottom: "2px" }}>
                ⚠ EVE VAULT NOT DETECTED
              </div>
              <a
                href="https://github.com/evefrontier/evevault/releases/download/v0.0.5/eve-vault-chrome-v0.0.5.zip"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "5px",
                  padding: "6px 14px", borderRadius: "4px", fontSize: "11px", fontWeight: 700,
                  background: "rgba(255,160,50,0.12)", border: "1px solid rgba(255,160,50,0.4)",
                  color: "#ffa032", textDecoration: "none", letterSpacing: "0.05em",
                }}
              >
                ⬇ Install EVE Vault v0.0.5
              </a>
              <div style={{ fontSize: "10px", color: "#444", textAlign: "right" }}>
                Install EVE Vault, then refresh this page
              </div>
            </div>
          ) : (
            <button
              className="accent-button"
              onClick={() => (isConnected ? handleDisconnect() : handleConnect())}
            >
              {isConnected ? "Disconnect" : "Connect EVE Vault"}
            </button>
          )}
        </div>
      </header>

      {/* Collapsible context brief */}
      <div style={{
        marginBottom: "12px",
        border: "1px solid rgba(255,160,50,0.15)",
        borderRadius: "6px",
        overflow: "hidden",
        background: "rgba(255,160,50,0.03)",
      }}>
        <button
          onClick={() => setBriefOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "9px 14px", background: "none", border: "none", cursor: "pointer",
            color: briefOpen ? "#ffa032" : "#555",
          }}
        >
          <span style={{ fontSize: "11px", letterSpacing: "0.07em", fontWeight: 700 }}>
            {briefOpen ? "▾" : "▸"}&nbsp;&nbsp;{brief.title.toUpperCase()}
          </span>
          {lastDigest && !briefOpen && (
            <span style={{ fontFamily: "monospace", fontSize: "10px", color: "#00ff96" }}>
              ✓ {lastDigest.slice(0, 10)}…
            </span>
          )}
        </button>
        {briefOpen && (
          <div style={{ padding: "4px 14px 12px 28px", borderTop: "1px solid rgba(255,160,50,0.08)" }}>
            <ol style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "5px" }}>
              {brief.steps.map((s, i) => (
                <li key={i} style={{ color: "#666", fontSize: "12px", lineHeight: 1.5 }}>{s}</li>
              ))}
            </ol>
            {lastDigest && (
              <div style={{ marginTop: "10px", fontSize: "11px", color: "#00ff96", fontFamily: "monospace" }}>
                ✓ Last tx: {lastDigest}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main nav tabs */}
      <div style={{ display: "flex", gap: "4px", padding: "0 0 16px 0" }}>
        {(["structures", "tribe", "defense", "registry", "map"] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => handleTabChange(tab)}
            style={{
              padding: "8px 22px",
              borderRadius: "20px",
              border: `1px solid ${activeTab === tab ? "#ffa032" : "rgba(255,160,50,0.2)"}`,
              background: activeTab === tab ? "rgba(255,160,50,0.12)" : "transparent",
              color: activeTab === tab ? "#ffa032" : "#666",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: activeTab === tab ? 700 : 400,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              transition: "all 0.15s",
            }}
          >
            {tab === "structures" ? "🏗 Structures"
              : tab === "tribe"   ? "⚓ Tribe Coin"
              : tab === "defense" ? "🛡 Defense"
              : tab === "registry"? "📋 Registry"
              :                     "🗺 Starmap"}
          </button>
        ))}
      </div>

      {activeTab === "map" ? (
        <div style={{ height: "75vh", minHeight: "480px", border: "1px solid rgba(255,160,50,0.12)", borderRadius: "8px", overflow: "hidden" }}>
          <MapPanel />
        </div>
      ) : (
        <div className="dashboard-grid">
          {activeTab === "structures" && <StructurePanel    onTxSuccess={setLastDigest} />}
          {activeTab === "tribe"      && <TribeVaultPanel   onTxSuccess={setLastDigest} />}
          {activeTab === "defense"    && <TurretPolicyPanel />}
          {activeTab === "registry"   && <RegistryPanel />}
        </div>
      )}
    </main>
  );
}

export default App;
