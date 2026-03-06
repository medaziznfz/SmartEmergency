/**
 * Frontend prediction visualization for SmartEmergency
 * Handles updating prediction displays in device widgets
 */

class PredictionDisplay {
  constructor() {
    this.riskColors = {
      'MINIMAL': '#198754',
      'LOW': '#0d6efd', 
      'MEDIUM': '#ffc107',
      'HIGH': '#fd7e14',
      'CRITICAL': '#dc3545'
    };

    // Keep last known alarm ETA while risk remains present.
    this.lastEtaByUid = new Map();
  }

  /**
   * Update prediction display for a device
   * @param {string} uid - Device UID
   * @param {Object} prediction - Prediction data from backend
   */
  updatePrediction(uid, prediction) {
    // Check if prediction section exists, if not, try to create it
    if (!this.ensurePredictionSection(uid)) {
      return;
    }
    
    if (!prediction) {
      this.clearPrediction(uid);
      return;
    }

    // Update confidence
    this.updateConfidence(uid, prediction.confidence);
    
    // Update risk level
    this.updateRiskLevel(uid, prediction.riskLevel, prediction.probabilities.overall);
    
    // Update time to alarm
    this.updateTimeToAlarm(uid, prediction.timeToAlarm, prediction.probabilities?.overall, prediction.riskLevel);
    
    // Update probabilities
    this.updateProbabilities(uid, prediction.probabilities);
    
    // Update recommendations
    this.updateRecommendations(uid, prediction.recommendations);
  }

  /**
   * Ensure prediction section exists for device
   * @param {string} uid - Device UID
   * @returns {boolean} - True if section exists or was created
   */
  ensurePredictionSection(uid) {
    const predictionSection = document.getElementById(`prediction-${uid}`);
    if (predictionSection) {
      return true; // Section already exists
    }
    
    // Try to find the device card and add prediction section
    const deviceCard = document.querySelector(`[data-device-uid="${uid}"]`);
    if (!deviceCard) {
      return false;
    }

    // Create prediction section HTML
    const predictionHTML = `
      <div class="prediction-section mt-3" id="prediction-${uid}">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <span class="prediction-title small fw-bold">Predictive Analysis</span>
          <span class="prediction-confidence badge bg-secondary small" id="confidence-${uid}">--%</span>
        </div>
        <div class="prediction-risk mb-2">
          <div class="d-flex justify-content-between align-items-center">
            <span class="risk-label small">Risk Level:</span>
            <span class="risk-badge badge small" id="risk-badge-${uid}">MINIMAL</span>
          </div>
          <div class="progress mt-1" style="height: 4px;">
            <div class="progress-bar risk-progress" id="risk-progress-${uid}" style="width: 0%"></div>
          </div>
        </div>
        <div class="prediction-time mb-2" id="time-to-alarm-${uid}">
          <span class="time-label small text-muted">Time to alarm: --</span>
        </div>
        <div class="prediction-probabilities row g-2 mb-2">
          <div class="col-6">
            <div class="prob-item d-flex justify-content-between">
              <span class="prob-label small text-muted">Gas:</span>
              <span class="prob-value small fw-bold" id="prob-gas-${uid}">0%</span>
            </div>
          </div>
          <div class="col-6">
            <div class="prob-item d-flex justify-content-between">
              <span class="prob-label small text-muted">Temp:</span>
              <span class="prob-value small fw-bold" id="prob-temp-${uid}">0%</span>
            </div>
          </div>
          <div class="col-6">
            <div class="prob-item d-flex justify-content-between">
              <span class="prob-label small text-muted">Hum:</span>
              <span class="prob-value small fw-bold" id="prob-hum-${uid}">0%</span>
            </div>
          </div>
          <div class="col-6">
            <div class="prob-item d-flex justify-content-between">
              <span class="prob-label small text-muted">Flame:</span>
              <span class="prob-value small fw-bold" id="prob-flame-${uid}">0%</span>
            </div>
          </div>
        </div>
        <div class="prediction-recommendations" id="recommendations-${uid}">
          <!-- Recommendations will be inserted here -->
        </div>
      </div>
    `;

    // Find where to insert the prediction section (before the footer)
    const footer = deviceCard.querySelector('.device-widget-footer');
    if (footer) {
      footer.insertAdjacentHTML('beforebegin', predictionHTML);
      return true;
    } else {
      // Fallback: append to device card content
      const cardContent = deviceCard.querySelector('.card-body');
      if (cardContent) {
        cardContent.insertAdjacentHTML('beforeend', predictionHTML);
        return true;
      }
    }

    return false;
  }

  /**
   * Update confidence display
   */
  updateConfidence(uid, confidence) {
    const confidenceEl = document.getElementById(`confidence-${uid}`);
    if (confidenceEl) {
      const percentage = Math.round(confidence * 100);
      confidenceEl.textContent = `${percentage}%`;
      confidenceEl.className = `prediction-confidence badge small ${this.getConfidenceClass(confidence)}`;
    }
  }

  /**
   * Update risk level display
   */
  updateRiskLevel(uid, riskLevel, overallProb) {
    const badgeEl = document.getElementById(`risk-badge-${uid}`);
    const progressEl = document.getElementById(`risk-progress-${uid}`);
    
    if (badgeEl) {
      badgeEl.textContent = riskLevel;
      badgeEl.className = `risk-badge badge small risk-${riskLevel}`;
    }
    
    if (progressEl) {
      const percentage = Math.round(overallProb * 100);
      progressEl.style.width = `${percentage}%`;
      progressEl.className = `progress-bar risk-progress risk-${riskLevel}`;
    }
  }

  /**
   * Update time to alarm display with enhanced formatting
   */
  updateTimeToAlarm(uid, timeToAlarm, overallProb = 0, riskLevel = 'MINIMAL') {
    const timeEl = document.getElementById(`time-to-alarm-${uid}`);
    if (!timeEl) return;
    
    const riskStillPresent = (Number(overallProb) || 0) >= 0.3 && riskLevel !== 'MINIMAL';

    // If backend provided a value, always store it.
    if (timeToAlarm !== null && timeToAlarm !== undefined) {
      this.lastEtaByUid.set(uid, Number(timeToAlarm));
    } else if (!riskStillPresent) {
      // Risk is gone → clear any previous ETA.
      this.lastEtaByUid.delete(uid);
    }

    const effectiveEta = (timeToAlarm !== null && timeToAlarm !== undefined)
      ? Number(timeToAlarm)
      : (riskStillPresent ? this.lastEtaByUid.get(uid) : null);

    if (effectiveEta === null || effectiveEta === undefined || Number.isNaN(effectiveEta)) {
      timeEl.innerHTML = '<span class="time-label small text-muted">Time to alarm: --</span>';
      return;
    }

    // Format time with appropriate detail level
    const formattedTime = this.formatTimeToAlarm(effectiveEta);
    const urgencyClass = this.getTimeUrgencyClass(effectiveEta);
    const icon = this.getTimeIcon(effectiveEta);
    
    timeEl.innerHTML = `
      <div class="d-flex align-items-center justify-content-between">
        <span class="time-label small ${urgencyClass}">${icon} Time to alarm:</span>
        <span class="time-value small fw-bold ${urgencyClass}">${formattedTime}</span>
      </div>
    `;
  }

  /**
   * Format time to alarm - always show in seconds for countdown effect
   */
  formatTimeToAlarm(seconds) {
    if (seconds <= 0) {
      return 'NOW!';
    } else if (seconds < 60) {
      // Show exact seconds for countdown
      return `${seconds}s`;
    } else if (seconds < 120) {
      // Show "1m Xs" format for 1-2 minutes
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else if (seconds < 600) {
      // Show minutes and seconds for under 10 minutes
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    } else if (seconds < 3600) {
      // Show just minutes for 10-60 minutes
      const minutes = Math.round(seconds / 60);
      return `~${minutes} min`;
    } else {
      // Show hours for longer times
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      if (minutes > 0 && hours < 3) {
        return `${hours}h ${minutes}m`;
      }
      return `~${hours} hour${hours > 1 ? 's' : ''}`;
    }
  }

  /**
   * Get urgency class based on time remaining
   */
  getTimeUrgencyClass(seconds) {
    if (seconds <= 0) return 'text-danger fw-bold blink';
    if (seconds < 10) return 'text-danger fw-bold blink';
    if (seconds < 30) return 'text-danger fw-bold';
    if (seconds < 60) return 'text-warning fw-bold';
    if (seconds < 300) return 'text-warning';
    if (seconds < 3600) return 'text-info';
    return 'text-muted';
  }

  /**
   * Get icon based on time urgency
   */
  getTimeIcon(seconds) {
    if (seconds <= 0) return '🚨';
    if (seconds < 10) return '🚨';
    if (seconds < 30) return '⚠️';
    if (seconds < 60) return '⏰';
    if (seconds < 300) return '⏱️';
    if (seconds < 3600) return '🕐';
    return '📊';
  }

  /**
   * Update probability displays
   */
  updateProbabilities(uid, probabilities) {
    const sensors = ['gas', 'temp', 'hum', 'flame'];
    const sensorNames = {
      'gas': 'gas',
      'temp': 'temperature', 
      'hum': 'humidity',
      'flame': 'flame'
    };

    sensors.forEach(sensor => {
      const probEl = document.getElementById(`prob-${sensor}-${uid}`);
      const probValue = probabilities[sensorNames[sensor]];
      
      if (probEl && probValue !== undefined) {
        const prob = Math.round(probValue * 100);
        probEl.textContent = `${prob}%`;
        probEl.className = `prob-value small fw-bold ${this.getProbabilityClass(prob)}`;
      }
    });
  }

  /**
   * Update recommendations display
   */
  updateRecommendations(uid, recommendations) {
    const recEl = document.getElementById(`recommendations-${uid}`);
    
    if (!recEl) {
      return;
    }
    
    if (!recommendations || recommendations.length === 0) {
      recEl.innerHTML = '';
      return;
    }

    const html = recommendations.slice(0, 3).map(rec => `
      <div class="recommendation-item recommendation-${rec.priority.toLowerCase()}">
        <div class="fw-bold">${rec.message}</div>
        <div class="small">${rec.action}</div>
      </div>
    `).join('');

    recEl.innerHTML = html;
  }

  /**
   * Clear prediction display
   */
  clearPrediction(uid) {
    const elements = [
      `confidence-${uid}`,
      `risk-badge-${uid}`,
      `risk-progress-${uid}`,
      `time-to-alarm-${uid}`,
      `recommendations-${uid}`
    ];

    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (id.includes('confidence')) {
          el.textContent = '--%';
        } else if (id.includes('risk-badge')) {
          el.textContent = 'MINIMAL';
          el.className = 'risk-badge badge small risk-MINIMAL';
        } else if (id.includes('risk-progress')) {
          el.style.width = '0%';
        } else if (id.includes('time-to-alarm')) {
          el.innerHTML = '<span class="time-label small text-muted">Time to alarm: --</span>';
        } else if (id.includes('recommendations')) {
          el.innerHTML = '';
        }
      }
    });

    // Clear probabilities
    ['gas', 'temp', 'hum', 'flame'].forEach(sensor => {
      const probEl = document.getElementById(`prob-${sensor}-${uid}`);
      if (probEl) {
        probEl.textContent = '0%';
        probEl.className = 'prob-value small fw-bold';
      }
    });
  }

  /**
   * Get confidence class based on confidence value
   */
  getConfidenceClass(confidence) {
    if (confidence >= 0.8) return 'bg-success';
    if (confidence >= 0.6) return 'bg-info';
    if (confidence >= 0.4) return 'bg-warning';
    return 'bg-secondary';
  }

  /**
   * Get probability class based on probability percentage
   */
  getProbabilityClass(prob) {
    if (prob >= 80) return 'text-danger';
    if (prob >= 60) return 'text-warning';
    if (prob >= 40) return 'text-info';
    if (prob >= 20) return 'text-primary';
    return 'text-muted';
  }

  /**
   * Animate prediction updates
   */
  animateUpdate(uid) {
    const predictionEl = document.getElementById(`prediction-${uid}`);
    if (predictionEl) {
      predictionEl.style.transition = 'all 0.3s ease';
      predictionEl.style.transform = 'scale(1.02)';
      setTimeout(() => {
        predictionEl.style.transform = 'scale(1)';
      }, 300);
    }
  }

  /**
   * Show prediction pulse for high risk
   */
  pulseHighRisk(uid) {
    const predictionEl = document.getElementById(`prediction-${uid}`);
    if (predictionEl) {
      predictionEl.style.animation = 'pulse 2s infinite';
      setTimeout(() => {
        predictionEl.style.animation = '';
      }, 10000); // Stop pulsing after 10 seconds
    }
  }
}

// Add CSS animations for countdown and pulsing
const style = document.createElement('style');
style.textContent = `
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(220, 53, 69, 0); }
    100% { box-shadow: 0 0 0 0 rgba(220, 53, 69, 0); }
  }
  
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  
  .blink {
    animation: blink 1s infinite;
  }
  
  .countdown-critical {
    font-size: 1.2em;
    font-weight: bold;
    color: #dc3545;
    animation: blink 0.5s infinite;
  }
`;
document.head.appendChild(style);

// Export for use in dashboard
export default PredictionDisplay;
