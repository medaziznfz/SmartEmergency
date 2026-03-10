/**
 * SmartEmergency - Main entry point
 * Tab navigation, shared state, initial data load
 */
import { initDashboard } from './js/dashboard.js';
import { initHistory } from './js/history.js';
import { initConfig } from './js/config.js';

const socket = io();

const state = {
  deviceState: new Map(),
  deviceSeries: new Map(),
  lastAlarmState: new Map(),
  deviceMeta: new Map()  // uid -> { last_ip, last_rssi, last_seen, is_online, thresholds... }
};

function pushSeries(uid, r) {
  if (!state.deviceSeries.has(uid)) state.deviceSeries.set(uid, []);
  const arr = state.deviceSeries.get(uid);
  arr.push({ ts: r.ts, t: r.t, h: r.h, g: r.g });
  if (arr.length > 60) arr.shift();
}

function rebuildDeviceSelects() {
  dashboard.rebuildSelect();
  history.rebuildDeviceSelects();
  config.rebuildDeviceSelect();
}

let dashboard;
let history;
let config;

function initTabs() {
  const navLinks = document.querySelectorAll('.tab-nav .nav-link');
  const panes = document.querySelectorAll('.tab-pane');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.dataset.tab;

      navLinks.forEach(l => l.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      link.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');

      if (tab === 'history' && history?.show) history.show();
      if (tab === 'config' && config?.show) config.show();
    });
  });
}

async function loadInitialData() {
  const devices = await fetch('/api/devices?withThresholds=1').then(r => r.json());

  for (const d of devices) {
    state.deviceMeta.set(d.uid, {
      last_ip: d.last_ip,
      last_rssi: d.last_rssi,
      last_seen: d.last_seen,
      is_online: d.is_online,
      system_mode: d.system_mode,
      gas_threshold: d.gas_threshold,
      gas_enabled: d.gas_enabled,
      temp_threshold: d.temp_threshold,
      temp_enabled: d.temp_enabled,
      flame_enabled: d.flame_enabled,
      humidity_low_threshold: d.humidity_low_threshold,
      humidity_high_threshold: d.humidity_high_threshold,
      humidity_enabled: d.humidity_enabled,
      config_pull_interval_sec: d.config_pull_interval_sec
    });

    const latest = await fetch(`/api/devices/${d.uid}/latest`).then(r => r.json());
    if (!latest) continue;

    const normalized = {
      uid: d.uid,
      label: d.label || latest.label,
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

    state.deviceState.set(d.uid, normalized);
    pushSeries(d.uid, normalized);
    state.lastAlarmState.set(d.uid, Number(latest.alarm) || 0);
  }

  rebuildDeviceSelects();

  const uid = document.getElementById('dashboard-device-select')?.value;
  if (uid) {
    dashboard?.updateBadge?.(uid);
    dashboard?.updateChart?.(uid);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  dashboard = initDashboard(socket, state);
  history = initHistory(socket, state);
  config = initConfig(socket, state);

  loadInitialData().then(() => {
    const uid = document.getElementById('dashboard-device-select')?.value;
    if (uid) {
      dashboard.updateBadge(uid);
      dashboard.updateChart(uid);
      
      // Update mode badge based on first device's system mode
      const meta = state.deviceMeta.get(uid);
      if (meta && meta.system_mode !== undefined) {
        dashboard.updateModeBadge(meta.system_mode);
      }
    }
  });
});

// Realtime updates
socket.on('reading', (r) => {
  if (r.ip != null || r.rssi != null || r.thresholds) {
    const meta = state.deviceMeta.get(r.uid) || {};
    if (r.ip != null) meta.last_ip = r.ip;
    if (r.rssi != null) meta.last_rssi = r.rssi;
    if (r.thresholds) Object.assign(meta, r.thresholds);
    state.deviceMeta.set(r.uid, meta);
  }
  state.deviceState.set(r.uid, r);
  pushSeries(r.uid, r);

  rebuildDeviceSelects();
  dashboard?.refresh?.();

  const uid = document.getElementById('dashboard-device-select')?.value;
  if (uid === r.uid) {
    dashboard?.updateBadge?.(r.uid);
    dashboard?.updateChart?.(r.uid);
  }

  const prev = state.lastAlarmState.get(r.uid) ?? 0;
  const now = Number(r.alarm) ?? 0;
  if (prev !== now) {
    state.lastAlarmState.set(r.uid, now);
    if (document.getElementById('dashboard-device-select')?.value === r.uid) {
      dashboard?.updateBadge?.(r.uid);
    }
  }
});
