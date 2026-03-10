/**
 * SmartEmergency Predictive Alarm System v2.0
 * Advanced prediction with trend analysis, EWMA smoothing, and acceleration detection
 * Uses statistical methods for reliable time-to-alarm estimation
 */

class PredictiveAlarmSystem {
  constructor() {
    // Configuration for prediction sensitivity
    this.config = {
      // Minimum readings required for trend analysis
      minReadingsForTrend: 5,
      // Maximum readings to analyze (sliding window)
      maxReadingsWindow: 30,
      // EWMA smoothing factor (0.1 = smooth, 0.5 = responsive)
      ewmaAlpha: 0.3,
      // Minimum rate of change to consider (per second) - reduces noise
      minRateThreshold: {
        gas: 0.05,      // 0.05 units/sec = 3 units/min
        temperature: 0.005, // 0.005°C/sec = 0.3°C/min
        humidity: 0.01  // 0.01%/sec = 0.6%/min
      },
      // Trend consistency threshold (0-1, higher = stricter)
      trendConsistencyThreshold: 0.6,
      // Maximum prediction window (seconds)
      maxPredictionWindow: 3600, // 1 hour
      // Minimum prediction window to show (seconds)
      minPredictionWindow: 10
    };
  }

  /**
   * Generate prediction based on sensor position relative to thresholds
   * Enhanced with trend analysis, smoothing, and per-sensor time estimates
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
    
    // Enhanced: Analyze trends for each sensor
    const trendAnalysis = this.analyzeTrends(currentState, history);
    
    // Enhanced: Calculate per-sensor time to alarm with confidence
    const sensorPredictions = this.calculateSensorPredictions(currentState, trendAnalysis);
    
    // Get the most critical time to alarm
    const timeToAlarm = this.getMostCriticalTimeToAlarm(sensorPredictions);
    
    // Probability is the same as position (closer = higher %)
    const probabilities = this.calculateProbabilitiesFromPosition(currentState);
    
    // Enhanced confidence based on trend consistency
    const confidence = this.calculateEnhancedConfidence(maxPosition, trendAnalysis);

    return {
      timestamp: new Date().toISOString(),
      riskLevel,
      probabilities,
      timeToAlarm,
      sensorPredictions, // New: per-sensor detailed predictions
      trendAnalysis,     // New: trend information
      analysis: currentState,
      confidence,
      recommendations: this.generateRecommendations(riskLevel, currentState, timeToAlarm, sensorPredictions)
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

  // ============================================================
  // ENHANCED PREDICTION METHODS v2.0
  // ============================================================

  /**
   * Analyze trends for all sensors using EWMA smoothing and weighted regression
   */
  analyzeTrends(currentState, history) {
    if (!history || history.length < this.config.minReadingsForTrend) {
      return { gas: null, temperature: null, humidity: null, hasValidTrends: false };
    }

    // Use sliding window
    const windowSize = Math.min(this.config.maxReadingsWindow, history.length);
    const recentHistory = history.slice(-windowSize);

    const trends = {
      gas: this.analyzeSensorTrend(recentHistory, 'gas', currentState.gas),
      temperature: this.analyzeSensorTrend(recentHistory, 'temperature', currentState.temperature),
      humidity: this.analyzeHumidityTrend(recentHistory, currentState.humidity),
      hasValidTrends: false
    };

    // Check if any valid trends exist
    trends.hasValidTrends = (trends.gas?.isValid || trends.temperature?.isValid || trends.humidity?.isValid);

    return trends;
  }

  /**
   * Analyze trend for a single sensor with EWMA smoothing
   */
  analyzeSensorTrend(history, sensorName, sensorState) {
    if (!sensorState.enabled) {
      return { isValid: false, reason: 'disabled' };
    }

    // Extract data points
    const dataPoints = this.extractDataPoints(history, sensorName);
    
    if (dataPoints.length < this.config.minReadingsForTrend) {
      return { isValid: false, reason: 'insufficient_data' };
    }

    // Apply EWMA smoothing to reduce noise
    const smoothedPoints = this.applyEWMA(dataPoints);

    // Calculate weighted linear regression (recent points weighted more)
    const regression = this.calculateWeightedRegression(smoothedPoints);
    
    // Calculate trend consistency (how stable is the trend direction)
    const consistency = this.calculateTrendConsistency(smoothedPoints, regression.slope);

    // Get minimum rate threshold for this sensor
    const minRate = this.config.minRateThreshold[sensorName] || 0.01;

    // Check if rate exceeds minimum threshold (reduces noise sensitivity)
    const isSignificantRate = Math.abs(regression.slope) > minRate;
    const isConsistent = consistency >= this.config.trendConsistencyThreshold;
    const isTrendingTowardsAlarm = regression.slope > 0; // For gas/temp, increasing is bad

    return {
      isValid: isSignificantRate && isConsistent,
      slope: regression.slope,           // Rate per second
      ratePerMinute: regression.slope * 60,
      intercept: regression.intercept,
      r2: regression.r2,                 // Goodness of fit
      consistency,                        // Trend consistency (0-1)
      direction: regression.slope > 0 ? 'increasing' : 'decreasing',
      isAccelerating: this.detectAcceleration(smoothedPoints),
      acceleration: this.calculateAcceleration(smoothedPoints),
      smoothedValues: smoothedPoints.slice(-5).map(p => p.smoothedValue),
      isSignificantRate,
      isTrendingTowardsAlarm,
      reason: !isSignificantRate ? 'rate_too_low' : (!isConsistent ? 'inconsistent_trend' : 'valid')
    };
  }

  /**
   * Analyze humidity trend (handles both low and high boundaries)
   */
  analyzeHumidityTrend(history, humidityState) {
    if (!humidityState.enabled) {
      return { isValid: false, reason: 'disabled' };
    }

    const dataPoints = this.extractDataPoints(history, 'humidity');
    
    if (dataPoints.length < this.config.minReadingsForTrend) {
      return { isValid: false, reason: 'insufficient_data' };
    }

    const smoothedPoints = this.applyEWMA(dataPoints);
    const regression = this.calculateWeightedRegression(smoothedPoints);
    const consistency = this.calculateTrendConsistency(smoothedPoints, regression.slope);

    const minRate = this.config.minRateThreshold.humidity;
    const isSignificantRate = Math.abs(regression.slope) > minRate;
    const isConsistent = consistency >= this.config.trendConsistencyThreshold;

    // Determine which boundary we're approaching
    const current = humidityState.current;
    const midpoint = (humidityState.lowThreshold + humidityState.highThreshold) / 2;
    const approachingLow = current < midpoint && regression.slope < 0;
    const approachingHigh = current >= midpoint && regression.slope > 0;
    const isTrendingTowardsAlarm = approachingLow || approachingHigh;

    return {
      isValid: isSignificantRate && isConsistent && isTrendingTowardsAlarm,
      slope: regression.slope,
      ratePerMinute: regression.slope * 60,
      consistency,
      direction: regression.slope > 0 ? 'increasing' : 'decreasing',
      targetBoundary: approachingLow ? 'low' : (approachingHigh ? 'high' : 'none'),
      isTrendingTowardsAlarm,
      reason: !isSignificantRate ? 'rate_too_low' : (!isConsistent ? 'inconsistent_trend' : (!isTrendingTowardsAlarm ? 'moving_to_safe' : 'valid'))
    };
  }

  /**
   * Extract data points from history for a specific sensor
   */
  extractDataPoints(history, sensorName) {
    const dataPoints = [];
    const sensorKey = { gas: 'g', temperature: 't', humidity: 'h', flame: 'f' }[sensorName];

    for (let i = 0; i < history.length; i++) {
      const reading = history[i];
      const value = reading[sensorKey];
      const timestamp = reading.ts ? new Date(reading.ts).getTime() : Date.now() - (history.length - i) * 1000;

      if (value !== null && value !== undefined && !isNaN(value)) {
        dataPoints.push({ value: Number(value), timestamp, index: i });
      }
    }

    return dataPoints;
  }

  /**
   * Apply Exponential Weighted Moving Average for smoothing
   */
  applyEWMA(dataPoints) {
    if (dataPoints.length === 0) return [];

    const alpha = this.config.ewmaAlpha;
    const smoothed = [];
    let ewma = dataPoints[0].value;

    for (let i = 0; i < dataPoints.length; i++) {
      ewma = alpha * dataPoints[i].value + (1 - alpha) * ewma;
      smoothed.push({
        ...dataPoints[i],
        smoothedValue: ewma,
        rawValue: dataPoints[i].value
      });
    }

    return smoothed;
  }

  /**
   * Calculate weighted linear regression (more weight on recent points)
   */
  calculateWeightedRegression(dataPoints) {
    if (dataPoints.length < 2) {
      return { slope: 0, intercept: 0, r2: 0 };
    }

    const n = dataPoints.length;
    const t0 = dataPoints[0].timestamp;

    // Normalize timestamps to seconds and assign weights (exponential weighting)
    let sumW = 0, sumWX = 0, sumWY = 0, sumWXX = 0, sumWXY = 0, sumWYY = 0;

    for (let i = 0; i < n; i++) {
      const x = (dataPoints[i].timestamp - t0) / 1000; // Time in seconds
      const y = dataPoints[i].smoothedValue || dataPoints[i].value;
      // Exponential weight: recent points get higher weight
      const w = Math.exp((i - n + 1) / (n * 0.5)); // Decay factor

      sumW += w;
      sumWX += w * x;
      sumWY += w * y;
      sumWXX += w * x * x;
      sumWXY += w * x * y;
      sumWYY += w * y * y;
    }

    const denominator = sumW * sumWXX - sumWX * sumWX;
    if (Math.abs(denominator) < 1e-10) {
      return { slope: 0, intercept: sumWY / sumW, r2: 0 };
    }

    const slope = (sumW * sumWXY - sumWX * sumWY) / denominator;
    const intercept = (sumWY - slope * sumWX) / sumW;

    // Calculate R² (coefficient of determination)
    const meanY = sumWY / sumW;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      const x = (dataPoints[i].timestamp - t0) / 1000;
      const y = dataPoints[i].smoothedValue || dataPoints[i].value;
      const w = Math.exp((i - n + 1) / (n * 0.5));
      const yPred = slope * x + intercept;
      ssTot += w * (y - meanY) * (y - meanY);
      ssRes += w * (y - yPred) * (y - yPred);
    }
    const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    return { slope, intercept, r2: Math.max(0, Math.min(1, r2)) };
  }

  /**
   * Calculate trend consistency (how stable is the direction)
   */
  calculateTrendConsistency(dataPoints, overallSlope) {
    if (dataPoints.length < 3) return 0;

    let consistentCount = 0;
    const expectedDirection = overallSlope >= 0 ? 1 : -1;

    for (let i = 1; i < dataPoints.length; i++) {
      const localChange = (dataPoints[i].smoothedValue || dataPoints[i].value) - 
                          (dataPoints[i-1].smoothedValue || dataPoints[i-1].value);
      const localDirection = localChange >= 0 ? 1 : -1;
      
      if (localDirection === expectedDirection || Math.abs(localChange) < 0.001) {
        consistentCount++;
      }
    }

    return consistentCount / (dataPoints.length - 1);
  }

  /**
   * Detect if the rate is accelerating (getting worse faster)
   */
  detectAcceleration(dataPoints) {
    if (dataPoints.length < 6) return false;

    // Split into two halves and compare rates
    const mid = Math.floor(dataPoints.length / 2);
    const firstHalf = dataPoints.slice(0, mid);
    const secondHalf = dataPoints.slice(mid);

    const firstRate = this.calculateWeightedRegression(firstHalf).slope;
    const secondRate = this.calculateWeightedRegression(secondHalf).slope;

    // Accelerating if second half rate is significantly higher
    return secondRate > firstRate * 1.2;
  }

  /**
   * Calculate acceleration (rate of change of rate)
   */
  calculateAcceleration(dataPoints) {
    if (dataPoints.length < 6) return 0;

    const mid = Math.floor(dataPoints.length / 2);
    const firstHalf = dataPoints.slice(0, mid);
    const secondHalf = dataPoints.slice(mid);

    const firstRate = this.calculateWeightedRegression(firstHalf).slope;
    const secondRate = this.calculateWeightedRegression(secondHalf).slope;

    // Time span of each half
    const halfDuration = (dataPoints[dataPoints.length - 1].timestamp - dataPoints[0].timestamp) / 2000;
    if (halfDuration <= 0) return 0;

    return (secondRate - firstRate) / halfDuration; // Acceleration in units/sec²
  }

  /**
   * Calculate per-sensor predictions with time to alarm
   */
  calculateSensorPredictions(currentState, trendAnalysis) {
    const predictions = {};

    // Gas prediction
    if (currentState.gas.enabled && trendAnalysis.gas?.isValid) {
      predictions.gas = this.calculateSensorTimeToAlarm(
        currentState.gas.current,
        currentState.gas.threshold,
        currentState.gas.safeBaseline,
        trendAnalysis.gas
      );
    }

    // Temperature prediction
    if (currentState.temperature.enabled && trendAnalysis.temperature?.isValid) {
      predictions.temperature = this.calculateSensorTimeToAlarm(
        currentState.temperature.current,
        currentState.temperature.threshold,
        currentState.temperature.safeBaseline,
        trendAnalysis.temperature
      );
    }

    // Humidity prediction
    if (currentState.humidity.enabled && trendAnalysis.humidity?.isValid) {
      const targetThreshold = trendAnalysis.humidity.targetBoundary === 'low' 
        ? currentState.humidity.lowThreshold 
        : currentState.humidity.highThreshold;
      
      predictions.humidity = this.calculateHumidityTimeToAlarm(
        currentState.humidity.current,
        targetThreshold,
        trendAnalysis.humidity
      );
    }

    return predictions;
  }

  /**
   * Calculate time to alarm for a sensor with acceleration consideration
   */
  calculateSensorTimeToAlarm(current, threshold, baseline, trend) {
    if (!trend || !trend.isValid || !trend.isTrendingTowardsAlarm) {
      return null;
    }

    const distance = threshold - current;
    if (distance <= 0) {
      return { timeSeconds: 0, confidence: 1, method: 'at_threshold' };
    }

    const rate = trend.slope; // per second
    if (rate <= 0) {
      return null; // Not approaching threshold
    }

    // Base time calculation
    let timeSeconds = distance / rate;

    // Adjust for acceleration if detected
    if (trend.isAccelerating && trend.acceleration > 0) {
      // Use kinematic equation: d = v*t + 0.5*a*t²
      // Solve for t using quadratic formula
      const a = 0.5 * trend.acceleration;
      const b = rate;
      const c = -distance;
      const discriminant = b * b - 4 * a * c;
      
      if (discriminant >= 0) {
        const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);
        const t2 = (-b - Math.sqrt(discriminant)) / (2 * a);
        const adjustedTime = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
        if (adjustedTime < Infinity && adjustedTime < timeSeconds) {
          timeSeconds = adjustedTime;
        }
      }
    }

    // Validate prediction window
    if (timeSeconds < this.config.minPredictionWindow || timeSeconds > this.config.maxPredictionWindow) {
      return null;
    }

    // Calculate confidence based on trend quality
    const confidence = Math.min(1, (trend.consistency + (trend.r2 || 0)) / 2);

    return {
      timeSeconds: Math.round(timeSeconds),
      confidence,
      ratePerMinute: trend.ratePerMinute,
      isAccelerating: trend.isAccelerating,
      method: trend.isAccelerating ? 'accelerated' : 'linear'
    };
  }

  /**
   * Calculate time to alarm for humidity (handles direction)
   */
  calculateHumidityTimeToAlarm(current, targetThreshold, trend) {
    if (!trend || !trend.isValid) {
      return null;
    }

    let distance;
    if (trend.targetBoundary === 'low') {
      distance = current - targetThreshold;
      if (distance <= 0 || trend.slope >= 0) return null;
    } else {
      distance = targetThreshold - current;
      if (distance <= 0 || trend.slope <= 0) return null;
    }

    const rate = Math.abs(trend.slope);
    if (rate < this.config.minRateThreshold.humidity) {
      return null;
    }

    const timeSeconds = distance / rate;

    if (timeSeconds < this.config.minPredictionWindow || timeSeconds > this.config.maxPredictionWindow) {
      return null;
    }

    const confidence = Math.min(1, trend.consistency);

    return {
      timeSeconds: Math.round(timeSeconds),
      confidence,
      ratePerMinute: trend.ratePerMinute,
      targetBoundary: trend.targetBoundary,
      method: 'linear'
    };
  }

  /**
   * Get the most critical (shortest) time to alarm from all sensors
   */
  getMostCriticalTimeToAlarm(sensorPredictions) {
    let minTime = null;

    for (const [sensor, prediction] of Object.entries(sensorPredictions)) {
      if (prediction && prediction.timeSeconds !== null) {
        // Only consider predictions with reasonable confidence
        if (prediction.confidence >= 0.5) {
          if (minTime === null || prediction.timeSeconds < minTime) {
            minTime = prediction.timeSeconds;
          }
        }
      }
    }

    return minTime;
  }

  /**
   * Calculate enhanced confidence based on position and trend quality
   */
  calculateEnhancedConfidence(maxPosition, trendAnalysis) {
    // Base confidence from position
    let confidence = maxPosition;

    // Boost confidence if trends are consistent
    if (trendAnalysis.hasValidTrends) {
      let avgConsistency = 0;
      let validCount = 0;

      if (trendAnalysis.gas?.isValid) {
        avgConsistency += trendAnalysis.gas.consistency;
        validCount++;
      }
      if (trendAnalysis.temperature?.isValid) {
        avgConsistency += trendAnalysis.temperature.consistency;
        validCount++;
      }
      if (trendAnalysis.humidity?.isValid) {
        avgConsistency += trendAnalysis.humidity.consistency;
        validCount++;
      }

      if (validCount > 0) {
        avgConsistency /= validCount;
        // Blend position confidence with trend confidence
        confidence = confidence * 0.6 + avgConsistency * 0.4;
      }
    }

    return Math.max(0, Math.min(1, confidence));
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
   * Generate recommendations based on risk level, time to alarm, and sensor predictions
   */
  generateRecommendations(riskLevel, state, timeToAlarm, sensorPredictions = {}) {
    const recommendations = [];

    // Add specific sensor warnings based on position
    if (state.gas.position >= 0.8 && state.gas.enabled) {
      const pred = sensorPredictions.gas;
      let extraInfo = '';
      if (pred?.timeSeconds) {
        extraInfo = pred.isAccelerating ? ' (accelerating!)' : '';
      }
      recommendations.push({
        priority: "URGENT",
        message: `Gas at ${Math.round(state.gas.position * 100)}% of threshold (${state.gas.current}/${state.gas.threshold})${extraInfo}`,
        action: "Critical level - check for gas leaks immediately"
      });
    } else if (state.gas.position >= 0.5 && state.gas.enabled) {
      const pred = sensorPredictions.gas;
      let rateInfo = '';
      if (pred?.ratePerMinute) {
        rateInfo = ` (+${pred.ratePerMinute.toFixed(1)}/min)`;
      }
      recommendations.push({
        priority: "WARNING",
        message: `Gas rising: ${Math.round(state.gas.position * 100)}% to threshold${rateInfo}`,
        action: "Monitor closely and ensure ventilation"
      });
    }

    if (state.temperature.position >= 0.8 && state.temperature.enabled) {
      const pred = sensorPredictions.temperature;
      let extraInfo = '';
      if (pred?.isAccelerating) {
        extraInfo = ' (accelerating!)';
      }
      recommendations.push({
        priority: "URGENT",
        message: `Temperature at ${Math.round(state.temperature.position * 100)}% of threshold (${state.temperature.current}°C/${state.temperature.threshold}°C)${extraInfo}`,
        action: "Critical temperature - check cooling systems"
      });
    } else if (state.temperature.position >= 0.5 && state.temperature.enabled) {
      const pred = sensorPredictions.temperature;
      let rateInfo = '';
      if (pred?.ratePerMinute) {
        rateInfo = ` (+${pred.ratePerMinute.toFixed(2)}°C/min)`;
      }
      recommendations.push({
        priority: "WARNING",
        message: `Temperature rising: ${Math.round(state.temperature.position * 100)}% to limit${rateInfo}`,
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
    }

    // Enhanced time-based warnings with per-sensor breakdown
    if (timeToAlarm !== null && timeToAlarm !== undefined && timeToAlarm >= 0) {
      const timeRec = this.generateTimeRecommendation(timeToAlarm, sensorPredictions);
      if (timeRec) {
        recommendations.push(timeRec);
      }
    }

    // Add per-sensor time estimates if available and different from main
    for (const [sensor, pred] of Object.entries(sensorPredictions)) {
      if (pred && pred.timeSeconds && pred.timeSeconds !== timeToAlarm && pred.timeSeconds > 60) {
        const mins = Math.floor(pred.timeSeconds / 60);
        const secs = pred.timeSeconds % 60;
        const accel = pred.isAccelerating ? ' (accelerating)' : '';
        recommendations.push({
          priority: "INFO",
          message: `${sensor.charAt(0).toUpperCase() + sensor.slice(1)}: ~${mins}m ${secs}s to threshold${accel}`,
          action: `Rate: ${Math.abs(pred.ratePerMinute || 0).toFixed(2)}/min`
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

  /**
   * Generate time-based recommendation with intelligent formatting
   */
  generateTimeRecommendation(timeToAlarm, sensorPredictions) {
    // Find which sensor is most critical
    let criticalSensor = null;
    for (const [sensor, pred] of Object.entries(sensorPredictions)) {
      if (pred && pred.timeSeconds === timeToAlarm) {
        criticalSensor = sensor;
        break;
      }
    }

    const sensorLabel = criticalSensor ? ` (${criticalSensor})` : '';
    const pred = criticalSensor ? sensorPredictions[criticalSensor] : null;
    const accelNote = pred?.isAccelerating ? ' ⚡' : '';

    let timeMessage, timeAction, priority;
    
    if (timeToAlarm === 0) {
      timeMessage = `🚨 ALARM TRIGGERED NOW!${sensorLabel}`;
      timeAction = "IMMEDIATE EMERGENCY ACTION!";
      priority = "CRITICAL";
    } else if (timeToAlarm <= 10) {
      timeMessage = `🚨 ALARM IN ${timeToAlarm}s!${sensorLabel}${accelNote}`;
      timeAction = "EVACUATE OR TAKE IMMEDIATE ACTION!";
      priority = "CRITICAL";
    } else if (timeToAlarm <= 30) {
      timeMessage = `⚠️ ALARM IN ${timeToAlarm}s${sensorLabel}${accelNote}`;
      timeAction = "Take immediate preventive action now!";
      priority = "CRITICAL";
    } else if (timeToAlarm < 60) {
      timeMessage = `⏰ Alarm in ${timeToAlarm}s${sensorLabel}${accelNote}`;
      timeAction = "Prepare safety measures immediately";
      priority = "HIGH";
    } else if (timeToAlarm < 120) {
      const minutes = Math.floor(timeToAlarm / 60);
      const seconds = timeToAlarm % 60;
      timeMessage = `⏱️ Alarm in ${minutes}m ${seconds}s${sensorLabel}${accelNote}`;
      timeAction = "Monitor closely and take preventive action";
      priority = "HIGH";
    } else if (timeToAlarm < 600) {
      const minutes = Math.floor(timeToAlarm / 60);
      const seconds = timeToAlarm % 60;
      timeMessage = `Predicted alarm in ${minutes}m ${seconds}s${sensorLabel}${accelNote}`;
      timeAction = "Investigate cause and address issue";
      priority = "MEDIUM";
    } else if (timeToAlarm < 3600) {
      const minutes = Math.round(timeToAlarm / 60);
      timeMessage = `Trend analysis: ~${minutes} min to alarm${sensorLabel}`;
      timeAction = "Monitor situation and address root cause";
      priority = "MEDIUM";
    } else {
      const hours = (timeToAlarm / 3600).toFixed(1);
      timeMessage = `Long-term projection: ~${hours}h${sensorLabel}`;
      timeAction = "Continue monitoring";
      priority = "LOW";
    }
    
    return {
      priority,
      message: timeMessage,
      action: timeAction
    };
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