# Talk track

<!-- Generated from server/src/data.js by `npm run talk-track`. Do not edit by hand. -->

> Ping release claim, UNVERIFIED on our tenant: every product claim here comes from the Ping ID4AI Workforce H2 2026 deck (release 2026-11-02).

## Say this first

Everything on this page is simulated, and every product claim is a Ping release claim, unverified on our tenant: the 2026-11-02 release is not there yet. The point is the shape of the idea: three questions asked of every call, kept separate on purpose, instead of one risk score.

## Three signals, not one score

Intent asks what the request is trying to do, whatever it literally says. Purpose asks whether this agent key was ever issued for it. Behaviour asks whether this agent normally does this. A single score would hide which of the three fired, and you could not write a policy that says "refuse this, but only ask a person about that".

## Hard refusals are deterministic

Only the deterministic tier can say no: a pattern match, or a purpose finding. The scored signals, the similarity score and the behaviour anomaly, alert or ask a person. Try to edit the policy so a score denies: the lab refuses it. A model's judgement never silently becomes the enforcement decision.

## Intent

Patterns catch the obvious: a bulk export, a tool that changes a payee. Similarity catches the reworded version that avoids those tool names. In the lab the similarity is a word-overlap stand-in, labelled invented; the product uses semantic similarity, which we have not measured.

## Purpose

The key says what it exists to do, for example invoice reconciliation. Policy can refuse calls outside that, calls that break one axis of it, such as how many records, or any call from a key that declares nothing. That turns a sentence in documentation into something enforceable.

## Behaviour

The gateway learns what normal looks like for each agent. A new agent has no baseline, so nothing is enforced: it is never blocked for being new. After MinObservations calls the lab starts scoring, after EnforceObservations it enforces. Once the baseline is established, an out-of-pattern call scores high and raises an alert or asks a person. It is never a silent block.

## On-behalf-of

The gateway swaps the caller's verified token for one minted for the downstream MCP server, using RFC 8693. The backend checks a token issued to it, not a shared service account, and the act claim says who the original caller was. In Live mode this is real signing and real verification on your machine; the tokens are mock-issued and shown raw.

## ID-JAG

When the target app trusts a different identity provider, the exchange returns an identity assertion grant and the gateway redeems it at that app's own issuer. The user's identity arrives at an app whose IdP you do not control, with no shared credential and no consent prompt. For the standalone ID-JAG walkthrough, see the sibling id-jag-standalone-LAB; this lab does not import from it.

## Why it matters

The challenge: a tool name and its arguments say what was asked for, but not what it was really for, whether this agent was ever meant to do it, or whether it normally does. Technical value, per the Ping deck (slide 48): three separable signals. Deterministic intent patterns and purpose declarations refuse hard; learned behaviour baselines drive alerts and approval. Business value, per the same slide: the enforceable declaration "this agent exists to reconcile invoices" unblocks unattended agents in processes that could not otherwise approve them. These are Ping claims, not measured by us.

## What is not proven

None of the product behaviour here has been run on our tenant. The signal names and their one-line descriptions come from the Ping deck. The field names for intents, purpose, behaviour and on-behalf-of come from the Privilege console swagger of 2026-10-31, which is schema only: it proves the names exist, not how they behave. Reason codes, scoring points, the pattern syntax, the similarity stand-in, the alert and ask thresholds and the refusal switches are invented by the lab. Say so if asked.

## The eight calls on the Three signals tab

1. **A legitimate lookup** (allow with the default policy). In scope, an ordinary pattern for this agent, and nothing in the request looks like exfiltration or a payee change. All three signals are quiet and the call goes through.
2. **A bulk export** (deny with the default policy). The deterministic intent pattern matches a bulk export, and the call is also outside the declared purpose. Both are hard-refusal tiers: the refusal does not depend on any score.
3. **A payee change (the literal tool)** (deny with the default policy). The tool name itself says it changes where money goes. A deterministic pattern refuses it, and it is not part of the declared purpose either.
4. **A payee change that avoids the obvious tool** (ask with the default policy). An in-scope tool, a usual argument shape, no pattern match. But what the text asks for is close to "change a payee". The similarity score is high, so the call is held for a person. It is not denied: a score never denies.
5. **A harmless call outside the declared purpose** (deny with the default policy). Intent is a single-record lookup, which is benign. But this key was issued for invoice reconciliation, and this tool is outside that. Purpose turns the declaration into something enforceable.
6. **A key that declares no purpose** (deny with the default policy). The same harmless call, from a key that was never given a purpose. Policy can refuse any call from such a key; here it does. Turn that switch off in the policy and it becomes an alert.
7. **In scope, but unlike this agent** (alert with the default policy). Allowed by purpose and not a risky intent, but the target was never touched and the argument shape was never used. Behaviour scores the departure and raises an alert; the call goes through.
8. **A new agent is never blocked for being new** (allow with the default policy). This agent has made three calls, fewer than MinObservations, so nothing is scored yet. The departure would have been high, and the call is allowed anyway, with the reason code ALLOW-LEARNING.
