/**
 * Config tab: per-device thresholds (all with active/inactive), buzzer, red light
 */
export function initConfig(socket, state) {
  const deviceSelect = document.getElementById('config-device-select');
  const gasEnabledCheck = document.getElementById('config-gas-enabled');
  const gasInput = document.getElementById('config-gas');
  const tempEnabledCheck = document.getElementById('config-temp-enabled');
  const tempInput = document.getElementById('config-temp');
  const flameCheck = document.getElementById('config-flame');
  const humidityEnabledCheck = document.getElementById('config-humidity-enabled');
  const humLowInput = document.getElementById('config-hum-low');
  const humHighInput = document.getElementById('config-hum-high');
  const buzzerCheck = document.getElementById('config-buzzer-enabled');
  const redLightCheck = document.getElementById('config-red-light-enabled');
  const pullIntervalInput = document.getElementById('config-pull-interval');
  const saveBtn = document.getElementById('config-save');
  const msgEl = document.getElementById('config-msg');
  const appliedInfoEl = document.getElementById('config-applied-info');

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

  async function loadThresholds(uid) {
    msgEl.textContent = '';
    const r = await fetch(`/api/devices/${uid}/thresholds`);
    const j = await r.json();
    if (!j?.ok) {
      msgEl.textContent = 'Failed to load thresholds.';
      return;
    }

    gasEnabledCheck.checked = Number(j.gas_enabled) === 1;
    gasInput.value = j.gas_threshold;

    tempEnabledCheck.checked = Number(j.temp_enabled) === 1;
    tempInput.value = j.temp_threshold;

    flameCheck.checked = Number(j.flame_enabled) === 1;

    humidityEnabledCheck.checked = Number(j.humidity_enabled) === 1;
    humLowInput.value = j.humidity_low_threshold;
    humHighInput.value = j.humidity_high_threshold;

    buzzerCheck.checked = Number(j.buzzer_enabled) === 1;
    redLightCheck.checked = Number(j.red_light_enabled) === 1;

    const pullSec = Number(j.config_pull_interval_sec) || 30;
    pullIntervalInput.value = pullSec;

    updateAppliedInfo(pullSec, j.updated_at);
  }

  function updateAppliedInfo(pullSec, updatedAt) {
    if (!appliedInfoEl) return;
    const sec = pullSec || Number(pullIntervalInput?.value) || 30;
    let html = `Device pulls config every <strong>${sec}s</strong>. Config is applied when the device next checks (within ${sec}s).`;
    if (updatedAt) {
      const t = new Date(updatedAt).toLocaleString();
      html = `Last saved: <strong>${t}</strong>. ` + html;
    }
    appliedInfoEl.innerHTML = html;
  }

  deviceSelect.addEventListener('change', async () => {
    const uid = deviceSelect.value;
    if (uid) await loadThresholds(uid);
  });

  saveBtn.addEventListener('click', async () => {
    const uid = deviceSelect.value;
    if (!uid) return;

    const pullSec = Math.min(600, Math.max(5, Number(pullIntervalInput.value) || 30));

    const body = {
      gas_threshold: Number(gasInput.value),
      gas_enabled: gasEnabledCheck.checked ? 1 : 0,
      temp_threshold: Number(tempInput.value),
      temp_enabled: tempEnabledCheck.checked ? 1 : 0,
      flame_enabled: flameCheck.checked ? 1 : 0,
      humidity_enabled: humidityEnabledCheck.checked ? 1 : 0,
      humidity_low_threshold: Number(humLowInput.value),
      humidity_high_threshold: Number(humHighInput.value),
      buzzer_enabled: buzzerCheck.checked ? 1 : 0,
      red_light_enabled: redLightCheck.checked ? 1 : 0,
      config_pull_interval_sec: pullSec
    };

    msgEl.textContent = 'Saving...';
    msgEl.className = 'mt-2 small text-muted';

    const r = await fetch(`/api/devices/${uid}/thresholds`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      msgEl.textContent = `❌ Save failed: ${j.error || r.statusText}`;
      msgEl.className = 'mt-2 small text-danger';
      return;
    }

    msgEl.textContent = '✅ Saved.';
    msgEl.className = 'mt-2 small text-success';

    updateAppliedInfo(pullSec, new Date().toISOString());
    if (state.deviceMeta) {
      const meta = state.deviceMeta.get(uid);
      if (meta) meta.config_pull_interval_sec = pullSec;
    }
    
    // Reload thresholds to ensure the input shows the saved value
    await loadThresholds(uid);
  });

  return {
    rebuildDeviceSelect,
    loadThresholds,
    show: async () => {
      rebuildDeviceSelect();
      const uid = deviceSelect.value;
      if (uid) await loadThresholds(uid);
    }
  };
}
