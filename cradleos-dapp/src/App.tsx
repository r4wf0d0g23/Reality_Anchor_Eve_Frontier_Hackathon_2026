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
      <header className="hud-panel" style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        textAlign: "center", position: "relative", padding: "28px 24px 22px",
        marginBottom: "0",
        background: "linear-gradient(180deg, #181818 0%, #0B0B0B 100%)",
        borderColor: "rgba(255,71,0,0.3)",
        borderBottom: "2px solid #FF4700",
        boxShadow: "0 4px 40px rgba(255,71,0,0.08)",
      }}>
        {/* Wallet utility — top-right absolute */}
        <div style={{ position: "absolute", top: "18px", right: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
          {connectError && (
            <span style={{ fontSize:"10px", color:"#ff6b6b", fontFamily:"monospace" }}>
              ERR: {connectError.slice(0,40)}
            </span>
          )}
          <div style={{
            border: "1px solid rgba(255,71,0,0.25)", borderRadius: "0",
            padding: "6px 12px", fontSize: "11px", fontFamily: "inherit",
            color: account ? "#FF4700" : "rgba(107,107,94,0.7)", letterSpacing: "0.08em",
            fontWeight: 700, background: "#111111",
            textTransform: "uppercase",
          }}>
            {account ? abbreviateAddress(account.address) : "NO WALLET"}
          </div>
          {!hasEveVault && !isConnected ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "5px", alignItems: "flex-end" }}>
              <div style={{ fontSize: "10px", color: "#FF4700", letterSpacing: "0.12em", fontWeight:700, textTransform:"uppercase" }}>⚠ EVE VAULT NOT DETECTED</div>
              <a
                href="https://github.com/evefrontier/evevault/releases/download/v0.0.5/eve-vault-chrome-v0.0.5.zip"
                target="_blank" rel="noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: "5px",
                  padding: "7px 14px", borderRadius: "0", fontSize: "11px", fontWeight: 700,
                  background: "transparent", border: "1px solid rgba(255,71,0,0.5)",
                  color: "#FF4700", textDecoration: "none", letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >⬇ Install EVE Vault v0.0.5</a>
            </div>
          ) : (
            <button className="accent-button" style={{ padding: "7px 18px", fontSize: "12px" }}
              onClick={() => (isConnected ? handleDisconnect() : handleConnect())}>
              {isConnected ? "Disconnect" : "Connect EVE Vault"}
            </button>
          )}
        </div>

        {/* Centered hero title */}
        <div style={{ maxWidth: "600px" }}>
          <p style={{
            fontSize: "10px", letterSpacing: "0.22em", textTransform: "uppercase",
            color: "rgba(107,107,94,0.8)", marginBottom: "14px", fontFamily: "inherit",
            fontWeight: 400,
          }}>
            EVE FRONTIER &nbsp;·&nbsp; SUI TESTNET &nbsp;·&nbsp; HACKATHON 2026
          </p>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"16px", margin:"0 0 10px" }}>
            <img src="cradleos-logo.png" alt="CradleOS"
              style={{ height:"clamp(40px,4.5vw,58px)", width:"auto", imageRendering:"auto", filter:"drop-shadow(0 0 12px rgba(255,71,0,0.5))" }} />
            <h1 style={{
              fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, letterSpacing: "0.06em",
              color: "#FF4700", margin: 0,
            }}>
              C<span style={{ textTransform: "lowercase", letterSpacing: "0.04em" }}>radle</span>OS
            </h1>
          </div>
          <p style={{
            fontSize: "11px", letterSpacing: "0.16em", textTransform: "uppercase",
            color: "rgba(107,107,94,0.7)", fontFamily: "inherit", margin: 0, fontWeight: 400,
          }}>
            Tribe Infrastructure &nbsp;·&nbsp; Tribe Treasury &nbsp;·&nbsp; DEX &nbsp;·&nbsp; Jump Nav
          </p>
        </div>
      </header>

      {/* Collapsible context brief */}
      <div style={{
        marginBottom: "12px",
        border: "1px solid rgba(255,71,0,0.15)",
        borderRadius: "2px",
        overflow: "hidden",
        background: "#101010",
      }}>
        <button
          onClick={() => setBriefOpen(o => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "9px 14px", background: "none", border: "none", cursor: "pointer",
            color: briefOpen ? "#FF4700" : "rgba(107,107,94,0.5)",
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
          <div style={{ padding: "4px 14px 12px 28px", borderTop: "1px solid rgba(255,71,0,0.08)" }}>
            <ol style={{ margin: 0, paddingLeft: "16px", display: "flex", flexDirection: "column", gap: "5px" }}>
              {brief.steps.map((s, i) => (
                <li key={i} style={{ color: "rgba(107,107,94,0.6)", fontSize: "12px", lineHeight: 1.5 }}>{s}</li>
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

      {/* Main nav tabs — CCP design system: sharp, uppercase, red active indicator */}
      <div style={{
        display: "flex", gap: "0", marginBottom: "20px",
        borderBottom: "1px solid rgba(255,71,0,0.2)",
        background: "#0F0F0F",
      }}>
        {(["structures", "tribe", "defense", "registry", "map"] as Tab[]).map(tab => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              style={{
                padding: "12px 22px 13px",
                border: "none",
                borderBottom: active ? "2px solid #FF4700" : "2px solid transparent",
                borderRight: "1px solid rgba(255,71,0,0.1)",
                background: active ? "#1a1a1a" : "transparent",
                color: active ? "#FF4700" : "rgba(107,107,94,0.6)",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                transition: "color 0.1s, background 0.1s, border-color 0.1s",
                marginBottom: "-1px",
                fontFamily: "inherit",
              }}
              onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,71,0,0.8)"; (e.currentTarget as HTMLButtonElement).style.background = "#151515"; } }}
              onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLButtonElement).style.color = "rgba(107,107,94,0.6)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; } }}
            >
              {tab === "structures" ? "Structures"
                : tab === "tribe"   ? "Tribe Coin"
                : tab === "defense" ? "Defense"
                : tab === "registry"? "Registry"
                :                     "Starmap"}
            </button>
          );
        })}
      </div>

      {activeTab === "map" ? (
        <div style={{ height: "75vh", minHeight: "480px", border: "1px solid rgba(255,71,0,0.12)", borderRadius: "0", overflow: "hidden" }}>
          <MapPanel />
        </div>
      ) : (
        <div style={{ background: "var(--ccp-bg)", padding: "0" }}>
          {activeTab === "structures" && <div style={{ background: "var(--ccp-bg)" }}><StructurePanel    onTxSuccess={setLastDigest} /></div>}
          {activeTab === "tribe"      && <div style={{ background: "var(--ccp-bg)" }}><TribeVaultPanel   onTxSuccess={setLastDigest} /></div>}
          {activeTab === "defense"    && <div style={{ background: "var(--ccp-bg)" }}><TurretPolicyPanel /></div>}
          {activeTab === "registry"   && <div style={{ background: "var(--ccp-bg)" }}><RegistryPanel /></div>}
        </div>
      )}
    </main>
  );
}

export default App;
