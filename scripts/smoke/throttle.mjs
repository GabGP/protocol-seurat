// Network throttling for the viewer smoke: Chrome DevTools presets applied over CDP before the page loads,
// and the longer timeline a throttled run needs (a 3G link paints the sketch in tens of seconds, not in two).

/** DevTools "3G": 400 kbps down and up (CDP takes bytes per second: 50,000), 2000 ms latency. */
export const PRESETS = {
  off: null,
  '3g': { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
};

/** Settle cap after the last input and the quiet time that counts as settled, per mode, in ms. */
const TIMELINE = {
  off: { settleCapMs: 40000, quietMs: 3000 },
  throttled: { settleCapMs: 180000, quietMs: 10000 },
};
const SEED_POLL_MS = 500;

/** The preset named by --throttle (default off); exits on an unknown name. */
export function throttlePreset(name = 'off') {
  if (!(name in PRESETS)) {
    console.error(`--throttle ${name}: expected one of ${Object.keys(PRESETS).join('|')}`);
    process.exit(2);
  }
  return PRESETS[name];
}

/** Settle cap and quiet time: the mode's defaults, --settle-cap S and --quiet S override them. */
export function timeline(preset, args) {
  const t = { ...(preset ? TIMELINE.throttled : TIMELINE.off) };
  if (args['settle-cap'] !== undefined) t.settleCapMs = Number(args['settle-cap']) * 1000;
  if (args.quiet !== undefined) t.quietMs = Number(args.quiet) * 1000;
  return t;
}

/** Network.enable, then the preset's conditions (none when off). Call before Page.navigate. */
export async function applyThrottle(cdp, preset) {
  await cdp('Network.enable');
  if (preset) await cdp('Network.emulateNetworkConditions', preset);
}

/** Throttled runs start the input timeline once the seed arrived, so the wheel reaches a live canvas. */
export async function waitForSeed(read, capMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    try { if ((await read()).firstFlow !== undefined) return Date.now() - t0; } catch { /* page still loading */ }
    await new Promise((r) => setTimeout(r, SEED_POLL_MS));
  }
  return null;
}
