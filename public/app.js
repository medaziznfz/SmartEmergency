const socket = io();

const devicesEl = document.getElementById('devices');
const deviceSelect = document.getElementById('deviceSelect');

const gasTh = document.getElementById('gasTh');
const tempTh = document.getElementById('tempTh');
const flameEnabled = document.getElementById('flameEnabled');

const humidityEnabled = document.getElementById('humidityEnabled');
const humLow = document.getElementById('humLow');
const humHigh = document.getElementById('humHigh');

const saveTh = document.getElementById('saveTh');
const thMsg = document.getElementById('thMsg');

const alarmsTbody = document.getElementById('alarmsTbody');
const readingsTbody = document.getElementById('readingsTbody');

const refreshAlarmsBtn = document.getElementById('refreshAlarms');
const refreshReadingsBtn = document.getElementById('refreshReadings');

const activeAlarmBadge = document.getElementById('activeAlarmBadge');
const activeAlarmInfo = document.getElementById('activeAlarmInfo');

const fromTs = document.getElementById('fromTs');
const toTs = document.getElementById('toTs');
const limitHistory = document.getElementById('limitHistory');
const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const historyMsg = document.getElementById('historyMsg');
const liveModeBtn = document.getElementById('liveModeBtn');

const deviceState = new Map();     // uid -> last reading object
const deviceSeries = new Map();    // uid -> last 60 live points
const lastAlarmState = new Map();  // uid -> 0/1
let chartMode = 'live';            // 'live' | 'history'

const ONLINE_SECONDS = 20;         // UI-only fallback (server also computes)

// Chart.js
const ctx = document.getElementById('chart');
const chart = new Chart(ctx, {
  type: 'line',
  data: { labels: [], datasets: [
    { label: 'Temp (°C)', data: [] },
    { label: 'Humidity (%)', data: [] },
    { label: 'Gas (raw)', data: [] },
  ]},
  options: { responsive: true, animation: false }
});

function pctGas(g) {
  return Math.max(0, Math.min(100, Math.round((g / 1023) * 100)));
}

function gaugeSVG(percent, label) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return `
  <svg class="gauge" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#e9ecef" stroke-width="12"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="#0d6efd" stroke-width="12"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
      transform="rotate(-90 60 60)"/>
    <text x="60" y="62" text-anchor="middle" font-size="22" font-weight="700">${percent}%</text>
    <text x="60" y="82" text-anchor="middle" font-size="12" fill="#6c757d">${label}</text>
  </svg>`;
}

function isOnline(r) {
  if (!r?.ts) return false;
  const age = (Date.now() - new Date(r.ts).getTime()) / 1000;
  return age <= ONLINE_SECONDS;
}

function triggersText(tr) {
  if (!tr) return '-';
  const parts = [];
  if (tr.flame) parts.push('flame');
  if (tr.gas) parts.push('gas');
  if (tr.temp) parts.push('temp');
  if (tr.humidity) parts.push('humidity');
  return parts.length ? parts.join(', ') : '-';
}

function renderDeviceCard(r) {
  const alarm = Number(r.alarm) === 1;
  const flameDetected = Number(r.f) === 0;
  const gasP = pctGas(Number(r.g));
  const online = isOnline(r);

  return `
  <div class="col-12 col-md-6 col-xl-4" id="card-${r.uid}">
    <div class="card ${alarm ? 'alarm-on' : ''}">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <h5 class="mb-1">
              <span class="dot ${online ? 'dot-online' : 'dot-offline'}"></span>
              ${r.label}
            </h5>
            <div class="text-muted small">UID: ${r.uid}</div>
            <div class="text-muted small">IP: ${r.ip || '-'} | RSSI: ${r.rssi ?? '-'}</div>
            <div class="text-muted small">Status: <b>${online ? 'ONLINE' : 'OFFLINE'}</b></div>
          </div>
          <div>
            ${alarm ? `<span class="badge text-bg-danger">ALARM</span>` : `<span class="badge text-bg-success">SAFE</span>`}
          </div>
        </div>

        <div class="d-flex gap-2 mt-3 flex-wrap">
          <div class="border rounded p-2">
            <div class="small text-muted">Temp</div>
            <div class="fs-4 fw-bold">${Number(r.t).toFixed(1)}°C</div>
          </div>
          <div class="border rounded p-2">
            <div class="small text-muted">Humidity</div>
            <div class="fs-4 fw-bold">${Number(r.h).toFixed(1)}%</div>
          </div>
          <div class="border rounded p-2">
            <div class="small text-muted">Flame</div>
            <div class="fs-5 fw-bold ${flameDetected ? 'text-danger' : 'text-success'}">
              ${flameDetected ? 'DETECTED' : 'OK'}
            </div>
          </div>
        </div>

        <div class="mt-3 d-flex align-items-center gap-3">
          ${gaugeSVG(gasP, 'Gas')}
          <div>
            <div class="small text-muted">Gas raw</div>
            <div class="fs-4 fw-bold">${r.g}</div>
            <div class="text-muted small">Triggers: ${triggersText(r.triggers)}</div>
          </div>
        </div>

        <div class="text-muted small mt-2">Last: ${new Date(r.ts || Date.now()).toLocaleString()}</div>
      </div>
    </div>
  </div>`;
}

function refreshCards() {
  devicesEl.innerHTML = [...deviceState.values()]
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .map(renderDeviceCard)
    .join('');
}

function pushSeries(uid, r) {
  if (!deviceSeries.has(uid)) deviceSeries.set(uid, []);
  const arr = deviceSeries.get(uid);
  arr.push({ ts: r.ts, t: r.t, h: r.h, g: r.g });
  if (arr.length > 60) arr.shift();
}

function showChartFromPoints(points) {
  chart.data.labels = points.map(p => new Date(p.ts).toLocaleTimeString());
  chart.data.datasets[0].data = points.map(p => Number(p.t));
  chart.data.datasets[1].data = points.map(p => Number(p.h));
  chart.data.datasets[2].data = points.map(p => Number(p.g));
  chart.update();
}

function updateChartLive(uid) {
  const arr = deviceSeries.get(uid) || [];
  showChartFromPoints(arr);
}

function rebuildDeviceSelect() {
  const uids = [...deviceState.keys()];
  const current = deviceSelect.value;

  deviceSelect.innerHTML = uids
    .map(uid => `<option value="${uid}">${deviceState.get(uid).label} (${uid})</option>`)
    .join('');

  if (current && uids.includes(current)) deviceSelect.value = current;
  if (!deviceSelect.value && uids.length) deviceSelect.value = uids[0];
}

function fmtDur(sec) {
  if (sec == null) return '-';
  sec = Number(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

async function loadThresholds(uid) {
  thMsg.textContent = '';
  const r = await fetch(`/api/devices/${uid}/thresholds`);
  const j = await r.json();
  if (!j?.ok) {
    thMsg.textContent = 'Failed to load thresholds.';
    return;
  }

  gasTh.value = j.gas_threshold;
  tempTh.value = j.temp_threshold;
  flameEnabled.checked = Number(j.flame_enabled) === 1;

  humidityEnabled.checked = Number(j.humidity_enabled) === 1;
  humLow.value = j.humidity_low_threshold;
  humHigh.value = j.humidity_high_threshold;
}

async function loadAlarmHistory(uid) {
  const r = await fetch(`/api/devices/${uid}/alarms?limit=100`);
  const arr = await r.json();

  if (!Array.isArray(arr) || arr.length === 0) {
    alarmsTbody.innerHTML = `<tr><td colspan="5" class="text-muted">No alarm events.</td></tr>`;
    return;
  }

  alarmsTbody.innerHTML = arr.map(e => {
    const start = new Date(e.started_at).toLocaleString();
    const end = e.ended_at ? new Date(e.ended_at).toLocaleString() : '<span class="badge text-bg-danger">ACTIVE</span>';
    const dur = e.duration_seconds != null ? fmtDur(e.duration_seconds) : '-';
    const tr = triggersText(e.triggers);
    const peaks = `G:${e.peak_gas ?? '-'} | T:${e.peak_temp ?? '-'} | H:${e.peak_humidity ?? '-'}`;
    return `
      <tr>
        <td>${start}</td>
        <td>${end}</td>
        <td>${dur}</td>
        <td>${tr}</td>
        <td class="text-muted">${peaks}</td>
      </tr>
    `;
  }).join('');
}

let activeAlarmTimer = null;

async function loadActiveAlarm(uid) {
  const r = await fetch(`/api/devices/${uid}/alarms/active`);
  const e = await r.json();

  if (activeAlarmTimer) clearInterval(activeAlarmTimer);
  activeAlarmTimer = null;

  if (!e) {
    activeAlarmInfo.textContent = 'No active alarm.';
    return;
  }

  const started = new Date(e.started_at);
  const tr = triggersText(e.triggers);

  const tick = () => {
    const sec = Math.floor((Date.now() - started.getTime()) / 1000);
    activeAlarmInfo.innerHTML = `
      <div><span class="badge text-bg-danger">ACTIVE</span> since <b>${started.toLocaleString()}</b></div>
      <div class="text-muted">Duration: <b>${fmtDur(sec)}</b></div>
      <div class="text-muted">Triggers (union): <b>${tr}</b></div>
      <div class="text-muted">Peaks: G:${e.peak_gas ?? '-'} | T:${e.peak_temp ?? '-'} | H:${e.peak_humidity ?? '-'}</div>
    `;
  };

  tick();
  activeAlarmTimer = setInterval(tick, 1000);
}

function updateTopBadgeFromLast(uid) {
  const r = deviceState.get(uid);
  if (!r) return;
  if (Number(r.alarm) === 1) {
    activeAlarmBadge.className = 'badge text-bg-danger';
    activeAlarmBadge.textContent = 'ALARM';
  } else {
    activeAlarmBadge.className = 'badge text-bg-success';
    activeAlarmBadge.textContent = 'SAFE';
  }
}

async function loadReadingsTable(uid) {
  const lim = 200;
  const r = await fetch(`/api/devices/${uid}/history?limit=${lim}`);
  const arr = await r.json();

  if (!Array.isArray(arr) || arr.length === 0) {
    readingsTbody.innerHTML = `<tr><td colspan="7" class="text-muted">No readings.</td></tr>`;
    return;
  }

  const last50 = arr.slice(-50).reverse(); // newest first
  readingsTbody.innerHTML = last50.map(x => {
    const ts = new Date(x.ts).toLocaleString();
    const alarm = Number(x.alarm) === 1 ? '<span class="badge text-bg-danger">1</span>' : '<span class="badge text-bg-success">0</span>';
    const flame = Number(x.flame) === 0 ? '<span class="badge text-bg-danger">LOW</span>' : '<span class="badge text-bg-success">HIGH</span>';
    return `
      <tr>
        <td>${ts}</td>
        <td>${Number(x.temperature).toFixed(1)}</td>
        <td>${Number(x.humidity).toFixed(1)}</td>
        <td>${x.gas}</td>
        <td>${flame}</td>
        <td>${alarm}</td>
        <td class="text-muted">${triggersText(x.triggers)}</td>
      </tr>
    `;
  }).join('');
}

function toISOFromLocalInput(v) {
  if (!v) return '';
  const d = new Date(v);
  // MySQL TIMESTAMP string format
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function loadHistoryIntoChart(uid) {
  const lim = Math.min(Math.max(Number(limitHistory.value || 500), 50), 5000);
  const from = toISOFromLocalInput(fromTs.value);
  const to = toISOFromLocalInput(toTs.value);

  const qs = new URLSearchParams();
  qs.set('limit', String(lim));
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);

  historyMsg.textContent = 'Loading...';
  const r = await fetch(`/api/devices/${uid}/history?${qs.toString()}`);
  const arr = await r.json();

  if (!Array.isArray(arr) || arr.length === 0) {
    historyMsg.textContent = 'No data for that range.';
    return;
  }

  chartMode = 'history';
  historyMsg.textContent = `Loaded ${arr.length} points (history mode).`;
  showChartFromPoints(arr.map(p => ({
    ts: p.ts,
    t: p.temperature,
    h: p.humidity,
    g: p.gas
  })));
}

deviceSelect.addEventListener('change', async () => {
  const uid = deviceSelect.value;
  updateTopBadgeFromLast(uid);

  chartMode = 'live';
  historyMsg.textContent = 'Live mode.';
  updateChartLive(uid);

  await loadThresholds(uid);
  await loadAlarmHistory(uid);
  await loadActiveAlarm(uid);
  await loadReadingsTable(uid);
});

loadHistoryBtn.addEventListener('click', async () => {
  const uid = deviceSelect.value;
  if (!uid) return;
  await loadHistoryIntoChart(uid);
});

liveModeBtn.addEventListener('click', () => {
  const uid = deviceSelect.value;
  chartMode = 'live';
  historyMsg.textContent = 'Live mode.';
  if (uid) updateChartLive(uid);
});

refreshAlarmsBtn.addEventListener('click', async () => {
  const uid = deviceSelect.value;
  if (!uid) return;
  await loadAlarmHistory(uid);
  await loadActiveAlarm(uid);
});

refreshReadingsBtn.addEventListener('click', async () => {
  const uid = deviceSelect.value;
  if (!uid) return;
  await loadReadingsTable(uid);
});

saveTh.addEventListener('click', async () => {
  const uid = deviceSelect.value;
  if (!uid) return;

  const body = {
    gas_threshold: Number(gasTh.value),
    temp_threshold: Number(tempTh.value),
    flame_enabled: flameEnabled.checked ? 1 : 0,
    humidity_enabled: humidityEnabled.checked ? 1 : 0,
    humidity_low_threshold: Number(humLow.value),
    humidity_high_threshold: Number(humHigh.value)
  };

  thMsg.textContent = 'Saving...';
  thMsg.className = 'mt-2 small text-muted';

  const r = await fetch(`/api/devices/${uid}/thresholds`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    thMsg.textContent = `❌ Save failed: ${j.error || r.statusText}`;
    thMsg.className = 'mt-2 small text-danger';
    return;
  }

  thMsg.textContent = '✅ Saved. ESP will apply automatically (next config pull).';
  thMsg.className = 'mt-2 small text-success';
});

// Initial load from DB
(async () => {
  const devices = await fetch('/api/devices').then(r => r.json());

  for (const d of devices) {
    const latest = await fetch(`/api/devices/${d.uid}/latest`).then(r => r.json());
    if (!latest) continue;

    const normalized = {
      uid: d.uid,
      label: d.label,
      ip: d.last_ip,
      rssi: d.last_rssi,
      ts: latest.ts,
      h: latest.humidity,
      t: latest.temperature,
      g: latest.gas,
      f: latest.flame,
      alarm: latest.alarm,
      triggers: latest.triggers
    };

    deviceState.set(d.uid, normalized);
    pushSeries(d.uid, normalized);
    lastAlarmState.set(d.uid, Number(latest.alarm) || 0);
  }

  refreshCards();
  rebuildDeviceSelect();

  const uid = deviceSelect.value;
  if (uid) {
    updateTopBadgeFromLast(uid);
    updateChartLive(uid);
    await loadThresholds(uid);
    await loadAlarmHistory(uid);
    await loadActiveAlarm(uid);
    await loadReadingsTable(uid);
  }
})();

// Realtime updates
socket.on('reading', async (r) => {
  deviceState.set(r.uid, r);
  pushSeries(r.uid, r);

  refreshCards();
  rebuildDeviceSelect();

  if (deviceSelect.value === r.uid) {
    updateTopBadgeFromLast(r.uid);
    if (chartMode === 'live') updateChartLive(r.uid);
  }

  const prev = lastAlarmState.get(r.uid) ?? 0;
  const now = Number(r.alarm) ?? 0;
  if (prev !== now) {
    lastAlarmState.set(r.uid, now);
    if (deviceSelect.value === r.uid) {
      await loadAlarmHistory(r.uid);
      await loadActiveAlarm(r.uid);
      await loadReadingsTable(r.uid);
    }
  }
});

// Online/offline refresh (UI-only)
setInterval(() => refreshCards(), 5000);
