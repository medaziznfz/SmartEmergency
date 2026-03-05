/**
 * History tab: readings table, alarm history, chart with filters & pagination
 */
import { triggersText, fmtDur, toISOFromLocalInput } from './utils.js';

const PAGE_SIZE = 25;

function buildParams(device, from, to, limit, offset) {
  const qs = new URLSearchParams();
  if (device) qs.set('device', device);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  qs.set('limit', String(limit || PAGE_SIZE));
  qs.set('offset', String(offset || 0));
  return qs.toString();
}

function filterBySearch(items, search, fields) {
  if (!search?.trim()) return items;
  const s = search.trim().toLowerCase();
  return items.filter(x => fields.some(f => String(x[f] ?? '').toLowerCase().includes(s)));
}

export function initHistory(socket, state) {
  const deviceSelect = document.getElementById('history-device-select');
  const fromInput = document.getElementById('history-from');
  const toInput = document.getElementById('history-to');
  const limitInput = document.getElementById('history-limit');
  const loadChartBtn = document.getElementById('history-load-chart-btn');
  const ctx = document.getElementById('history-chart');

  const alarmsDevice = document.getElementById('history-alarms-device');
  const alarmsFrom = document.getElementById('history-alarms-from');
  const alarmsTo = document.getElementById('history-alarms-to');
  const alarmsSearch = document.getElementById('history-alarms-search');
  const alarmsApply = document.getElementById('history-alarms-apply');
  const alarmsTbody = document.getElementById('history-alarms-tbody');
  const alarmsInfo = document.getElementById('history-alarms-info');
  const alarmsPagination = document.getElementById('history-alarms-pagination');

  const readingsDevice = document.getElementById('history-readings-device');
  const readingsFrom = document.getElementById('history-readings-from');
  const readingsTo = document.getElementById('history-readings-to');
  const readingsSearch = document.getElementById('history-readings-search');
  const readingsApply = document.getElementById('history-readings-apply');
  const readingsTbody = document.getElementById('history-readings-tbody');
  const readingsInfo = document.getElementById('history-readings-info');
  const readingsPagination = document.getElementById('history-readings-pagination');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Temp (°C)', data: [], borderColor: '#0d6efd', fill: false, tension: 0.3 },
        { label: 'Humidity (%)', data: [], borderColor: '#198754', fill: false, tension: 0.3 },
        { label: 'Gas (raw)', data: [], borderColor: '#fd7e14', fill: false, tension: 0.3 }
      ]
    },
    options: { responsive: true, animation: false }
  });

  function rebuildDeviceSelects() {
    const uids = [...state.deviceState.keys()];
    const allOpts = '<option value="">All devices</option>' + uids.map(uid => {
      const d = state.deviceState.get(uid);
      return `<option value="${uid}">${d?.label || uid}</option>`;
    }).join('');
    const chartOpts = uids.map(uid => {
      const d = state.deviceState.get(uid);
      return `<option value="${uid}">${d?.label || uid}</option>`;
    }).join('');

    deviceSelect.innerHTML = chartOpts || '<option value="">No devices</option>';
    alarmsDevice.innerHTML = allOpts;
    readingsDevice.innerHTML = allOpts;
  }

  function showChartFromPoints(points) {
    chart.data.labels = points.map(p => new Date(p.ts).toLocaleTimeString());
    chart.data.datasets[0].data = points.map(p => Number(p.t ?? p.temperature));
    chart.data.datasets[1].data = points.map(p => Number(p.h ?? p.humidity));
    chart.data.datasets[2].data = points.map(p => Number(p.g ?? p.gas));
    chart.update();
  }

  loadChartBtn.addEventListener('click', async () => {
    const uid = deviceSelect.value;
    if (!uid) { alert('Select a device'); return; }

    const lim = Math.min(Math.max(Number(limitInput.value || 500), 50), 5000);
    const from = toISOFromLocalInput(fromInput.value);
    const to = toISOFromLocalInput(toInput.value);

    const qs = new URLSearchParams();
    qs.set('limit', String(lim));
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);

    const r = await fetch(`/api/devices/${uid}/history?${qs.toString()}`);
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      showChartFromPoints([]);
      return;
    }
    showChartFromPoints(arr.map(p => ({ ts: p.ts, t: p.temperature, h: p.humidity, g: p.gas })));
  });

  let alarmsOffset = 0;
  let readingsOffset = 0;

  async function loadAlarms() {
    const device = alarmsDevice.value || null;
    const from = toISOFromLocalInput(alarmsFrom.value);
    const to = toISOFromLocalInput(alarmsTo.value);

    const r = await fetch(`/api/alarms?${buildParams(device, from, to, PAGE_SIZE, alarmsOffset)}`);
    const data = await r.json();
    const items = data.items || [];
    const total = data.total ?? 0;

    let filtered = filterBySearch(items, alarmsSearch.value, ['triggers', 'label']);
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const page = Math.floor(alarmsOffset / PAGE_SIZE) + 1;

    alarmsTbody.innerHTML = filtered.length === 0
      ? '<tr><td colspan="6" class="text-muted text-center py-4">No alarm events.</td></tr>'
      : filtered.map(e => {
          const start = new Date(e.started_at).toLocaleString();
          const end = e.ended_at ? new Date(e.ended_at).toLocaleString() : '<span class="badge text-bg-danger">ACTIVE</span>';
          const peaks = `G:${e.peak_gas ?? '-'} T:${e.peak_temp ?? '-'} H:${e.peak_humidity ?? '-'}`;
          return `
            <tr>
              <td>${e.label || e.uid}</td>
              <td>${start}</td>
              <td>${end}</td>
              <td>${fmtDur(e.duration_seconds)}</td>
              <td>${triggersText(e.triggers)}</td>
              <td class="text-muted small">${peaks}</td>
            </tr>`;
        }).join('');

    alarmsInfo.textContent = `Page ${page} of ${totalPages} · ${total} total`;
    renderPagination(alarmsPagination, total, alarmsOffset, PAGE_SIZE, (o) => { alarmsOffset = o; loadAlarms(); });
  }

  async function loadReadings() {
    const device = readingsDevice.value || null;
    const from = toISOFromLocalInput(readingsFrom.value);
    const to = toISOFromLocalInput(readingsTo.value);

    const r = await fetch(`/api/readings?${buildParams(device, from, to, PAGE_SIZE, readingsOffset)}`);
    const data = await r.json();
    let items = data.items || [];
    const total = data.total ?? 0;

    items = filterBySearch(items, readingsSearch.value, ['temperature', 'humidity', 'gas', 'label', 'ts']);

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const page = Math.floor(readingsOffset / PAGE_SIZE) + 1;

    readingsTbody.innerHTML = items.length === 0
      ? '<tr><td colspan="8" class="text-muted text-center py-4">No readings.</td></tr>'
      : items.map(x => {
          const ts = new Date(x.ts).toLocaleString();
          const alarm = Number(x.alarm) === 1 ? '<span class="badge text-bg-danger">1</span>' : '<span class="badge text-bg-success">0</span>';
          const flame = Number(x.flame) === 0 ? '<span class="badge text-bg-danger">LOW</span>' : '<span class="badge text-bg-success">HIGH</span>';
          return `
            <tr>
              <td>${x.label || x.uid}</td>
              <td>${ts}</td>
              <td>${Number(x.temperature).toFixed(1)}</td>
              <td>${Number(x.humidity).toFixed(1)}</td>
              <td>${x.gas}</td>
              <td>${flame}</td>
              <td>${alarm}</td>
              <td class="text-muted small">${triggersText(x.triggers)}</td>
            </tr>`;
        }).join('');

    readingsInfo.textContent = `Page ${page} of ${totalPages} · ${total} total`;
    renderPagination(readingsPagination, total, readingsOffset, PAGE_SIZE, (o) => { readingsOffset = o; loadReadings(); });
  }

  function renderPagination(el, total, offset, limit, onOffset) {
    const totalPages = Math.ceil(total / limit) || 1;
    const page = Math.floor(offset / limit) + 1;

    let html = '';
    if (page > 1) {
      html += `<button class="btn btn-sm btn-outline-secondary" data-offset="${offset - limit}">Prev</button>`;
    }
    html += `<span class="px-2 small text-muted">${page} / ${totalPages}</span>`;
    if (page < totalPages) {
      html += `<button class="btn btn-sm btn-outline-secondary" data-offset="${offset + limit}">Next</button>`;
    }

    el.innerHTML = html;
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => onOffset(Number(btn.dataset.offset)));
    });
  }

  alarmsApply.addEventListener('click', () => { alarmsOffset = 0; loadAlarms(); });
  readingsApply.addEventListener('click', () => { readingsOffset = 0; loadReadings(); });
  alarmsSearch.addEventListener('keyup', (e) => { if (e.key === 'Enter') loadAlarms(); });
  readingsSearch.addEventListener('keyup', (e) => { if (e.key === 'Enter') loadReadings(); });

  return {
    rebuildDeviceSelects,
    loadAlarms,
    loadReadings,
    show: () => {
      rebuildDeviceSelects();
      loadAlarms();
      loadReadings();
    }
  };
}
