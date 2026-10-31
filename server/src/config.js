// Deployment configuration. MODE is the DEFAULT mode the page opens in (mock or live); the header toggle can switch per visit.
// Both modes are loopback-only and make zero outbound calls. Anything else is an error, never a silent fallback.
export const MODES = ['mock', 'live'];
export function modeFrom(env = process.env) {
  const m = env.MODE === undefined || env.MODE === '' ? 'mock' : env.MODE;
  if (!MODES.includes(m)) throw new Error(`MODE=${String(m).slice(0, 20)} is not available: use mock or live`);
  return m;
}
export const defaultMode = () => modeFrom({ MODE: process.env.MODE });
export const modeOf = (v) => (MODES.includes(v) ? v : null);
