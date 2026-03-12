import { useState } from "react";
import { abbreviateAddress, useConnection } from "@evefrontier/dapp-kit";
import { useCurrentAccount, useWallets, useDAppKit } from "@mysten/dapp-kit-react";
import { StructurePanel } from "./components/StructurePanel";
import { TribeVaultPanel } from "./components/TribeVaultPanel";

type Tab = "structures" | "tribe";

function App() {
  const { handleDisconnect, hasEveVault, isConnected } = useConnection();
  const account = useCurrentAccount();
  const wallets = useWallets();
  const dAppKit = useDAppKit();
  const [lastDigest, setLastDigest] = useState<string | undefined>();
  const [connectError, setConnectError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<Tab>("structures");


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
            <a
              className="accent-button"
              href="https://github.com/evefrontier/evevault/releases/download/v0.0.5/eve-vault-chrome-v0.0.5.zip"
              target="_blank"
              rel="noreferrer"
            >
              Install EVE Vault
            </a>
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

      <section className="hero hud-panel">
        <div>
          <p className="eyebrow">Mission Profile</p>
          <h2>Bring infrastructure online without handing the frontend a private key.</h2>
        </div>
        <ul className="hero-list">
          <li>Wallet connect through EVE Frontier dApp kit</li>
          <li>Live node telemetry read from Sui testnet</li>
          <li>Programmable transaction sent to wallet popup for approval</li>
          <li>Corp registry overview from deployed CradleOS package</li>
        </ul>
        {lastDigest ? (
          <p className="success-text">Last tx digest: {lastDigest}</p>
        ) : null}
      </section>

      {/* Main nav tabs */}
      <div style={{ display: "flex", gap: "4px", padding: "0 0 16px 0" }}>
        {(["structures", "tribe"] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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
            {tab === "structures" ? "🏗 Structures" : "⚓ Tribe Coin"}
          </button>
        ))}
      </div>

      <div className="dashboard-grid">
        {activeTab === "structures" && <StructurePanel    onTxSuccess={setLastDigest} />}
        {activeTab === "tribe"      && <TribeVaultPanel   onTxSuccess={setLastDigest} />}
      </div>
    </main>
  );
}

export default App;
