# intent-purpose-behaviour-LAB

**Tier: Demo.** A simulation of the "Intent, Purpose and Behaviour" release claims (Ping ID4AI Workforce H2 2026 deck, slide 48; release 2026-11-02), plus the two token flows marked new in the same release. **Every product claim is a Ping release claim, UNVERIFIED on our tenant.** Nothing here calls a real gateway, identity provider or tenant, and nothing leaves your machine.

## What it shows

1. **Three signals.** Intent (what is the call trying to do), purpose (was this agent key ever issued for it) and behaviour (does this agent normally do this) are asked of every call, and are deliberately not one score. Only the deterministic tier (pattern matches, purpose findings) can refuse; the scored signals (similarity, anomaly) alert or ask a person, and the editable policy rejects any attempt to make a score deny. Eight calls across three vertical packs (finance, health, retail).
2. **Baseline.** An agent builds its normal. Enforcement is OFF until the baseline is established ("a new agent is never blocked for being new"), then an out-of-pattern call asks a person or raises an alert, never a silent block.
3. **On-behalf-of.** A real local RFC 8693 token exchange: the caller's token is swapped for one minted for the MCP server (`aud`, an `act` claim) and the backend verifies signature, issuer, audience, expiry and `act`. Failure cases included.
4. **ID-JAG.** Two issuers: the user's IdP issues an identity assertion grant, the gateway redeems it at the partner app's own issuer. No shared credential, no consent prompt. (The standalone walkthrough is the sibling `id-jag-standalone-LAB`; this lab does not import from it.)
5. **Diagram.** ReactFlow, drawn from diagram-studio/1 data loaded by name; movable boxes, Simulate, speed, Reset restores positions.
6. **Talk track.** Also in `docs/talk-track.md`.

## Mock and Live

The header toggle switches mode, and shows it.

- **Mock**: pure in-process tables. Tokens carry a placeholder signature; check results come from a table.
- **Live**: the local real engine. Real RS256 signing with a key generated in this process, real verification, real baseline learning over the calls you fire, and your own calls judged by the real classifier. Still loopback-only with zero outbound calls (a test asserts it).

## Field names

Field names for intents (`AIIntent`: Description, Exemplars, Twins, Patterns, Acts, Floor), purpose (`PurposeProfile`: Statement, Methods, Targets, Apps, ArgPrefixes), behaviour (`BehaviourConfig`: Disabled, MinObservations, EnforceObservations) and on-behalf-of (`OBO`: TokenURL, ClientID, AuthMethod, Resource, Scope, SubjectTokenType, RequestedTokenType, Redeem) are from the Privilege console swagger of 2026-10-31. That is schema only: it proves the names exist, not how the product behaves. How the lab interprets them, the scoring points, the reason codes, the alert and ask thresholds and the pattern syntax are the lab's own and are tagged "lab-invented" in the policy editor.

## Run

Needs Node 26.

```
./scripts/run.sh                 # host: install, build, doctor, start -> http://localhost:7100/
HOST_PORT=7100 docker compose up --build -d   # OrbStack/Docker -> http://127.0.0.1:7100
```

Ports are 7100-7149. `MODE=live` opens the page in Live mode. Brand it with `customer.config.json` (see `customer.config.example.json`).

## Checks

```
npm test          # server (node --test), web (vitest, drives the UI against the real server), scripts
npm run build
npm run doctor    # PORT=7109 npm run doctor to use a spare port
npm run reset     # clears the default workspace (the UI Reset also restores the policy and the diagram)
npm run content-pack   # rebuild and validate the Learning Hub pack
npm run mock-table     # regenerate server/src/mockTable.json from the live engine (a test fails on drift)
```

`GET /api/health` returns `demo-health/1`. The workspace id comes in `X-Workspace`; every mock hop carries a W3C `traceparent`. See `docs/safety.md`.

Presenter mode: press `P` (Esc leaves). The simulation banner stays.

## Not done

No SE k8s build (deferred by the owner, 2026-10-31). No catalog id yet.

MIT licensed.
