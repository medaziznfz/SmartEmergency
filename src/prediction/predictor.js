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
        safeBaseline: thresholds.humidity_safe_baseline || 50,
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
      humidity: thresholds.humidity_safe_baseline
    };
    
    // If exists in DB, use it
    if (dbBaselines[sensorType] !== undefined && dbBaselines[sensorType] !== null) {
      return Number(dbBaselines[sensorType]);
    }
    
    // Fallback to sensible defaults based on typical safe levels
    const defaultBaselines = {
      gas: Math.round((thresholds.gas_threshold || 400) * 0.25), // 25% of threshold
      temperature: 25, // Room temperature ~25°C
      humidity: thresholds.humidity_safe_baseline || 50 // Use stored baseline or default to 50%
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
   * Calculate time to alarm based on rate of change (trend analysis)
   * Uses calibration baseline, current value, threshold, and rate of change
   * Returns time in seconds with countdown precision
   */
  calculateTimeToAlarm(state, maxPosition, history) {
    // If already at threshold, time is 0
    if (maxPosition >= 1) {
      return 0;
    }
    
    // Need at least 3 readings for reliable trend analysis
    if (!history || history.length < 3) {
      return null;
    }
    
    // Get the most critical sensor (highest position)
    const criticalSensor = this.getCriticalSensor(state);
    if (!criticalSensor) {
      return null;
    }
    
    // Get sensor-specific data
    const sensorName = criticalSensor.name;
    const currentValue = criticalSensor.current;
    const threshold = criticalSensor.threshold;
    const baseline = criticalSensor.baseline || 0;
    
    // Extract recent readings (use last 5-10 points)
    const numPoints = Math.min(10, history.length);
    const recentHistory = history.slice(-numPoints);
    
    // Get timestamps and values
    const dataPoints = [];
    for (let i = 0; i < recentHistory.length; i++) {
      const reading = recentHistory[i];
      const value = this.getSensorValue(reading, sensorName);
      const timestamp = reading.ts ? new Date(reading.ts).getTime() : Date.now() - (numPoints - i) * 1000;
      
      if (value !== null && value !== undefined) {
        dataPoints.push({ value, timestamp });
      }
    }
    
    if (dataPoints.length < 3) {
      return null;
    }
    
    // Calculate rate of change (units per second)
    const ratePerSecond = this.calculateRateOfChange(dataPoints);
    
    // Handle different sensor types
    if (sensorName === 'humidity') {
      return this.calculateHumidityTimeToAlarm(state.humidity, dataPoints, ratePerSecond);
    }
    
    if (sensorName === 'flame') {
      // Flame is instant - either detected or not
      return currentValue === 0 ? 0 : null;
    }
    
    // For gas and temperature: calculate based on distance and rate
    // If rate is too small or negative (moving away), no alarm expected
    if (ratePerSecond <= 0.001) {
      return null;
    }
    
    // Calculate remaining distance from current to threshold
    const remainingDistance = threshold - currentValue;
    
    if (remainingDistance <= 0) {
      return 0; // Already at or past threshold
    }
    
    // Time = Distance / Rate
    const timeInSeconds = remainingDistance / ratePerSecond;
    
    // Only show if alarm is within reasonable timeframe (1 hour)
    if (timeInSeconds > 3600 || timeInSeconds < 0) {
      return null;
    }
    
    // Round to nearest second for countdown display
    return Math.round(timeInSeconds);
  }

  /**
   * Calculate rate of change in units per second
   * Uses linear regression for accuracy
   */
  calculateRateOfChange(dataPoints) {
    if (dataPoints.length < 2) {
      return 0;
    }
    
    const n = dataPoints.length;
    
    // Normalize timestamps to seconds from first point
    const t0 = dataPoints[0].timestamp;
    const normalizedPoints = dataPoints.map(p => ({
      time: (p.timestamp - t0) / 1000, // Convert to seconds
      value: p.value
    }));
    
    // Calculate means
    let sumTime = 0, sumValue = 0;
    for (let i = 0; i < n; i++) {
      sumTime += normalizedPoints[i].time;
      sumValue += normalizedPoints[i].value;
    }
    const meanTime = sumTime / n;
    const meanValue = sumValue / n;
    
    // Calculate slope (rate of change per second)
    let numerator = 0, denominator = 0;
    for (let i = 0; i < n; i++) {
      const dt = normalizedPoints[i].time - meanTime;
      const dv = normalizedPoints[i].value - meanValue;
      numerator += dt * dv;
      denominator += dt * dt;
    }
    
    const slope = denominator !== 0 ? numerator / denominator : 0;
    return slope;
  }

  /**
   * Calculate time to alarm for humidity (handles both low and high thresholds)
   */
  calculateHumidityTimeToAlarm(humidityState, dataPoints, ratePerSecond) {
    const current = humidityState.current;
    const lowThreshold = humidityState.lowThreshold;
    const highThreshold = humidityState.highThreshold;
    const baseline = humidityState.safeBaseline;
    
    // Determine which threshold we're approaching
    let targetThreshold;
    let requiredDirection;
    
    if (current < baseline) {
      // Below baseline - approaching low threshold
      targetThreshold = lowThreshold;
      requiredDirection = -1; // Must be decreasing
      
      if (ratePerSecond >= -0.001) {
        // Not decreasing or too slow
        return null;
      }
      
      const distance = current - targetThreshold;
      if (distance <= 0) return 0;
      
      const timeInSeconds = distance / Math.abs(ratePerSecond);
      return timeInSeconds > 3600 ? null : Math.round(timeInSeconds);
      
    } else if (current > baseline) {
      // Above baseline - approaching high threshold
      targetThreshold = highThreshold;
      requiredDirection = 1; // Must be increasing
      
      if (ratePerSecond <= 0.001) {
        // Not increasing or too slow
        return null;
      }
      
      const distance = targetThreshold - current;
      if (distance <= 0) return 0;
      
      const timeInSeconds = distance / ratePerSecond;
      return timeInSeconds > 3600 ? null : Math.round(timeInSeconds);
      
    } else {
      // At baseline - check which direction we're moving
      if (Math.abs(ratePerSecond) < 0.001) {
        return null; // Stable
      }
      
      if (ratePerSecond < 0) {
        // Moving down toward low threshold
        targetThreshold = lowThreshold;
        const distance = current - targetThreshold;
        const timeInSeconds = distance / Math.abs(ratePerSecond);
        return timeInSeconds > 3600 ? null : Math.round(timeInSeconds);
      } else {
        // Moving up toward high threshold
        targetThreshold = highThreshold;
        const distance = targetThreshold - current;
        const timeInSeconds = distance / ratePerSecond;
        return timeInSeconds > 3600 ? null : Math.round(timeInSeconds);
      }
    }
  }

  /**
   * Get the sensor with highest position (closest to alarm)
   * Includes baseline calibration values for accurate time calculation
   */
  getCriticalSensor(state) {
    let maxPos = 0;
    let criticalSensor = null;
    
    if (state.gas.enabled && state.gas.position > maxPos) {
      maxPos = state.gas.position;
      criticalSensor = { 
        name: 'gas', 
        current: state.gas.current, 
        threshold: state.gas.threshold,
        baseline: state.gas.safeBaseline
      };
    }
    if (state.temperature.enabled && state.temperature.position > maxPos) {
      maxPos = state.temperature.position;
      criticalSensor = { 
        name: 'temperature', 
        current: state.temperature.current, 
        threshold: state.temperature.threshold,
        baseline: state.temperature.safeBaseline
      };
    }
    if (state.humidity.enabled && state.humidity.position > maxPos) {
      maxPos = state.humidity.position;
      criticalSensor = { 
        name: 'humidity', 
        current: state.humidity.current, 
        threshold: state.humidity.highThreshold,
        baseline: state.humidity.safeBaseline,
        lowThreshold: state.humidity.lowThreshold,
        highThreshold: state.humidity.highThreshold
      };
    }
    if (state.flame.enabled && state.flame.position > maxPos) {
      maxPos = state.flame.position;
      criticalSensor = { 
        name: 'flame', 
        current: state.flame.current, 
        threshold: 0,
        baseline: 1 // Normal state is 1 (no flame)
      };
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
    // Confidence follows position directly: 0%..100% (no artificial 50% floor)
    return Math.max(0, Math.min(1, Number(maxPosition) || 0));
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

    // Add time-based warning with countdown emphasis
    if (timeToAlarm !== null && timeToAlarm !== undefined && timeToAlarm >= 0) {
      let timeMessage, timeAction, priority;
      
      if (timeToAlarm === 0) {
        timeMessage = `🚨 ALARM TRIGGERED NOW!`;
        timeAction = "IMMEDIATE EMERGENCY ACTION!";
        priority = "CRITICAL";
      } else if (timeToAlarm <= 10) {
        timeMessage = `🚨 ALARM IN ${timeToAlarm} SECONDS!`;
        timeAction = "EVACUATE OR TAKE IMMEDIATE ACTION!";
        priority = "CRITICAL";
      } else if (timeToAlarm <= 30) {
        timeMessage = `⚠️ ALARM IN ${timeToAlarm} SECONDS`;
        timeAction = "Take immediate preventive action now!";
        priority = "CRITICAL";
      } else if (timeToAlarm < 60) {
        timeMessage = `⏰ Alarm in ${timeToAlarm} seconds`;
        timeAction = "Prepare safety measures immediately";
        priority = "HIGH";
      } else if (timeToAlarm < 120) {
        const minutes = Math.floor(timeToAlarm / 60);
        const seconds = timeToAlarm % 60;
        timeMessage = `⏱️ Alarm in ${minutes}m ${seconds}s`;
        timeAction = "Monitor closely and take preventive action";
        priority = "HIGH";
      } else if (timeToAlarm < 600) {
        const minutes = Math.floor(timeToAlarm / 60);
        const seconds = timeToAlarm % 60;
        timeMessage = `Risk increasing - alarm in ${minutes}m ${seconds}s`;
        timeAction = "Investigate cause and address issue";
        priority = "MEDIUM";
      } else if (timeToAlarm < 3600) {
        const minutes = Math.round(timeToAlarm / 60);
        timeMessage = `Trend detected - alarm possible in ~${minutes} minutes`;
        timeAction = "Monitor situation and address root cause";
        priority = "MEDIUM";
      } else {
        const hours = Math.round(timeToAlarm / 3600);
        timeMessage = `Long-term trend - alarm possible in ~${hours} hour(s)`;
        timeAction = "Continue monitoring";
        priority = "LOW";
      }
      
      recommendations.push({
        priority: priority,
        message: timeMessage,
        action: timeAction
      });
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