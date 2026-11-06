// Shared by leak.test.js and corpus-http.test.js: every place a visitor can type into, one request each. `p` is the raw payload; `q` the same percent-encoded.
// (not a *.test.js file, so the glob does not run it)
export const printable = (p) => /^[\x20-\x7e]*$/.test(p); // header values cannot carry control characters or non-ASCII; the body and path carry the full set

export function capture() {
  const chunks = []; const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = (c, ...a) => { chunks.push(String(c)); return true; };
  process.stderr.write = (c, ...a) => { chunks.push(String(c)); return true; };
  return { text: () => chunks.join(''), stop: () => { process.stdout.write = o; process.stderr.write = e; } };
}

// One request per place. `p` is the raw payload; `q` is the same percent-encoded for paths and queries.
export const PLACES = (p, q) => {
  const ev = (call, extra = {}) => ({ method: 'POST', path: '/api/evaluate', body: { mode: 'live', call, ...extra } });
  return {
    'evaluate call.description': ev({ tool: 'x.y', description: p, args: {} }),
    'evaluate args.payee': ev({ tool: 'x.y', args: { payee: p } }),
    'evaluate args.record': ev({ tool: 'x.y', args: { record: p } }),
    'evaluate args.dataset': ev({ tool: 'x.y', args: { dataset: p } }),
    'evaluate args.account': ev({ tool: 'x.y', args: { account: p } }),
    'evaluate args.note': ev({ tool: 'x.y', args: { note: p } }),
    'evaluate args.memo': ev({ tool: 'x.y', args: { memo: p } }),
    'evaluate args.destination': ev({ tool: 'x.y', description: 'export', args: { destination: p, limit: 9000 } }),
    'evaluate arg key': ev({ tool: 'x.y', args: { [p]: 'v' } }),
    'evaluate tool': ev({ tool: p }),
    'evaluate tool segment': ev({ tool: `payees.${p}` }),
    'evaluate call as text': { method: 'POST', path: '/api/evaluate', body: { mode: 'live', call: p } },
    'evaluate unknown call key': ev({ tool: 'x.y', [p]: 1 }),
    'evaluate unknown body key': { method: 'POST', path: '/api/evaluate', body: { mode: 'live', call: { tool: 'x.y' }, [p]: 1 } },
    'evaluate policy section': ev({ tool: 'x.y' }, { policy: { [p]: {} } }),
    'evaluate policy field': ev({ tool: 'x.y' }, { policy: { intent: { [p]: 1 } } }),
    'evaluate policy field in purpose': ev({ tool: 'x.y' }, { policy: { purpose: { [p]: true } } }),
    'evaluate policy value': ev({ tool: 'x.y' }, { policy: { intent: { Floor: p } } }),
    'evaluate policy as text': ev({ tool: 'x.y' }, { policy: p }),
    'evaluate scenario': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: p } },
    'evaluate mode': { method: 'POST', path: '/api/evaluate', body: { mode: p, scenario: 'legit-lookup' } },
    'evaluate vertical': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup', vertical: p } },
    'baseline policy section': { method: 'POST', path: '/api/baseline', body: { mode: 'live', kind: 'normal', policy: { [p]: {} } } },
    'baseline kind': { method: 'POST', path: '/api/baseline', body: { mode: 'live', kind: p } },
    'baseline mode': { method: 'POST', path: '/api/baseline', body: { mode: p, kind: 'normal' } },
    'baseline vertical': { method: 'POST', path: '/api/baseline', body: { mode: 'live', kind: 'normal', vertical: p } },
    'obo scenario': { method: 'POST', path: '/api/obo', body: { mode: 'live', scenario: p } },
    'obo mode': { method: 'POST', path: '/api/obo', body: { mode: p, scenario: 'ok' } },
    'idjag scenario': { method: 'POST', path: '/api/idjag', body: { mode: 'live', scenario: p } },
    'idjag vertical': { method: 'POST', path: '/api/idjag', body: { mode: 'mock', scenario: 'ok', vertical: p } },
    'reset body': { method: 'POST', path: '/api/reset', body: { [p]: p } },
    'mode body': { method: 'POST', path: '/api/mode', body: { [p]: p } },
    'query story vertical': { method: 'GET', path: `/api/story?vertical=${q}` },
    'query diagram name': { method: 'GET', path: `/api/diagram?name=${q}&vertical=${q}` },
    'query baseline mode': { method: 'GET', path: `/api/baseline?mode=${q}&vertical=${q}` },
    'query info': { method: 'GET', path: `/api/info?${q}=${q}` },
    'query health': { method: 'GET', path: `/api/health?x=${q}` },
    'query runs': { method: 'GET', path: `/api/runs?x=${q}` },
    'path unknown api': { method: 'GET', path: `/api/${q}` },
    'path under known route': { method: 'GET', path: `/api/story/${q}` },
    'path under health': { method: 'GET', path: `/api/health/${q}` },
    'path post unknown api': { method: 'POST', path: `/api/${q}`, body: {} },
    'path unknown top level': { method: 'POST', path: `/${q}`, body: {} },
    'path unknown top level get': { method: 'GET', path: `/${q}` },
    'path asset': { method: 'GET', path: `/assets/${q}.js` },
    'path put': { method: 'PUT', path: `/${q}`, body: {} },
    'path delete api': { method: 'DELETE', path: `/api/evaluate/${q}` },
    'wrong method on a known route': { method: 'PUT', path: `/api/evaluate?x=${q}`, body: { p } },
    'malformed json': { method: 'POST', path: '/api/evaluate', raw: `{"mode":"live","call":{"description":"${p.replace(/["\\]/g, '')}"` },
    'array body': { method: 'POST', path: '/api/evaluate', raw: JSON.stringify([p]) },
    'text body': { method: 'POST', path: '/api/evaluate', raw: p, headers: { 'content-type': 'text/plain' } },
    'oversized body': { method: 'POST', path: '/api/evaluate', raw: JSON.stringify({ pad: `${'x'.repeat(9000)} ${p}` }) },
    'filler then secret': ev({ tool: 'x.y', description: `${'a'.repeat(19_990)} ${p}` }),
    ...(printable(p) ? {
      'header X-Workspace': { method: 'GET', path: '/api/runs', headers: { 'x-workspace': p } },
      'header X-Workspace on evaluate': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { 'x-workspace': p } },
      'header X-Workspace on reset': { method: 'POST', path: '/api/reset', body: {}, headers: { 'x-workspace': p } },
      'header traceparent': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { traceparent: p } },
      'header traceparent on obo': { method: 'POST', path: '/api/obo', body: { mode: 'mock', scenario: 'ok' }, headers: { traceparent: p } },
      'header Origin': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { origin: p } },
      'header Sec-Fetch-Site': { method: 'POST', path: '/api/evaluate', body: { mode: 'mock', scenario: 'legit-lookup' }, headers: { 'sec-fetch-site': p } },
      'header Cookie': { method: 'GET', path: '/api/info', headers: { cookie: p } },
      'header Authorization': { method: 'GET', path: '/api/info', headers: { authorization: p } },
      'header User-Agent and Referer': { method: 'GET', path: '/api/story', headers: { 'user-agent': p, referer: `http://localhost/${q}` } },
    } : {}),
  };
};

