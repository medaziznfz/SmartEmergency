/**
 * Shared utilities for SmartEmergency
 */
export const ONLINE_SECONDS = 20;

export function pctGas(g) {
  return Math.max(0, Math.min(100, Math.round((g / 1023) * 100)));
}

const GAUGE_R = 46;

export function gaugeSVG(percent, label, strokeColor = '#0d6efd') {
  const c = 2 * Math.PI * GAUGE_R;
  const offset = c - (percent / 100) * c;
  return `
  <svg class="gauge gauge-svg" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke="var(--gauge-bg, #e9ecef)" stroke-width="12"/>
    <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke="${strokeColor}" stroke-width="12"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
      transform="rotate(-90 60 60)"/>
    <text x="60" y="62" text-anchor="middle" font-size="22" font-weight="700" fill="#1e293b">${Math.round(percent)}%</text>
    <text x="60" y="82" text-anchor="middle" font-size="11" fill="#64748b">${label}</text>
  </svg>`;
}

/** Temp 0–60°C → 0–100% for display; or use 0–100°C */
export function tempToPercent(temp, maxTemp = 60) {
  return Math.max(0, Math.min(100, (Number(temp) / maxTemp) * 100));
}

/** Humidity is already 0–100 */
export function humidityToPercent(h) {
  return Math.max(0, Math.min(100, Number(h)));
}

export function isOnline(r) {
  if (!r?.ts) return false;
  const age = (Date.now() - new Date(r.ts).getTime()) / 1000;
  return age <= ONLINE_SECONDS;
}

export function triggersText(tr) {
  if (!tr) return '-';
  const parts = [];
  if (tr.flame) parts.push('flame');
  if (tr.gas) parts.push('gas');
  if (tr.temp) parts.push('temp');
  if (tr.humidity) parts.push('humidity');
  return parts.length ? parts.join(', ') : '-';
}

export function fmtDur(sec) {
  if (sec == null) return '-';
  sec = Number(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function toISOFromLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
