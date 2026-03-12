/**
 * RegistryPanel — CharacterRegistry management UI
 *
 * Founder flow:
 *   1. Register Claim — stake tribe_id claim at current epoch
 *   2. Create Vault — gated by active claim
 *
 * Attestor (admin) flow:
 *   • Issue EpochAttestation to a wallet (off-chain proof of earlier join)
 *   • Invalidate a stale claim (character left tribe / fraud)
 *   • Update attestor address
 *
 * Challenge flow (any wallet with an attestation):
 *   • Show owned attestations
 *   • Challenge + take vault atomically
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import {
  fetchCharacterTribeId, fetchTribeClaim, fetchAttestationsForWallet,
  buildRegisterClaimTransaction, buildIssueAttestationTransaction,
  buildInvalidateClaimTransaction, buildChallengeAndTakeVaultTransaction,
  buildSetAttestorTransaction, findCharacterForWallet,
  CHARACTER_REGISTRY_ID, rpcGetObject,
  type TribeClaim,
} from "../lib";
import { CRADLEOS_PKG as _CRADLEOS_PKG } from "../constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(a: string) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—"; }

async function fetchRegistryMeta(): Promise<{ attestor: string; admin: string }> {
  try {
    const f = await rpcGetObject(CHARACTER_REGISTRY_ID);
    return { attestor: String(f["trusted_attestor"] ?? ""), admin: String(f["admin"] ?? "") };
  } catch { return { attestor: "", admin: "" }; }
}

// ── Main component ────────────────────────────────────────────────────────────

export function RegistryPanel() {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [issueWallet, setIssueWallet] = useState("");
  const [issueTribeId, setIssueTribeId] = useState("");
  const [issueCharId, setIssueCharId] = useState("");
  const [issueEpoch, setIssueEpoch] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueErr, setIssueErr] = useState<string | null>(null);
  const [invalidateTribeId, setInvalidateTribeId] = useState("");
  const [invalidateBusy, setInvalidateBusy] = useState(false);
  const [invalidateErr, setInvalidateErr] = useState<string | null>(null);
  const [newAttestor, setNewAttestor] = useState("");
  const [attestorBusy, setAttestorBusy] = useState(false);
  const [attestorErr, setAttestorErr] = useState<string | null>(null);
  const [challengeVaultId, setChallengeVaultId] = useState("");
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [challengeErr, setChallengeErr] = useState<string | null>(null);

  const invalidate = () => setTimeout(() => {
    queryClient.invalidateQueries({ queryKey: ["registryMeta"] });
    queryClient.invalidateQueries({ queryKey: ["tribeClaim"] });
    queryClient.invalidateQueries({ queryKey: ["attestations"] });
  }, 2500);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: tribeId } = useQuery<number | null>({
    queryKey: ["characterTribeId", account?.address],
    queryFn: () => account ? fetchCharacterTribeId(account.address) : Promise.resolve(null),
    enabled: !!account?.address,
  });

  const { data: characterId } = useQuery<string | null>({
    queryKey: ["characterId", account?.address],
    queryFn: async () => {
      if (!account) return null;
      const info = await findCharacterForWallet(account.address);
      return info?.characterId ?? null;
    },
    enabled: !!account?.address,
  });

  const { data: claim } = useQuery<TribeClaim | null>({
    queryKey: ["tribeClaim", tribeId],
    queryFn: () => tribeId != null ? fetchTribeClaim(tribeId) : Promise.resolve(null),
    enabled: tribeId != null,
    staleTime: 15_000,
  });

  const { data: registryMeta } = useQuery({
    queryKey: ["registryMeta"],
    queryFn: fetchRegistryMeta,
    staleTime: 60_000,
  });

  const { data: attestations } = useQuery({
    queryKey: ["attestations", account?.address],
    queryFn: () => account ? fetchAttestationsForWallet(account.address) : Promise.resolve([]),
    enabled: !!account?.address,
    staleTime: 30_000,
  });

  if (!account) return (
    <div className="card" style={{ textAlign: "center", padding: "32px", color: "#888" }}>
      Connect EVE Vault to view registry
    </div>
  );

  const isAttestor = registryMeta?.attestor.toLowerCase() === account.address.toLowerCase();
  const isAdmin = registryMeta?.admin.toLowerCase() === account.address.toLowerCase();
  const myClaimActive = claim?.claimer.toLowerCase() === account.address.toLowerCase();
  const claimExists = !!claim;
  const claimConflict = claimExists && !myClaimActive;

  const handleRegisterClaim = async () => {
    if (!tribeId || !characterId) return;
    setClaimBusy(true); setClaimErr(null);
    try {
      const tx = buildRegisterClaimTransaction(tribeId, characterId);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      invalidate();
    } catch (e) { setClaimErr(e instanceof Error ? e.message : String(e)); }
    finally { setClaimBusy(false); }
  };

  const handleIssueAttestation = async () => {
    const tid = parseInt(issueTribeId, 10);
    const epoch = parseInt(issueEpoch, 10);
    if (!issueWallet || !issueCharId || !tid || isNaN(epoch)) return;
    setIssueBusy(true); setIssueErr(null);
    try {
      const tx = buildIssueAttestationTransaction(issueWallet, tid, issueCharId, epoch);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      setIssueWallet(""); setIssueTribeId(""); setIssueCharId(""); setIssueEpoch("");
      invalidate();
    } catch (e) { setIssueErr(e instanceof Error ? e.message : String(e)); }
    finally { setIssueBusy(false); }
  };

  const handleInvalidate = async () => {
    const tid = parseInt(invalidateTribeId, 10);
    if (!tid) return;
    setInvalidateBusy(true); setInvalidateErr(null);
    try {
      const tx = buildInvalidateClaimTransaction(tid);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      setInvalidateTribeId("");
      invalidate();
    } catch (e) { setInvalidateErr(e instanceof Error ? e.message : String(e)); }
    finally { setInvalidateBusy(false); }
  };

  const handleSetAttestor = async () => {
    if (!newAttestor) return;
    setAttestorBusy(true); setAttestorErr(null);
    try {
      const tx = buildSetAttestorTransaction(newAttestor);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      setNewAttestor("");
      invalidate();
    } catch (e) { setAttestorErr(e instanceof Error ? e.message : String(e)); }
    finally { setAttestorBusy(false); }
  };

  const handleChallenge = async (attestationId: string) => {
    if (!challengeVaultId) { setChallengeErr("Enter vault ID to challenge"); return; }
    setChallengeBusy(true); setChallengeErr(null);
    try {
      const tx = buildChallengeAndTakeVaultTransaction(challengeVaultId, attestationId);
      const signer = new CurrentAccountSigner(dAppKit);
      await signer.signAndExecuteTransaction({ transaction: tx });
      invalidate();
    } catch (e) { setChallengeErr(e instanceof Error ? e.message : String(e)); }
    finally { setChallengeBusy(false); }
  };

  const inputStyle = {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "4px", color: "#ddd", fontSize: "11px", padding: "5px 8px",
    outline: "none", fontFamily: "monospace",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ── Registry status ── */}
      <div className="card">
        <div style={{ color: "#ffa032", fontWeight: 700, fontSize: "16px", marginBottom: "14px" }}>
          📋 Character Registry
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ color: "#555", width: "100px" }}>Registry</span>
            <span style={{ fontFamily: "monospace", color: "#888" }}>{shortAddr(CHARACTER_REGISTRY_ID)}</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ color: "#555", width: "100px" }}>Attestor</span>
            <span style={{ fontFamily: "monospace", color: isAttestor ? "#00ff96" : "#888" }}>
              {shortAddr(registryMeta?.attestor ?? "")}
              {isAttestor && <span style={{ color: "#00ff96", marginLeft: "6px" }}>← you</span>}
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <span style={{ color: "#555", width: "100px" }}>Admin</span>
            <span style={{ fontFamily: "monospace", color: isAdmin ? "#ffa032" : "#888" }}>
              {shortAddr(registryMeta?.admin ?? "")}
              {isAdmin && <span style={{ color: "#ffa032", marginLeft: "6px" }}>← you</span>}
            </span>
          </div>
        </div>
      </div>

      {/* ── Your claim ── */}
      <div className="card">
        <div style={{ color: "#aaa", fontWeight: 600, fontSize: "13px", marginBottom: "12px" }}>
          Your Tribe Claim
        </div>
        <div style={{ fontSize: "12px", marginBottom: "12px" }}>
          <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#555", width: "100px" }}>Tribe ID</span>
            <span style={{ color: "#ffa032" }}>{tribeId ?? "—"}</span>
          </div>
          <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
            <span style={{ color: "#555", width: "100px" }}>Character</span>
            <span style={{ fontFamily: "monospace", color: "#888" }}>{shortAddr(characterId ?? "")}</span>
          </div>
          {claimExists && (
            <>
              <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                <span style={{ color: "#555", width: "100px" }}>Claimer</span>
                <span style={{ fontFamily: "monospace", color: myClaimActive ? "#00ff96" : "#ff6432" }}>
                  {shortAddr(claim!.claimer)}
                  {myClaimActive ? " ✓ you" : " ⚠ squatter"}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                <span style={{ color: "#555", width: "100px" }}>Claim epoch</span>
                <span style={{ color: "#666" }}>{claim!.claimEpoch}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{ color: "#555", width: "100px" }}>Vault created</span>
                <span style={{ color: claim!.vaultCreated ? "#00ff96" : "#555" }}>
                  {claim!.vaultCreated ? "✓ yes" : "no"}
                </span>
              </div>
            </>
          )}
        </div>

        {!claimExists && tribeId != null && characterId && (
          <>
            <button className="accent-button" onClick={handleRegisterClaim} disabled={claimBusy}
              style={{ fontSize: "12px", padding: "7px 18px" }}>
              {claimBusy ? "Registering…" : `Register Claim for Tribe #${tribeId}`}
            </button>
            {claimErr && <div style={{ color: "#ff6432", fontSize: "11px", marginTop: "6px" }}>⚠ {claimErr}</div>}
          </>
        )}
        {myClaimActive && !claim!.vaultCreated && (
          <div style={{ color: "#00ff96", fontSize: "12px" }}>
            ✓ Claim active — go to Tribe Coin tab to create your vault.
          </div>
        )}
        {myClaimActive && claim!.vaultCreated && (
          <div style={{ color: "#555", fontSize: "12px" }}>Vault already created for this claim.</div>
        )}
        {claimConflict && (
          <div style={{
            padding: "10px 12px", background: "rgba(255,100,50,0.08)",
            border: "1px solid rgba(255,100,50,0.25)", borderRadius: "6px", fontSize: "12px",
          }}>
            <div style={{ color: "#ff6432", fontWeight: 600, marginBottom: "4px" }}>
              ⚠ Tribe #{tribeId} already claimed by another wallet
            </div>
            <div style={{ color: "#666" }}>
              If you joined this tribe before them, request an attestation from the CradleOS
              attestor, then use the Challenge section below to take back the vault.
            </div>
          </div>
        )}
      </div>

      {/* ── Attestations / Challenge ── */}
      {(attestations ?? []).length > 0 && (
        <div className="card">
          <div style={{ color: "#aaa", fontWeight: 600, fontSize: "13px", marginBottom: "12px" }}>
            ⚔ Your Attestations (Challenge Proofs)
          </div>
          <div style={{ marginBottom: "10px", display: "flex", gap: "6px", alignItems: "center" }}>
            <input
              value={challengeVaultId}
              onChange={e => setChallengeVaultId(e.target.value.trim())}
              placeholder="Vault ID to challenge (0x…)"
              style={{ ...inputStyle, width: "280px" }}
            />
          </div>
          {(attestations ?? []).map(att => (
            <div key={att.objectId} style={{
              display: "flex", alignItems: "center", gap: "10px", fontSize: "11px",
              padding: "8px 10px", marginBottom: "6px",
              background: "rgba(255,160,50,0.05)", border: "1px solid rgba(255,160,50,0.15)",
              borderRadius: "6px",
            }}>
              <span style={{ color: "#ffa032", fontWeight: 600 }}>Tribe #{att.tribeId}</span>
              <span style={{ color: "#555" }}>join epoch {att.joinEpoch}</span>
              <span style={{ fontFamily: "monospace", color: "#555" }}>char {shortAddr(att.characterId)}</span>
              <button
                onClick={() => handleChallenge(att.objectId)}
                disabled={challengeBusy || !challengeVaultId}
                style={{
                  marginLeft: "auto",
                  background: "rgba(255,100,50,0.1)", border: "1px solid rgba(255,100,50,0.3)",
                  color: "#ff6432", borderRadius: "4px", fontSize: "11px", padding: "4px 12px", cursor: "pointer",
                }}
              >
                {challengeBusy ? "…" : "Challenge + Take Vault"}
              </button>
            </div>
          ))}
          {challengeErr && <div style={{ color: "#ff6432", fontSize: "11px", marginTop: "4px" }}>⚠ {challengeErr}</div>}
        </div>
      )}

      {/* ── Attestor admin panel ── */}
      {isAttestor && (
        <div className="card" style={{ border: "1px solid rgba(0,255,150,0.15)" }}>
          <div style={{ color: "#00ff96", fontWeight: 600, fontSize: "13px", marginBottom: "16px" }}>
            🔑 Attestor Panel
          </div>

          {/* Issue attestation */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ color: "#666", fontSize: "11px", marginBottom: "8px", letterSpacing: "0.05em" }}>
              ISSUE EPOCH ATTESTATION
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: "#444", fontSize: "10px" }}>BENEFICIARY WALLET</span>
                <input value={issueWallet} onChange={e => setIssueWallet(e.target.value.trim())}
                  placeholder="0x…" style={{ ...inputStyle, width: "180px" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: "#444", fontSize: "10px" }}>TRIBE ID</span>
                <input value={issueTribeId} onChange={e => setIssueTribeId(e.target.value.replace(/\D/g, ""))}
                  placeholder="98000001" style={{ ...inputStyle, width: "100px" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: "#444", fontSize: "10px" }}>CHARACTER ID</span>
                <input value={issueCharId} onChange={e => setIssueCharId(e.target.value.trim())}
                  placeholder="0x…" style={{ ...inputStyle, width: "160px" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: "#444", fontSize: "10px" }}>JOIN EPOCH</span>
                <input value={issueEpoch} onChange={e => setIssueEpoch(e.target.value.replace(/\D/g, ""))}
                  placeholder="epoch #" style={{ ...inputStyle, width: "80px" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", justifyContent: "flex-end" }}>
                <span style={{ color: "#444", fontSize: "10px" }}>&nbsp;</span>
                <button onClick={handleIssueAttestation} disabled={issueBusy || !issueWallet || !issueTribeId || !issueCharId || !issueEpoch}
                  style={{
                    background: "rgba(0,255,150,0.08)", border: "1px solid #00ff9640",
                    color: "#00ff96", borderRadius: "4px", fontSize: "11px", padding: "5px 14px", cursor: "pointer",
                  }}>
                  {issueBusy ? "…" : "Issue"}
                </button>
              </div>
            </div>
            {issueErr && <div style={{ color: "#ff6432", fontSize: "11px" }}>⚠ {issueErr}</div>}
          </div>

          {/* Invalidate claim */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ color: "#666", fontSize: "11px", marginBottom: "8px", letterSpacing: "0.05em" }}>
              INVALIDATE STALE CLAIM
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ color: "#444", fontSize: "10px" }}>TRIBE ID</span>
                <input value={invalidateTribeId} onChange={e => setInvalidateTribeId(e.target.value.replace(/\D/g, ""))}
                  placeholder="tribe_id" style={{ ...inputStyle, width: "120px" }} />
              </div>
              <button onClick={handleInvalidate} disabled={invalidateBusy || !invalidateTribeId}
                style={{
                  background: "rgba(255,100,50,0.08)", border: "1px solid rgba(255,100,50,0.3)",
                  color: "#ff6432", borderRadius: "4px", fontSize: "11px", padding: "5px 14px", cursor: "pointer",
                }}>
                {invalidateBusy ? "…" : "Invalidate"}
              </button>
            </div>
            {invalidateErr && <div style={{ color: "#ff6432", fontSize: "11px", marginTop: "4px" }}>⚠ {invalidateErr}</div>}
          </div>
        </div>
      )}

      {/* ── Admin: set attestor ── */}
      {isAdmin && (
        <div className="card" style={{ border: "1px solid rgba(255,160,50,0.15)" }}>
          <div style={{ color: "#ffa032", fontWeight: 600, fontSize: "13px", marginBottom: "12px" }}>
            ⚙ Admin: Update Attestor
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <span style={{ color: "#444", fontSize: "10px" }}>NEW ATTESTOR WALLET</span>
              <input value={newAttestor} onChange={e => setNewAttestor(e.target.value.trim())}
                placeholder="0x…" style={{ ...inputStyle, width: "280px" }} />
            </div>
            <button onClick={handleSetAttestor} disabled={attestorBusy || !newAttestor}
              style={{
                background: "rgba(255,160,50,0.08)", border: "1px solid rgba(255,160,50,0.3)",
                color: "#ffa032", borderRadius: "4px", fontSize: "11px", padding: "5px 14px", cursor: "pointer",
              }}>
              {attestorBusy ? "…" : "Set Attestor"}
            </button>
          </div>
          {attestorErr && <div style={{ color: "#ff6432", fontSize: "11px", marginTop: "4px" }}>⚠ {attestorErr}</div>}
        </div>
      )}
    </div>
  );
}
