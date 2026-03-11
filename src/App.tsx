import { useState } from "react";
import { abbreviateAddress, useConnection } from "@evefrontier/dapp-kit";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { CorpOverview } from "./components/CorpOverview";
import { NodeDashboard } from "./components/NodeDashboard";

function App() {
  const { handleConnect, handleDisconnect } = useConnection();
  const account = useCurrentAccount();
  const [lastDigest, setLastDigest] = useState<string | undefined>();

  return (
    <main className="app-shell">
      <header className="topbar hud-panel">
        <div>
          <p className="eyebrow">EVE Frontier × Sui Hackathon</p>
          <h1>CradleOS Command Console</h1>
          <p className="muted-text">Network node activation, corp telemetry, wallet-signed actions only.</p>
        </div>

        <div className="wallet-cluster">
          <div className="wallet-readout">
            <span className="stat-label">Wallet</span>
            <strong>{account ? abbreviateAddress(account.address) : "DISCONNECTED"}</strong>
          </div>
          <button
            className="accent-button"
            onClick={() => (account ? handleDisconnect() : handleConnect())}
          >
            {account ? "Disconnect" : "Connect Slush / Sui Wallet"}
          </button>
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

      <div className="dashboard-grid">
        <NodeDashboard onTxSuccess={setLastDigest} />
        <CorpOverview />
      </div>
    </main>
  );
}

export default App;
