# Intent Purpose Behaviour LAB

A simulation of the "Intent, Purpose and Behaviour" release claims, plus the two token flows marked new in the same release: three signals asked of every call, on-behalf-of, and ID-JAG.

Tier: Demo
Repo: https://github.com/ping-sandbox/intent-purpose-behaviour-LAB
Catalog: D101

Source: the Ping ID4AI Workforce H2 2026 deck, slide 48 (release 2026-11-02). **Every product claim is a Ping release claim, UNVERIFIED on our tenant.** Nothing here calls a real gateway, identity provider or tenant, and nothing leaves your machine.

## What is simulated

**Mock mode (default).** Everything runs offline in one process, from tables. The decision for each scripted call comes from a table generated from the lab's own engine (`server/src/mockTable.json`; a doctor check and a test fail if it drifts). Tokens in the on-behalf-of and ID-JAG tabs carry a placeholder signature, and every check result comes from a table. The "gateway", the policy and the scoring are the lab's own rules.

**Live mode (owner-run, still local).** The local real engine: real RS256 signing with an RSA key generated in this process (never written anywhere), real verification, real baseline learning over the calls you fire, and your own calls judged by the real classifier. The "issuer", the "MCP server" and the "partner app" are function calls inside the process. Live never leaves loopback and never touches a tenant. The banner says which mode you are in.

What it shows:

1. **Three signals.** Intent (what is the call trying to do), purpose (was this agent key ever issued for it) and behaviour (does this agent normally do this) are asked of every call, deliberately not one score. Only the deterministic tier (pattern matches, purpose findings) can refuse; the scored signals (similarity, anomaly) alert or ask a person, and the editable policy rejects any attempt to make a score deny. Eight calls across three vertical packs (finance, health, retail).
2. **Baseline.** An agent builds its normal. Enforcement is OFF until the baseline is established ("a new agent is never blocked for being new"), then an out-of-pattern call asks a person or raises an alert, never a silent block.
3. **On-behalf-of.** A local RFC 8693 token exchange: the caller's token is swapped for one minted for the MCP server (`aud`, an `act` claim) and the backend validates it. The deck says the backend validates a token issued to it and that `act` preserves the original caller; the specific checks the lab's backend runs (signature, issuer, audience, expiry, `act`) and the 300 second lifetime are the lab's own rules. Failure cases included.
4. **ID-JAG.** Two issuers: the user's IdP issues an identity assertion grant, the gateway redeems it at the partner app's own issuer. The deck claims no shared credential and no re-consent; the lab models neither a consent step nor client authentication on the redeem leg, so it cannot demonstrate that claim, and its panel says what the mock does rather than proving it. (The standalone walkthrough is the sibling `id-jag-standalone-LAB`; this lab does not import from it.)
5. **Diagram.** ReactFlow, drawn from diagram-studio/1 data loaded by name: movable boxes, Simulate, speed, Reset (restores box positions).
6. **Talk track.** Also in `docs/talk-track.md`.

Field names for intents (`AIIntent`), purpose (`PurposeProfile`), behaviour (`BehaviourConfig`) and on-behalf-of (`OBO`, with `Redeem` as the ID-JAG second leg) come from the Privilege console swagger of 2026-10-31. That is schema only: it proves the names exist, not how the product behaves. Everything else (the pattern syntax, the similarity stand-in, the scoring points, the reason codes, the alert and ask thresholds, the refusal switches) is lab-invented and tagged "lab-invented" in the policy editor.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only if you use the Docker form. Mock mode works with no setup at all: no tenant, no credentials, no settings file.

```
git clone https://github.com/ping-sandbox/intent-purpose-behaviour-LAB.git
cd intent-purpose-behaviour-LAB
npm ci
npm run build
npm start
```

Open http://localhost:7100/. Or in one step: `./scripts/run.sh` (installs and builds if needed, runs the doctor, starts).

## Settings file

All standalone apps read one settings file, `~/Development/.env`, which must be mode 600. `STANDALONE_ENV` overrides its path. This lab needs none of it. It reads one optional key:

- `IPB_LAB_MODE` (optional): `mock` (default) or `live`, the mode the page opens in. The header toggle switches per visit. A bare `MODE` in the shared file is ignored, because it may belong to another app.

The shared file holds no `PORT`: the lab keeps its port default in code. Admin or worker credentials never belong in that file (they live in `~/.config/demo-kit/provisioning.json`), and this lab uses none. The doctor reports whether the file exists and its mode, and never prints a value.

## Ports, and what to do if the port is taken

```
Ports: intent-purpose-behaviour-LAB listens on 7100 (set with PORT, default 7100).
Port range for this app: 7100-7149.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:7100 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
```

Other variables: `VITE_PORT` (Vite dev server, default 7101, `npm run dev -w web`), `HOST_PORT` (Docker host port, default 7100). Keep all of them inside 7100-7149.

## Mock and live modes

The header has a **Mock / Live** toggle on every page, and the banner and the mode chip show the same mode. Mock reads the tables. Live runs the real engine: real signing and verification, a real baseline learner of your own, and a form for your own call. Both modes are loopback-only with zero outbound calls (a test asserts it).

### What you type is masked, and what the server refuses

Everything you type (a description, an argument value) is cleaned before it is used, shown or kept: invisible characters and every C0/C1 control character are deleted (not turned into spaces, so a keyword cannot hide behind them), the text is NFKC-normalised, percent-encoding is undone up to three layers, and credential-shaped text becomes `[masked]`. The answer is masked again on the way out (strings and object keys of the evaluate and baseline answers). The hop panes show the masked call. It recognises: `password`, `pw`, `token`, `secret`, `api key` and similar followed by `:`/`=`/`is`, or by a plain space and a value of 6 or more characters with a digit; JSON-quoted assignments (`{"password":"..."}`); `Authorization:` lines; `Bearer ...`; URL userinfo with or without a scheme (`user:pw@host`, `//user:pw@host`); JWTs, `sk-`/`ghp_`/`AKIA` style keys, PEM blocks; and long opaque runs. **This is a heuristic, not a guarantee. Do not type a real credential.**

- **What it still misses:** a bare word with no keyword before it and no credential shape ("swordfish", "password hunter" with no digit, a value under 6 characters after a plain space); look-alike letters from another alphabet (a Cyrillic `a` or Greek `o` inside "password" is not folded to Latin by NFKC); a keyword split by an ordinary space or a letter (`pass word=x`); encoding layered more than three deep; the weak words `key` and `pass` when nothing follows them.
- **False-positive tradeoff:** a keyword + space + value is masked only when the value is 6 or more characters and contains a digit, so "password reset", "token bucket", "secret garden" and "the password is required" stay readable while "password hunter2xyz" is masked. The price is that it over-masks (`token: refresh` is masked because a colon after a keyword introduces a value; `token 300000` is masked) and under-masks digit-less words.
- **Refused, never echoed, never cut:** a tool name or an argument name that looks like a credential is refused with 400 (`bad_tool`, `bad_args`); a description over 200 characters, an argument value over 64, a tool over 64, more than 8 arguments or a workspace id over 40 is refused whole (400), never silently cut. Lengths count what you typed, before masking. Error texts are fixed and never repeat what was typed (not even a slice of a key name): an unknown policy section is just "unknown policy section".
- **Workspace ids:** an `X-Workspace` that looks like a credential (24 or more hex digits, with or without dashes; a prefix such as `sk-`, `pw-`, `token-`, `key-`; anything the masker recognises) gets `400 bad_workspace` and is never echoed. The page makes `w-` plus 16 hex digits (always a letter), and if the server refuses a stored id it throws it away, makes a new one and retries once, so a bad stored id cannot brick the tab.
- **Status codes:** a missing file (`/favicon.ico`, `/robots.txt`, `/x.map`, `/x.svg`, `/assets/missing.js`, any dotfile) is a JSON 404, never a 200 page; the app shell is served only for paths with no dot in them; a wrong method on a known route is `405` with `Allow`; any other unknown path (including POST) is a JSON 404, so Express's HTML "Cannot POST /path" page, which echoes the path, never appears.
- **The browser console** shows the deliberate 4xx answers above (a refused tool name, an over-long value, a 404 for a missing file) as ordinary network messages.

## Health, doctor and reset

```
npm run doctor   # 16 checks; PORT=7109 npm run doctor to use a spare port
npm run reset    # clears the default workspace's runs and live baseline (the UI Reset also restores the policy and the diagram)
```

`GET /api/health` returns `demo-health/1`. The workspace id comes in `X-Workspace`; every hop carries a W3C `traceparent`. Presenter mode: press `P` (Esc leaves); the simulation banner stays. `npm run mock-table`, `npm run talk-track` and `npm run content-pack` regenerate the generated files. The shared standalone drift and CSS checks (`check-drift.sh`, `check-css.sh`) are run by hand before a release; CI does not run them. See `docs/safety.md`.

## Docker (optional)

```
HOST_PORT=7100 docker compose up --build -d
```

The container publishes to 127.0.0.1 only (a test pins it). Use OrbStack, not Docker Desktop. `IPB_LAB_MODE=live` opens the page in Live mode.

## Tests

```
npm test    # server (node --test), web (vitest, drives the UI against the real server), scripts
```

On Node 26: 127 tests pass (91 server, 19 web, 17 script tests).

## Troubleshooting

- **The page says "Could not load the lab".** The server is not running, or it is on another port. Start it (`npm start`) and check `PORT`.
- **Port is taken.** See "Ports, and what to do if the port is taken" above.
- **`npm start` refuses to start.** Run `npm run doctor`; the first failing line says why (Node older than 26, a port outside 7100-7149).
- **Your own call is refused (400).** The tool name or an argument name looks like a credential, or a value is over its limit (description 200, argument value 64, tool name 64 characters, 8 arguments). Use a plain name such as `invoices.lookup`.
- **Your own call says it needs Live.** Switch the header toggle to Live: Mock only has tables for the scripted calls.
- **The mock table is out of date after an engine change.** Run `npm run mock-table`; the doctor and a test tell you when it drifts.

## Ownership

- Owner: the Ping demo family owner (Demo tier).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

## Not done

No SE k8s build (deferred by the owner, 2026-10-31). No catalog id yet. Every product claim stays UNVERIFIED until it is measured on a tenant that has the release.
