import { useEffect, useRef, useState } from "react";
import { postJson } from "../api";
import { visible } from "../safeText";
import { ClaimTag, Checks, ConsoleConfig, Hops, Token } from "./Bits";
import Json from "./Json";

const form = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n");

function Result({ kind, r }) {
  const verdict = r.accepted ? "ACCEPTED" : "REJECTED";
  return (
    <div className="flow" data-testid={`${kind}-result`}>
      <p className="muted" data-testid="token-label">{r.label}</p>
      <div className="verdict" data-decision={r.accepted ? "allow" : "deny"} role="status">
        <div className="verdict__word" data-testid="flow-verdict">{verdict}</div>
        <div>{kind === "obo" ? "The MCP server's own verification" : "The partner issuer's redemption and the partner API's verification"}</div>
      </div>
      <p className="lesson" data-testid="flow-lesson">{r.lesson}</p>
      <Token title="1. The caller's token (what the agent presents to the gateway)" tok={r.original} label="MOCK-ISSUED teaching token, shown raw" testId="tok-original" />
      {kind === "obo" ? (
        <>
          {r.gatewayChecks && <Checks checks={r.gatewayChecks.checks} caption="The gateway verifies the caller's token first" testId="checks-gateway" />}
          <h3>2. RFC 8693 exchange request (the gateway to the issuer)</h3>
          <Json value={form(r.exchangeRequest)} label="exchange request" testId="exchange-request" />
          <Token title="3. The exchanged token (minted for the MCP server)" tok={r.exchanged} label="aud is the MCP server; the act claim names the original caller" testId="tok-exchanged" />
          <Checks checks={r.backend.checks} caption="4. The MCP server verifies it for itself" testId="checks-backend" />
          <p className="muted" data-testid="lab-rules-note">The deck says only that the backend validates a token issued to it and that act preserves the original caller. Which checks run (signature, issuer, audience, expiry, act) and the 300 second lifetime are this lab&apos;s rules.</p>
          <p className="attrib" data-testid="attribution"><b>What the backend can attribute:</b> {visible(r.attribution.text)}</p>
        </>
      ) : (
        <>
          <h3>2. RFC 8693 exchange request, asking for an identity assertion grant</h3>
          <Json value={form(r.exchangeRequest)} label="exchange request" testId="exchange-request" />
          <Token title="3. The identity assertion grant (ID-JAG) from the user's IdP" tok={r.grant} label="aud is the partner app's own issuer" testId="tok-grant" />
          <h3>4. Redeemed at the partner app&apos;s own issuer (jwt-bearer)</h3>
          <Json value={form(r.redeemRequest)} label="redeem request" testId="redeem-request" />
          <Checks checks={r.redeem.checks} caption="The partner issuer verifies the grant" testId="checks-redeem" />
          <p className="muted" data-testid="lab-rules-note">These checks (signature, issuer, audience, expiry, replay) are this lab&apos;s rules for a redeeming issuer, not the deck&apos;s list.</p>
          {r.redeemAgain && <Checks checks={r.redeemAgain.checks} caption="The same grant, redeemed a second time" testId="checks-redeem-again" />}
          {r.access && <Token title="5. The partner issuer's own access token" tok={r.access} label="signed by the partner issuer's key, not the user IdP's" testId="tok-access" />}
          {r.api && <Checks checks={r.api.checks} caption="The partner API verifies its own issuer's token" testId="checks-api" />}
          <section className="panel proof" data-testid="proof">
            <h3>What this lab&apos;s mock does about credentials and consent</h3>
            <p data-testid="deck-claim">{r.proof.deckClaim}</p>
            <p>These two figures describe the <b>mock</b>, not the product, and are not proof of the claim. Consent steps the lab models: <b data-testid="consent-count">{r.proof.consentStepsModelled}</b> (it has no consent step at all). Client credentials the lab models: <b data-testid="secret-count">{r.proof.clientCredentialsModelled}</b> (it omits client authentication on the redeem leg).</p>
            <ul className="plain">{r.proof.holds.map((h) => <li key={h.party}><b>{h.party}</b> holds {h.holds}.</li>)}</ul>
            <p className="muted">{r.proof.notShown}</p>
          </section>
        </>
      )}
      {r.jwks && <details><summary>Public key set(s) the verifier used (JWKS, public keys only)</summary><Json value={r.jwks} label="jwks" /></details>}
      <ConsoleConfig title="OBO config (the exchange and its Redeem leg)" value={r.config} source="Field names from the console swagger, 2026-10-31 (schema only; behaviour not tested on our tenant). Resource (RFC 8707) is the exchanged token's aud. Redeem is the ID-JAG second leg. AuthMethod is shown for shape only: the lab runs no client authentication on either leg, so it is NOT EXERCISED. ClientSecret and PrivateKeyPEM exist in the schema and are write-only; the lab holds none." />
      <Hops hops={r.hops} traceId={r.traceId} />
    </div>
  );
}

export default function FlowTab({ kind, story, mode, resetSignal }) {
  const list = kind === "obo" ? story.obo : story.idjag;
  const [id, setId] = useState(list[0].id);
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    setRes(null);
    postJson(`/api/${kind === "obo" ? "obo" : "idjag"}`, { mode, scenario: id, vertical: story.vertical }).then(({ ok, body }) => {
      if (mine !== seq.current) return;
      if (ok) { setRes(body); setError(null); } else setError(body.error || "request failed");
    }, () => { if (mine === seq.current) setError("request failed"); });
  }, [kind, mode, id, story.vertical, resetSignal]);
  const claim = story.claims.find((c) => c.id === (kind === "obo" ? "obo" : "id-jag"));
  return (
    <div className="flow-tab">
      <div className="panel">
        <h2>{kind === "obo" ? "On-behalf-of: a token minted for the MCP server" : "ID-JAG: the user's identity at an app whose IdP you do not control"} <ClaimTag label={story.claimLabel} /></h2>
        <p className="intro">{claim.claim}</p>
        <p className="muted" data-testid="flow-mode-note">{mode === "live" ? "Live: real RS256 signing with a key generated in this process, real verification, an in-process issuer and server. Nothing leaves this machine." : "Mock: tokens carry a placeholder signature and every check result comes from a table. Switch to Live for real signing and verification."}</p>
        {kind === "idjag" && <p className="muted">For the standalone ID-JAG walkthrough see the sibling lab <code>id-jag-standalone-LAB</code>. This lab does not import from it.</p>}
        <div className="seg" role="group" aria-label="Cases">
          {list.map((s) => <button key={s.id} type="button" aria-pressed={id === s.id} onClick={() => setId(s.id)} data-testid={`case-${s.id}`}>{s.title}</button>)}
        </div>
      </div>
      {error && <p className="app-error" role="alert">Could not run ({error}).</p>}
      {res ? <Result kind={kind} r={res} /> : !error && <p className="muted">Loading...</p>}
    </div>
  );
}
