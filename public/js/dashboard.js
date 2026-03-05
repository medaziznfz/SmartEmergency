/**
 * Dashboard tab: device widgets (gauges), realtime chart
 */
import {
  pctGas,
  gaugeSVG,
  isOnline,
  triggersText,
  tempToPercent,
  humidityToPercent
} from './utils.js';

const GAUGE_TEMP_COLOR = '#ea580c';
const GAUGE_HUM_COLOR = '#0891b2';
const GAUGE_GAS_COLOR = '#0d6efd';
const GAUGE_ALARM_COLOR = '#dc3545';

export function initDashboard(socket, state) {
  const devicesEl = document.getElementById('dashboard-devices');
  const deviceSelect = document.getElementById('dashboard-device-select');
  const alarmBadge = document.getElementById('dashboard-alarm-badge');
  const ctx = document.getElementById('dashboard-chart');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Temp (°C)', data: [], borderColor: GAUGE_TEMP_COLOR, backgroundColor: 'rgba(234,88,12,0.1)', fill: true, tension: 0.3 },
        { label: 'Humidity (%)', data: [], borderColor: GAUGE_HUM_COLOR, backgroundColor: 'rgba(8,145,178,0.1)', fill: true, tension: 0.3 },
        { label: 'Gas (raw)', data: [], borderColor: GAUGE_GAS_COLOR, fill: false, tension: 0.3 }
      ]
    },
    options: {
      responsive: true,
      animation: false,
      maintainAspectRatio: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' } },
        x: { grid: { display: false } }
      }
    }
  });

  function getMeta(uid) {
    return state.deviceMeta.get(uid) || {};
  }

  function renderDeviceCard(r) {
    const alarm = Number(r.alarm) === 1;
    const flameDetected = Number(r.f) === 0;
    const gasP = pctGas(Number(r.g));
    const tempP = tempToPercent(Number(r.t), 60);
    const humP = humidityToPercent(Number(r.h));
    const online = isOnline(r);
    const meta = getMeta(r.uid);

    const ip = r.ip ?? meta.last_ip ?? '-';
    const rssi = r.rssi ?? meta.last_rssi;
    const rssiStr = rssi != null ? String(rssi) : '-';
    const gt = meta.gas_threshold ?? '-';
    const tt = meta.temp_threshold != null ? Number(meta.temp_threshold).toFixed(1) : '-';
    const humRange = (meta.humidity_low_threshold != null && meta.humidity_high_threshold != null)
      ? `${meta.humidity_low_threshold}–${meta.humidity_high_threshold}%`
      : '-';

    // Determine which triggers are active from the latest reading
    const triggers = r.triggers || {};
    const tempTriggered = triggers.temp;
    const humTriggered = triggers.humidity;
    const gasTriggered = triggers.gas;

    // Set colors based on individual triggers
    const tempColor = tempTriggered ? GAUGE_ALARM_COLOR : GAUGE_TEMP_COLOR;
    const humColor = humTriggered ? GAUGE_ALARM_COLOR : GAUGE_HUM_COLOR;
    const gasColor = gasTriggered ? GAUGE_ALARM_COLOR : GAUGE_GAS_COLOR;

    return `
    <div class="col-12 col-md-6 col-xl-4" id="card-${r.uid}">
      <div class="card device-widget h-100 ${alarm ? 'alarm-on alarm-blinking' : ''}">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start mb-3">
            <div>
              <h5 class="device-widget-title mb-1">
                <span class="dot ${online ? 'dot-online' : 'dot-offline'}"></span>
                ${r.label}
              </h5>
              <div class="device-meta small text-muted">
                <div>UID: ${r.uid}</div>
                <div>Status: <b>${online ? 'ONLINE' : 'OFFLINE'}</b></div>
              </div>
            </div>
            ${alarm ? '<span class="badge badge-alarm">ALARM</span>' : '<span class="badge badge-safe">SAFE</span>'}
          </div>

          <div class="device-gauges row g-2 justify-content-around">
            <div class="col-4 d-flex flex-column align-items-center">
              <div class="text-muted small mb-1">Temp: ${tt}°C</div>
              ${gaugeSVG(tempP, 'Temp', tempColor)}
              <span class="gauge-value">${Number(r.t).toFixed(1)}°C</span>
            </div>
            <div class="col-4 d-flex flex-column align-items-center">
              <div class="text-muted small mb-1">Hum: ${humRange}</div>
              ${gaugeSVG(humP, 'Humidity', humColor)}
              <span class="gauge-value">${Number(r.h).toFixed(1)}%</span>
            </div>
            <div class="col-4 d-flex flex-column align-items-center">
              <div class="text-muted small mb-1">Gas: ${gt}</div>
              ${gaugeSVG(gasP, 'Gas', gasColor)}
              <span class="gauge-value">${r.g}</span>
            </div>
          </div>

          <div class="device-widget-footer mt-3 pt-2">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="flame-badge ${flameDetected ? 'flame-danger' : 'flame-ok'}">Flame: ${flameDetected ? 'DETECTED' : 'OK'}</span>
              <span class="text-muted small">Triggers: ${triggersText(r.triggers)}</span>
            </div>
            <div class="text-muted small mt-1">IP: ${ip} | RSSI: ${rssiStr}</div>
            <div class="text-muted small mt-1">Last: ${new Date(r.ts || Date.now()).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function refreshCards() {
    devicesEl.innerHTML = [...state.deviceState.values()]
      .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
      .map(renderDeviceCard)
      .join('');
  }

  function pushSeries(uid, r) {
    if (!state.deviceSeries.has(uid)) state.deviceSeries.set(uid, []);
    const arr = state.deviceSeries.get(uid);
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
    const arr = state.deviceSeries.get(uid) || [];
    showChartFromPoints(arr);
  }

  function rebuildDeviceSelect() {
    const uids = [...state.deviceState.keys()];
    const current = deviceSelect.value;

    deviceSelect.innerHTML = uids
      .map(uid => {
        const d = state.deviceState.get(uid);
        return `<option value="${uid}">${d?.label || uid} (${uid})</option>`;
      })
      .join('');

    if (current && uids.includes(current)) deviceSelect.value = current;
    else if (uids.length) deviceSelect.value = uids[0];
  }

  function updateTopBadge(uid) {
    const r = state.deviceState.get(uid);
    if (!r) return;
    if (Number(r.alarm) === 1) {
      alarmBadge.className = 'badge badge-status text-bg-danger';
      alarmBadge.textContent = 'ALARM';
    } else {
      alarmBadge.className = 'badge badge-status text-bg-success';
      alarmBadge.textContent = 'SAFE';
    }
  }

  deviceSelect.addEventListener('change', () => {
    const uid = deviceSelect.value;
    updateTopBadge(uid);
    updateChartLive(uid);
  });

  socket.on('reading', (r) => {
    state.deviceState.set(r.uid, r);
    pushSeries(r.uid, r);
    refreshCards();
    rebuildDeviceSelect();
    if (deviceSelect.value === r.uid) {
      updateTopBadge(r.uid);
      updateChartLive(r.uid);
    }
  });

  setInterval(refreshCards, 5000);

  return {
    refresh: refreshCards,
    rebuildSelect: rebuildDeviceSelect,
    updateChart: updateChartLive,
    updateBadge: updateTopBadge
  };
}
