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
  const redLedFlashSpeedInput = document.getElementById('config-red-led-flash-speed');
  const pullIntervalInput = document.getElementById('config-pull-interval');
  const sendIntervalInput = document.getElementById('config-send-interval');
  const saveBtn = document.getElementById('config-save');
  const msgEl = document.getElementById('config-msg');
  const appliedInfoEl = document.getElementById('config-applied-info');

  // Mode selection elements
  const modeTrainRadio = document.getElementById('config-mode-train');
  const modeDetectionRadio = document.getElementById('config-mode-detection');
  const modeWarning = document.getElementById('config-mode-warning');
  const thresholdsSection = document.getElementById('config-thresholds-section');
  const alarmsSection = document.getElementById('config-alarms-section');

  // Threshold mode elements
  const thresholdModeSection = document.getElementById('threshold-mode-section');
  const thresholdManualRadio = document.getElementById('config-threshold-manual');
  const thresholdAISuggestRadio = document.getElementById('config-threshold-ai-suggest');
  const thresholdFullyAIRadio = document.getElementById('config-threshold-fully-ai');
  const aiSuggestionsPanel = document.getElementById('ai-suggestions-panel');
  const aiSuggestionsLoading = document.getElementById('ai-suggestions-loading');
  const aiSuggestionsContent = document.getElementById('ai-suggestions-content');
  const aiSuggestionsError = document.getElementById('ai-suggestions-error');
  const fullyAIInfo = document.getElementById('fully-ai-info');
  const aiApplyBtn = document.getElementById('ai-apply-suggestions');

  // AI suggestion display elements
  const aiConfidenceBadge = document.getElementById('ai-confidence-badge');
  const aiGasCurrent = document.getElementById('ai-gas-current');
  const aiGasSuggested = document.getElementById('ai-gas-suggested');
  const aiTempCurrent = document.getElementById('ai-temp-current');
  const aiTempSuggested = document.getElementById('ai-temp-suggested');
  const aiHumLowCurrent = document.getElementById('ai-hum-low-current');
  const aiHumLowSuggested = document.getElementById('ai-hum-low-suggested');
  const aiHumHighCurrent = document.getElementById('ai-hum-high-current');
  const aiHumHighSuggested = document.getElementById('ai-hum-high-suggested');
  const aiReasoning = document.getElementById('ai-reasoning');
  const aiDataPoints = document.getElementById('ai-data-points');
  const aiUpdateIntervalSelect = document.getElementById('config-ai-update-interval');

  // Store current AI suggestions
  let currentAISuggestions = null;

  // Fields that should be disabled in train mode
  const trainModeDisabledFields = [
    gasEnabledCheck, gasInput, tempEnabledCheck, tempInput, flameCheck,
    humidityEnabledCheck, humLowInput, humHighInput,
    buzzerCheck, redLightCheck, redLedFlashSpeedInput
  ];

  // Fields that should be disabled in fully AI mode (threshold values only)
  const thresholdValueFields = [gasInput, tempInput, humLowInput, humHighInput];

  function updateModeUI(isTrainMode) {
    // Show/hide warning
    if (modeWarning) {
      modeWarning.classList.toggle('d-none', !isTrainMode);
    }

    // Show/hide threshold mode section (only visible in detection mode)
    if (thresholdModeSection) {
      thresholdModeSection.style.display = isTrainMode ? 'none' : 'block';
    }

    // Disable/enable fields based on mode
    trainModeDisabledFields.forEach(field => {
      if (field) {
        field.disabled = isTrainMode;
      }
    });

    // Add visual indication to sections
    if (thresholdsSection) {
      thresholdsSection.style.opacity = isTrainMode ? '0.5' : '1';
      thresholdsSection.style.pointerEvents = isTrainMode ? 'none' : 'auto';
    }
    if (alarmsSection) {
      alarmsSection.style.opacity = isTrainMode ? '0.5' : '1';
      alarmsSection.style.pointerEvents = isTrainMode ? 'none' : 'auto';
    }

    // Update radio buttons
    if (modeTrainRadio && modeDetectionRadio) {
      modeTrainRadio.checked = isTrainMode;
      modeDetectionRadio.checked = !isTrainMode;
    }

    // Update system mode card active states
    document.querySelectorAll('.threshold-mode-card[data-sysmode]').forEach(card => {
      const cardMode = parseInt(card.dataset.sysmode);
      card.classList.toggle('active', isTrainMode ? cardMode === 0 : cardMode === 1);
    });

    // Hide AI panels in train mode
    if (isTrainMode) {
      if (aiSuggestionsPanel) aiSuggestionsPanel.classList.add('d-none');
      if (fullyAIInfo) fullyAIInfo.classList.add('d-none');
    }
  }

  // Threshold mode UI update
  function updateThresholdModeUI(mode) {
    // 0=manual, 1=ai_suggestion, 2=fully_ai
    const isFullyAI = mode === 2;
    const isAISuggest = mode === 1;

    // Update radio buttons
    if (thresholdManualRadio) thresholdManualRadio.checked = mode === 0;
    if (thresholdAISuggestRadio) thresholdAISuggestRadio.checked = mode === 1;
    if (thresholdFullyAIRadio) thresholdFullyAIRadio.checked = mode === 2;

    // Update card active states
    document.querySelectorAll('.threshold-mode-card').forEach(card => {
      const cardMode = parseInt(card.dataset.mode);
      card.classList.toggle('active', cardMode === mode);
    });

    // Show/hide AI panels
    if (aiSuggestionsPanel) {
      aiSuggestionsPanel.classList.toggle('d-none', !isAISuggest);
    }
    if (fullyAIInfo) {
      fullyAIInfo.classList.toggle('d-none', !isFullyAI);
    }

    // Disable threshold value inputs in fully AI mode
    thresholdValueFields.forEach(field => {
      if (field) {
        field.disabled = isFullyAI;
        field.style.opacity = isFullyAI ? '0.6' : '1';
      }
    });

    // Fetch AI suggestions if needed
    if (isAISuggest || isFullyAI) {
      const uid = deviceSelect.value;
      if (uid) fetchAISuggestions(uid, isFullyAI);
    }
  }

  // Fetch AI suggestions from server
  async function fetchAISuggestions(uid, autoApply = false) {
    if (!aiSuggestionsPanel && !autoApply) return;

    // Show loading
    if (aiSuggestionsLoading) aiSuggestionsLoading.classList.remove('d-none');
    if (aiSuggestionsContent) aiSuggestionsContent.classList.add('d-none');
    if (aiSuggestionsError) aiSuggestionsError.classList.add('d-none');

    try {
      const r = await fetch(`/api/devices/${uid}/ai-suggestions`);
      
      // Check if response is OK
      if (!r.ok) {
        throw new Error(`Server returned ${r.status}: ${r.statusText}`);
      }
      
      // Check content type
      const contentType = r.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server did not return JSON. Make sure the server is running and restart it if needed.');
      }
      
      const data = await r.json();

      if (aiSuggestionsLoading) aiSuggestionsLoading.classList.add('d-none');

      if (!data.ok) {
        showAIError('Failed to get suggestions');
        return;
      }

      if (!data.has_suggestions) {
        showAIError(data.message || 'Not enough data for suggestions');
        return;
      }

      currentAISuggestions = data.suggested;

      // Update display
      if (aiConfidenceBadge) aiConfidenceBadge.textContent = `${data.confidence}% confidence`;
      if (aiGasCurrent) aiGasCurrent.textContent = data.current.gas_threshold;
      if (aiGasSuggested) aiGasSuggested.textContent = data.suggested.gas_threshold;
      if (aiTempCurrent) aiTempCurrent.textContent = data.current.temp_threshold + '°C';
      if (aiTempSuggested) aiTempSuggested.textContent = data.suggested.temp_threshold + '°C';
      if (aiHumLowCurrent) aiHumLowCurrent.textContent = data.current.humidity_low_threshold + '%';
      if (aiHumLowSuggested) aiHumLowSuggested.textContent = data.suggested.humidity_low_threshold + '%';
      if (aiHumHighCurrent) aiHumHighCurrent.textContent = data.current.humidity_high_threshold + '%';
      if (aiHumHighSuggested) aiHumHighSuggested.textContent = data.suggested.humidity_high_threshold + '%';
      // ai-data-points is now hidden, no need to update it visually
      if (aiReasoning) aiReasoning.textContent = data.reasoning.gas;

      if (aiSuggestionsContent) aiSuggestionsContent.classList.remove('d-none');

      // Auto-apply and auto-save if fully AI mode
      if (autoApply && currentAISuggestions) {
        applyAISuggestions();
        // Auto-save in Fully AI mode
        await autoSaveThresholds();
      }

    } catch (err) {
      if (aiSuggestionsLoading) aiSuggestionsLoading.classList.add('d-none');
      showAIError('Error fetching suggestions: ' + err.message);
    }
  }

  function showAIError(message) {
    if (aiSuggestionsError) {
      aiSuggestionsError.textContent = message;
      aiSuggestionsError.classList.remove('d-none');
    }
    if (aiSuggestionsContent) aiSuggestionsContent.classList.add('d-none');
  }

  function applyAISuggestions() {
    if (!currentAISuggestions) return;

    gasInput.value = currentAISuggestions.gas_threshold;
    tempInput.value = currentAISuggestions.temp_threshold;
    humLowInput.value = currentAISuggestions.humidity_low_threshold;
    humHighInput.value = currentAISuggestions.humidity_high_threshold;

    const isFullyAI = thresholdFullyAIRadio && thresholdFullyAIRadio.checked;
    if (!isFullyAI) {
      msgEl.textContent = '✨ AI suggestions applied. Click Save to persist.';
      msgEl.className = 'mt-2 small text-info';
    }
  }

  // Auto-save function for Fully AI mode
  async function autoSaveThresholds() {
    const uid = deviceSelect.value;
    if (!uid) return;

    const pullSec = Math.min(600, Math.max(5, Number(pullIntervalInput.value) || 30));
    const sendSec = Math.min(60, Math.max(1, Number(sendIntervalInput.value) || 1));
    const redLedFlashSpeed = Math.min(2000, Math.max(50, Number(redLedFlashSpeedInput.value) || 200));
    const aiUpdateInterval = aiUpdateIntervalSelect ? Number(aiUpdateIntervalSelect.value) || 3600 : 3600;

    const systemMode = modeTrainRadio && modeTrainRadio.checked ? 0 : 1;
    let thresholdMode = 2; // Fully AI

    const body = {
      system_mode: systemMode,
      threshold_mode: thresholdMode,
      ai_update_interval_sec: aiUpdateInterval,
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
      red_led_flash_speed_ms: redLedFlashSpeed,
      config_pull_interval_sec: pullSec,
      send_interval_sec: sendSec
    };

    try {
      const r = await fetch(`/api/devices/${uid}/thresholds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        msgEl.textContent = '🤖 AI thresholds auto-applied and saved.';
        msgEl.className = 'mt-2 small text-success';
      }
    } catch (err) {
      console.error('Auto-save error:', err);
    }
  }

  // Event listener for Apply AI Suggestions button
  if (aiApplyBtn) {
    aiApplyBtn.addEventListener('click', applyAISuggestions);
  }

  // Threshold mode change event listeners
  if (thresholdManualRadio) {
    thresholdManualRadio.addEventListener('change', () => {
      if (thresholdManualRadio.checked) updateThresholdModeUI(0);
    });
  }
  if (thresholdAISuggestRadio) {
    thresholdAISuggestRadio.addEventListener('change', () => {
      if (thresholdAISuggestRadio.checked) updateThresholdModeUI(1);
    });
  }
  if (thresholdFullyAIRadio) {
    thresholdFullyAIRadio.addEventListener('change', () => {
      if (thresholdFullyAIRadio.checked) updateThresholdModeUI(2);
    });
  }

  // Mode change event listeners
  if (modeTrainRadio) {
    modeTrainRadio.addEventListener('change', () => {
      if (modeTrainRadio.checked) {
        updateModeUI(true);
      }
    });
  }
  if (modeDetectionRadio) {
    modeDetectionRadio.addEventListener('change', () => {
      if (modeDetectionRadio.checked) {
        updateModeUI(false);
      }
    });
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

  async function loadThresholds(uid) {
    msgEl.textContent = '';
    const r = await fetch(`/api/devices/${uid}/thresholds`);
    const j = await r.json();
    if (!j?.ok) {
      msgEl.textContent = 'Failed to load thresholds.';
      return;
    }

    // System mode
    const isTrainMode = Number(j.system_mode) === 0;
    updateModeUI(isTrainMode);

    // Threshold mode (only matters in detection mode)
    const thresholdMode = Number(j.threshold_mode) || 0;
    if (!isTrainMode) {
      updateThresholdModeUI(thresholdMode);
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
    redLedFlashSpeedInput.value = j.red_led_flash_speed_ms || 200;

    const pullSec = Number(j.config_pull_interval_sec) || 30;
    pullIntervalInput.value = pullSec;
    
    const sendSec = Number(j.send_interval_sec) || 1;
    sendIntervalInput.value = sendSec;

    // AI update interval (for Fully AI mode)
    const aiUpdateSec = Number(j.ai_update_interval_sec) || 3600;
    if (aiUpdateIntervalSelect) aiUpdateIntervalSelect.value = aiUpdateSec;

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
    const sendSec = Math.min(60, Math.max(1, Number(sendIntervalInput.value) || 1));
    const redLedFlashSpeed = Math.min(2000, Math.max(50, Number(redLedFlashSpeedInput.value) || 200));
    const aiUpdateInterval = aiUpdateIntervalSelect ? Number(aiUpdateIntervalSelect.value) || 3600 : 3600;

    // Get system mode from radio buttons
    const systemMode = modeTrainRadio && modeTrainRadio.checked ? 0 : 1;

    // Get threshold mode from radio buttons
    let thresholdMode = 0;
    if (thresholdAISuggestRadio && thresholdAISuggestRadio.checked) thresholdMode = 1;
    if (thresholdFullyAIRadio && thresholdFullyAIRadio.checked) thresholdMode = 2;

    const body = {
      system_mode: systemMode,
      threshold_mode: thresholdMode,
      ai_update_interval_sec: aiUpdateInterval,
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
      red_led_flash_speed_ms: redLedFlashSpeed,
      config_pull_interval_sec: pullSec,
      send_interval_sec: sendSec
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
