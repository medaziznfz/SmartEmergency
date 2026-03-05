/**
 * SmartEmergency Predictive Alarm System
 * Probability-based early warning with trend analysis
 * Gas prediction is gated: it only triggers when there is a big modification.
 */

class PredictiveAlarmSystem {
  constructor() {
    // No complex calculations needed - showing real-time data only
  }

  /**
   * Generate prediction based on sensor position relative to thresholds
   * Risk increases as sensors approach thresholds
   * Time decreases as sensors get closer to triggering alarm
   */
  generatePrediction(currentReading, history, thresholds) {
    if (!currentReading) {
      return this.getDefaultPrediction();
    }

    // Get current state with position information
    const currentState = this.getCurrentState(currentReading, thresholds);
    
    // Calculate overall position (how close to ANY threshold)
    const maxPosition = this.calculateMaxPosition(currentState);
    
    // Risk level based on position (0-1 scale)
    const riskLevel = this.calculateRiskFromPosition(maxPosition);
    
    // Time to alarm based on position and rate of change
    const timeToAlarm = this.calculateTimeToAlarm(currentState, maxPosition, history);
    
    // Probability is the same as position (closer = higher %)
    const probabilities = this.calculateProbabilitiesFromPosition(currentState);

    return {
      timestamp: new Date().toISOString(),
      riskLevel,
      probabilities,
      timeToAlarm,
      analysis: currentState,
      confidence: this.calculateConfidence(maxPosition),
      recommendations: this.generateRecommendations(riskLevel, currentState, timeToAlarm)
    };
  }

  /**
   * Get current state with position relative to SAFE BASELINE
   * Position starts from safe point, not from 0
   */
  getCurrentState(currentReading, thresholds) {
    const gas = currentReading.g || 0;
    const temp = currentReading.t || 0;
    const humidity = currentReading.h || 0;
    const flame = currentReading.f !== undefined ? currentReading.f : 1;

    return {
      gas: {
        current: gas,
        threshold: thresholds.gas_threshold || 400,
        safeBaseline: this.getSafeBaseline('gas', thresholds), // Store safe baseline
        enabled: !!thresholds.gas_enabled,
        // Position: 0 = at safe baseline, 1 = at/past threshold
        position: this.calculatePositionFromBaseline(
          gas, 
          this.getSafeBaseline('gas', thresholds),
          thresholds.gas_threshold || 400
        ),
        status: gas >= (thresholds.gas_threshold || 400) ? 'ALARM' : 'NORMAL'
      },
      temperature: {
        current: temp,
        threshold: thresholds.temp_threshold || 60,
        safeBaseline: this.getSafeBaseline('temperature', thresholds),
        enabled: !!thresholds.temp_enabled,
        position: this.calculatePositionFromBaseline(
          temp,
          this.getSafeBaseline('temperature', thresholds),
          thresholds.temp_threshold || 60
        ),
        status: temp >= (thresholds.temp_threshold || 60) ? 'ALARM' : 'NORMAL'
      },
      humidity: {
        current: humidity,
        lowThreshold: thresholds.humidity_low_threshold || 20,
        highThreshold: thresholds.humidity_high_threshold || 80,
        enabled: !!thresholds.humidity_enabled,
        safeBaselineLow: thresholds.humidity_low_threshold || 20,
        safeBaselineHigh: thresholds.humidity_high_threshold || 80,
        // For range: position based on which boundary we're closer to (from safe zone)
        position: this.calculateHumidityPosition(
          humidity, 
          thresholds.humidity_low_threshold || 20,
          thresholds.humidity_high_threshold || 80
        ),
        status: (humidity < (thresholds.humidity_low_threshold || 20) || 
                humidity > (thresholds.humidity_high_threshold || 80)) ? 'ALARM' : 'NORMAL'
      },
      flame: {
        current: flame,
        detected: flame === 0,
        enabled: !!thresholds.flame_enabled,
        position: flame === 0 ? 1 : 0,
        status: flame === 0 ? 'DETECTED' : 'NORMAL'
      }
    };
  }

  /**
   * Get safe baseline for each sensor from database or defaults
   */
  getSafeBaseline(sensorType, thresholds) {
    // First check if baseline is stored in thresholds (from database)
    const dbBaselines = {
      gas: thresholds.gas_safe_baseline,
      temperature: thresholds.temp_safe_baseline,
      humidity: (thresholds.humidity_safe_baseline_low + thresholds.humidity_safe_baseline_high) / 2
    };
    
    // If exists in DB, use it
    if (dbBaselines[sensorType] !== undefined && dbBaselines[sensorType] !== null) {
      return Number(dbBaselines[sensorType]);
    }
    
    // Fallback to sensible defaults based on typical safe levels
    const defaultBaselines = {
      gas: Math.round((thresholds.gas_threshold || 400) * 0.25), // 25% of threshold
      temperature: 25, // Room temperature ~25°C
      humidity: ((thresholds.humidity_low_threshold || 20) + (thresholds.humidity_high_threshold || 80)) / 2 // Midpoint
    };
    
    return defaultBaselines[sensorType] || 0;
  }

  /**
   * Calculate position from safe baseline to threshold
   * Formula: (current - baseline) / (threshold - baseline)
   * Result: 0 = at baseline (safe), 1 = at threshold (alarm)
   */
  calculatePositionFromBaseline(current, baseline, threshold) {
    const safeRange = threshold - baseline;
    
    if (safeRange <= 0) return 0;
    
    // If below baseline, position is 0 (very safe)
    if (current <= baseline) return 0;
    
    // If at or above threshold, position is 1 (alarm)
    if (current >= threshold) return 1;
    
    // Calculate position from baseline to threshold
    const distanceFromBaseline = current - baseline;
    return Math.min(1, distanceFromBaseline / safeRange);
  }

  /**
   * Calculate humidity position (0-1 scale)
   * 0 = at midpoint (safest), 1 = at or beyond boundaries
   */
  calculateHumidityPosition(current, low, high) {
    const midPoint = (low + high) / 2;
    const halfRange = (high - low) / 2;
    
    // If outside range, return 1 (critical)
    if (current < low || current > high) {
      return 1;
    }
    
    // Calculate distance from midpoint as a ratio
    const distFromMid = Math.abs(current - midPoint);
    return Math.min(1, distFromMid / halfRange);
  }

  /**
   * Find the maximum position across all enabled sensors
   * This represents how close we are to ANY alarm
   */
  calculateMaxPosition(state) {
    let maxPos = 0;
    
    if (state.gas.enabled) {
      maxPos = Math.max(maxPos, state.gas.position);
    }
    if (state.temperature.enabled) {
      maxPos = Math.max(maxPos, state.temperature.position);
    }
    if (state.humidity.enabled) {
      maxPos = Math.max(maxPos, state.humidity.position);
    }
    if (state.flame.enabled) {
      maxPos = Math.max(maxPos, state.flame.position);
    }
    
    return maxPos;
  }

  /**
   * Calculate risk level based on position (0-1 scale)
   * Higher position = higher risk
   */
  calculateRiskFromPosition(position) {
    if (position >= 1) return "CRITICAL";
    if (position >= 0.8) return "HIGH";
    if (position >= 0.6) return "MEDIUM";
    if (position >= 0.3) return "LOW";
    return "MINIMAL";
  }

  /**
   * Calculate probabilities from position
   * Each sensor's probability = its position (0-1)
   */
  calculateProbabilitiesFromPosition(state) {
    const probabilities = {};
    
    probabilities.gas = state.gas.enabled ? state.gas.position : 0;
    probabilities.temperature = state.temperature.enabled ? state.temperature.position : 0;
    probabilities.humidity = state.humidity.enabled ? state.humidity.position : 0;
    probabilities.flame = state.flame.enabled ? state.flame.position : 0;
    
    // Overall = max of all sensors (closest to alarm)
    probabilities.overall = Math.max(
      probabilities.gas,
      probabilities.temperature,
      probabilities.humidity,
      probabilities.flame
    );
    
    return probabilities;
  }

  /**
   * Calculate time to alarm based on rate of change (derivation)
   * Uses simple linear extrapolation: time = distance / rate
   */
  calculateTimeToAlarm(state, maxPosition, history) {
    // If already at threshold, time is 0
    if (maxPosition >= 1) {
      return 0;
    }
    
    // Need at least 2 readings to calculate rate of change
    if (!history || history.length < 2) {
      return null; // Can't estimate without enough history
    }
    
    // Get the most critical sensor (highest position)
    const criticalSensor = this.getCriticalSensor(state);
    if (!criticalSensor) {
      return null;
    }
    
    // Extract last 2 readings for this sensor
    const currentVal = criticalSensor.current;
    const prevReading = history[history.length - 2];
    const prevVal = this.getSensorValue(prevReading, criticalSensor.name);
    
    if (prevVal === null || prevVal === undefined) {
      return null;
    }
    
    // Calculate rate of change (derivation)
    const rateOfChange = currentVal - prevVal; // Change per reading interval
    
    // If not moving toward threshold or rate is too small, no reliable estimate
    if (rateOfChange <= 0.1) {
      return null;
    }
    
    // Calculate remaining distance to threshold
    const threshold = criticalSensor.threshold;
    const remaining = threshold - currentVal;
    
    if (remaining <= 0) {
      return 0; // Already there
    }
    
    // Simple linear time estimation: t = distance / rate
    const intervalsToAlarm = remaining / rateOfChange;
    
    // Convert to seconds (assuming ~1 second between readings)
    const secondsToAlarm = Math.round(intervalsToAlarm);
    
    return Math.max(0, secondsToAlarm);
  }

  /**
   * Get the sensor with highest position (closest to alarm)
   */
  getCriticalSensor(state) {
    let maxPos = 0;
    let criticalSensor = null;
    
    if (state.gas.enabled && state.gas.position > maxPos) {
      maxPos = state.gas.position;
      criticalSensor = { name: 'gas', current: state.gas.current, threshold: state.gas.threshold };
    }
    if (state.temperature.enabled && state.temperature.position > maxPos) {
      maxPos = state.temperature.position;
      criticalSensor = { name: 'temperature', current: state.temperature.current, threshold: state.temperature.threshold };
    }
    if (state.humidity.enabled && state.humidity.position > maxPos) {
      maxPos = state.humidity.position;
      criticalSensor = { name: 'humidity', current: state.humidity.current, threshold: state.humidity.highThreshold };
    }
    if (state.flame.enabled && state.flame.position > maxPos) {
      maxPos = state.flame.position;
      criticalSensor = { name: 'flame', current: state.flame.current, threshold: 0 };
    }
    
    return criticalSensor;
  }

  /**
   * Get sensor value from reading object
   */
  getSensorValue(reading, sensorName) {
    if (!reading) return null;
    
    switch(sensorName) {
      case 'gas': return reading.g;
      case 'temperature': return reading.t;
      case 'humidity': return reading.h;
      case 'flame': return reading.f;
      default: return null;
    }
  }

  /**
   * Calculate confidence based on position
   * Higher position = higher confidence in prediction
   */
  calculateConfidence(maxPosition) {
    // Confidence increases as we approach threshold
    // At 0% position = 50% confidence, at 100% position = 100% confidence
    return Math.max(0.5, Math.min(1, 0.5 + (maxPosition * 0.5)));
  }

  /**
   * Generate recommendations based on risk level and time to alarm
   */
  generateRecommendations(riskLevel, state, timeToAlarm) {
    const recommendations = [];

    // Add specific sensor warnings based on position
    if (state.gas.position >= 0.8 && state.gas.enabled) {
      recommendations.push({
        priority: "URGENT",
        message: `Gas at ${Math.round(state.gas.position * 100)}% of threshold (${state.gas.current}/${state.gas.threshold})`,
        action: "Critical level - check for gas leaks immediately"
      });
    } else if (state.gas.position >= 0.5 && state.gas.enabled) {
      recommendations.push({
        priority: "WARNING",
        message: `Gas rising: ${Math.round(state.gas.position * 100)}% to threshold`,
        action: "Monitor closely and ensure ventilation"
      });
    }

    if (state.temperature.position >= 0.8 && state.temperature.enabled) {
      recommendations.push({
        priority: "URGENT",
        message: `Temperature at ${Math.round(state.temperature.position * 100)}% of threshold (${state.temperature.current}°C/${state.temperature.threshold}°C)`,
        action: "Critical temperature - check cooling systems"
      });
    } else if (state.temperature.position >= 0.5 && state.temperature.enabled) {
      recommendations.push({
        priority: "WARNING",
        message: `Temperature rising: ${Math.round(state.temperature.position * 100)}% to limit`,
        action: "Check heat sources and ventilation"
      });
    }

    if (state.humidity.position >= 0.8 && state.humidity.enabled) {
      const low = state.humidity.lowThreshold;
      const high = state.humidity.highThreshold;
      const current = state.humidity.current;
      
      if (current > (low + high) / 2) {
        recommendations.push({
          priority: "URGENT",
          message: `Humidity too high: ${Math.round(state.humidity.position * 100)}% (${current}%/${high}%)`,
          action: "Improve ventilation or use dehumidifier"
        });
      } else {
        recommendations.push({
          priority: "URGENT",
          message: `Humidity too low: ${Math.round(state.humidity.position * 100)}% (${current}%/${low}%)`,
          action: "Consider adding humidification"
        });
      }
    }

    if (state.flame.position >= 1 && state.flame.enabled) {
      recommendations.push({
        priority: "CRITICAL",
        message: "FLAME DETECTED!",
        action: "Immediate action required - fire emergency!"
      });
    } else if (state.flame.position >= 0.5 && state.flame.enabled) {
      recommendations.push({
        priority: "WARNING",
        message: "Intermittent flame detection",
        action: "Inspect for fire hazards"
      });
    }

    // Add time-based warning
    if (timeToAlarm !== null && timeToAlarm !== undefined && timeToAlarm > 0) {
      if (timeToAlarm < 30) {
        recommendations.push({
          priority: "CRITICAL",
          message: `ALARM IMMINENT in ~${timeToAlarm} seconds!`,
          action: "Take immediate action!"
        });
      } else if (timeToAlarm < 60) {
        recommendations.push({
          priority: "HIGH",
          message: `Alarm possible in ~${timeToAlarm} seconds`,
          action: "Prepare safety measures now"
        });
      } else if (timeToAlarm < 300) {
        const minutes = Math.round(timeToAlarm / 60);
        recommendations.push({
          priority: "MEDIUM",
          message: `Risk increasing - alarm in ~${minutes} minute(s)`,
          action: "Monitor closely and investigate cause"
        });
      }
    }

    // General risk level recommendation
    if (riskLevel === "CRITICAL" && recommendations.length === 0) {
      recommendations.push({
        priority: "CRITICAL",
        message: "Critical risk level detected",
        action: "Immediate action required"
      });
    } else if (riskLevel === "HIGH" && recommendations.length === 0) {
      recommendations.push({
        priority: "HIGH",
        message: "High risk - sensors approaching thresholds",
        action: "Investigate and take corrective action"
      });
    } else if (riskLevel === "MEDIUM" && recommendations.length === 0) {
      recommendations.push({
        priority: "MEDIUM",
        message: "Elevated risk levels",
        action: "Continue monitoring"
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: "INFO",
        message: "All sensors within safe range",
        action: "Continue normal monitoring"
      });
    }

    return recommendations;
  }

  getDefaultPrediction() {
    return {
      timestamp: new Date().toISOString(),
      riskLevel: "MINIMAL",
      probabilities: {
        gas: 0,
        temperature: 0,
        humidity: 0,
        flame: 0,
        overall: 0
      },
      timeToAlarm: null,
      analysis: null,
      confidence: 0,
      recommendations: [
        {
          priority: "INFO",
          message: "No sensor data available",
          action: "Waiting for sensor readings"
        }
      ]
    };
  }
}

export default PredictiveAlarmSystem;