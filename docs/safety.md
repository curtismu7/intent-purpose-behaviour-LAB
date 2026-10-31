# Safety

- Loopback bind only (`IPBLAB_BIND` is the explicit opt-in the container uses); the compose file publishes `127.0.0.1` only (a test pins it).
- Host header must be a loopback name; writes must be same-origin.
- Netguard blocks every outbound connection (fetch, socket, DNS, UDP) with a self-test, and a test asserts zero attempts across the whole API in both modes, real signing included.
- Mock and Live are both local. Live is a real RS256 engine inside the process: the "issuer", the "MCP server" and the "partner app" are function calls, not network peers.
- Keys: RSA 2048 generated in memory on first Live use, never written to disk, never sent anywhere. Only public key sets are returned. No EC key generation is used anywhere (it aborted in CI on an older Node).
- Tokens are MOCK-ISSUED by this app, signed with those throwaway keys (Live) or carrying a placeholder signature (Mock), and shown raw for education. They are valid nowhere else. No client secret or private key exists in the lab; the schema's ClientSecret and PrivateKeyPEM fields are never shown.
- Input is bounded: body 8 KB; a call has a tool name of 1-64 safe characters, text of at most 200, at most 8 arguments with short values; a policy is a fixed shape with ranges; tokens over 8 KB are refused before parsing. Walkers are iterative; there is no `eval`, `Function` or `vm`, and no regular expression is ever built from user input (the pattern syntax is parsed with `split`). User text is rendered as React text, with control and bidi characters shown as visible escapes.
- Only `.example` and `.invalid` hosts appear in any shipped text. No tenant, credential or customer identifier ships. `customer.config.json` only sets three display strings and is git-ignored.
- Every product claim is labelled "Ping release claim, UNVERIFIED on our tenant" in the banner of every tab, in presenter mode too. Field names from the console swagger of 2026-10-31 are schema only; the lab says so wherever they appear.
