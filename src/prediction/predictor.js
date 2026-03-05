/**
 * SmartEmergency Predictive Alarm System
 * Advanced probability-based early warning system with trend analysis
 */

class PredictiveAlarmSystem {
  constructor() {
    this.historyWindow = 20; // Number of recent readings to analyze
    this.trendWeights = {
      gas: { recent: 0.4, trend: 0.3, volatility: 0.2, acceleration: 0.1 },
      temp: { recent: 0.3, trend: 0.4, volatility: 0.2, acceleration: 0.1 },
      humidity: { recent: 0.2, trend: 0.3, volatility: 0.3, acceleration: 0.2 },
      flame: { recent: 0.6, trend: 0.2, volatility: 0.1, acceleration: 0.1 }
    };
    this.predictionHorizon = 300; // 5 minutes in seconds
  }

  /**
   * Analyze sensor data and generate predictions
   * @param {Object} currentReading - Current sensor reading
   * @param {Array} history - Historical readings array
   * @param {Object} thresholds - Device thresholds
   * @returns {Object} Prediction results
   */
  generatePrediction(currentReading, history, thresholds) {
    if (!history || history.length < 5) {
      return this.getDefaultPrediction();
    }

    const analysis = this.analyzeTrends(history, thresholds);
    const probabilities = this.calculateProbabilities(currentReading, analysis, thresholds);
    const timeToAlarm = this.estimateTimeToAlarm(currentReading, analysis, thresholds);
    const riskLevel = this.calculateRiskLevel(probabilities, timeToAlarm);

    return {
      timestamp: new Date().toISOString(),
      riskLevel,
      probabilities,
      timeToAlarm,
      analysis,
      confidence: this.calculateConfidence(history.length, analysis),
      recommendations: this.generateRecommendations(riskLevel, probabilities, timeToAlarm)
    };
  }

  /**
   * Analyze trends in sensor data
   */
  analyzeTrends(history, thresholds) {
    const recent = history.slice(-this.historyWindow);
    
    return {
      gas: this.analyzeSensorTrend(recent.map(r => r.g), thresholds.gas_threshold),
      temperature: this.analyzeSensorTrend(recent.map(r => r.t), thresholds.temp_threshold),
      humidity: this.analyzeSensorTrend(recent.map(r => r.h), {
        low: thresholds.humidity_low_threshold,
        high: thresholds.humidity_high_threshold
      }),
      flame: this.analyzeFlameTrend(recent.map(r => r.f))
    };
  }

  /**
   * Analyze individual sensor trend
   */
  analyzeSensorTrend(values, threshold) {
    if (values.length < 3) return { trend: 0, volatility: 0, acceleration: 0 };

    const recent = values.slice(-5);
    const older = values.slice(-10, -5);

    // Calculate trend (slope)
    const trend = this.calculateSlope(recent);
    
    // Calculate volatility (standard deviation)
    const volatility = this.calculateVolatility(recent);
    
    // Calculate acceleration (change in trend)
    const acceleration = this.calculateAcceleration(values);

    // Distance to threshold
    const current = values[values.length - 1];
    const distance = this.getDistanceToThreshold(current, threshold);
    const rateOfApproach = trend > 0 ? trend : 0;

    return {
      trend,
      volatility,
      acceleration,
      current,
      distance,
      rateOfApproach,
      normalizedRisk: this.normalizeRisk(distance, rateOfApproach, volatility)
    };
  }

  /**
   * Analyze flame sensor trend (binary)
   */
  analyzeFlameTrend(values) {
    const recent = values.slice(-5);
    const flameCount = recent.filter(v => v === 0).length; // 0 = flame detected
    const flameFrequency = flameCount / recent.length;
    
    return {
      trend: flameFrequency > 0.2 ? 1 : 0, // Increasing if >20% flame detection
      volatility: flameFrequency * (1 - flameFrequency), // Max at 50% frequency
      acceleration: 0, // Binary sensors don't have acceleration
      current: values[values.length - 1],
      distance: values[values.length - 1] === 0 ? 0 : 1,
      rateOfApproach: flameFrequency,
      normalizedRisk: flameFrequency
    };
  }

  /**
   * Calculate alarm probabilities for each sensor
   */
  calculateProbabilities(current, analysis, thresholds) {
    const probabilities = {};

    // Gas probability
    probabilities.gas = this.calculateSensorProbability(
      analysis.gas,
      this.trendWeights.gas,
      thresholds.gas_enabled
    );

    // Temperature probability
    probabilities.temperature = this.calculateSensorProbability(
      analysis.temperature,
      this.trendWeights.temp,
      thresholds.temp_enabled
    );

    // Humidity probability
    probabilities.humidity = this.calculateHumidityProbability(
      analysis.humidity,
      this.trendWeights.humidity,
      thresholds.humidity_enabled
    );

    // Flame probability
    probabilities.flame = this.calculateFlameProbability(
      analysis.flame,
      this.trendWeights.flame,
      thresholds.flame_enabled
    );

    // Overall probability (weighted combination)
    probabilities.overall = this.calculateOverallProbability(probabilities);

    return probabilities;
  }

  /**
   * Calculate probability for individual sensor
   */
  calculateSensorProbability(sensorAnalysis, weights, enabled) {
    if (!enabled) return 0;

    const { recent, trend, volatility, acceleration } = weights;
    const { normalizedRisk, trend: trendValue, volatility: volValue, current, rateOfApproach } = sensorAnalysis;

    // For gas: focus on rising trend and acceleration
    let riskScore = 0;
    
    // Base risk from distance to threshold
    riskScore += normalizedRisk * recent;
    
    // Strong emphasis on rising trend for gas
    if (trendValue > 0) {
      riskScore += trendValue * trend * 0.8; // Amplify rising trend
    }
    
    // Emphasize acceleration (rate of increase getting faster)
    if (acceleration > 0.1) {
      riskScore += acceleration * 0.5; // Penalty for accelerating increase
    }
    
    // Consider rate of approach (how fast it's approaching threshold)
    if (rateOfApproach > 5) {
      riskScore += Math.min(0.4, rateOfApproach / 25); // Higher risk for fast approach
    }
    
    // Volatility factor (unstable gas is more dangerous)
    riskScore += volValue * volatility;
    
    // Current level factor (higher baseline = higher risk)
    if (current > 100) {
      riskScore += 0.2; // Add risk for already elevated gas levels
    }
    
    // For gas: use exponential scaling for high values
    if (current > 200) {
      riskScore = Math.min(1, riskScore * 1.3); // Amplify risk for high gas values
    }

    return Math.min(1, Math.max(0, riskScore));
  }

  /**
   * Calculate humidity probability (range-based)
   */
  calculateHumidityProbability(analysis, weights, enabled) {
    if (!enabled) return 0;

    const { recent, trend, volatility, acceleration } = weights;
    const { normalizedRisk, trend: trendValue, volatility: volValue } = analysis;

    // Humidity is risky when too low OR too high
    const rangeRisk = normalizedRisk;
    const trendRisk = Math.abs(trendValue) * trend;
    const volatilityRisk = volValue * volatility;
    const accelerationRisk = Math.abs(analysis.acceleration) * acceleration;

    return Math.min(1, Math.max(0,
      rangeRisk * recent +
      trendRisk +
      volatilityRisk +
      accelerationRisk
    ));
  }

  /**
   * Calculate flame probability
   */
  calculateFlameProbability(analysis, weights, enabled) {
    if (!enabled) return 0;

    const { recent, trend, volatility } = weights;
    const { normalizedRisk, trend: trendValue, volatility: volValue } = analysis;

    return Math.min(1, Math.max(0,
      normalizedRisk * recent +
      trendValue * trend +
      volValue * volatility
    ));
  }

  /**
   * Calculate overall probability
   */
  calculateOverallProbability(probabilities) {
    // Completely ignore gas probability, only use temperature and humidity
    const tempProb = probabilities.temperature || 0;
    const humProb = probabilities.humidity || 0;
    const flameProb = probabilities.flame || 0;
    
    // Use maximum of temperature and humidity for conservative approach
    const enviroMax = Math.max(tempProb, humProb);
    
    // Include flame probability as it's critical
    const overallMax = Math.max(enviroMax, flameProb);
    
    return overallMax;
  }

  /**
   * Estimate time to alarm
   */
  estimateTimeToAlarm(current, analysis, thresholds) {
    const estimates = {};

    // Gas time estimate
    if (analysis.gas.rateOfApproach > 0 && analysis.gas.distance > 0) {
      estimates.gas = Math.round(analysis.gas.distance / analysis.gas.rateOfApproach);
    }

    // Temperature time estimate
    if (analysis.temperature.rateOfApproach > 0 && analysis.temperature.distance > 0) {
      estimates.temperature = Math.round(analysis.temperature.distance / analysis.temperature.rateOfApproach);
    }

    // Humidity time estimate
    if (analysis.humidity.rateOfApproach > 0 && analysis.humidity.distance > 0) {
      estimates.humidity = Math.round(analysis.humidity.distance / analysis.humidity.rateOfApproach);
    }

    // Flame is immediate
    if (analysis.flame.current === 0) {
      estimates.flame = 0;
    }

    // Return minimum time (most urgent)
    const times = Object.values(estimates).filter(t => t >= 0);
    return times.length > 0 ? Math.min(...times) : null;
  }

  /**
   * Calculate risk level
   */
  calculateRiskLevel(probabilities, timeToAlarm) {
    const overallProb = probabilities.overall;

    if (overallProb >= 0.8) return 'CRITICAL';
    if (overallProb >= 0.6) return 'HIGH';
    if (overallProb >= 0.4) return 'MEDIUM';
    if (overallProb >= 0.2) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Calculate confidence in prediction
   */
  calculateConfidence(historyLength, analysis) {
    const dataQuality = Math.min(1, historyLength / this.historyWindow);
    const trendConsistency = this.calculateTrendConsistency(analysis);
    
    return (dataQuality * 0.6 + trendConsistency * 0.4);
  }

  /**
   * Generate recommendations based on risk level
   */
  generateRecommendations(riskLevel, probabilities, timeToAlarm) {
    const recommendations = [];

    if (riskLevel === 'CRITICAL') {
      recommendations.push({
        priority: 'URGENT',
        message: 'Immediate action required - alarm likely within minutes',
        action: 'Evacuate area and check safety systems'
      });
    } else if (riskLevel === 'HIGH') {
      recommendations.push({
        priority: 'HIGH',
        message: timeToAlarm ? `Alarm possible in ~${timeToAlarm} seconds` : 'Alarm conditions developing',
        action: 'Monitor closely and prepare safety measures'
      });
    } else if (riskLevel === 'MEDIUM') {
      recommendations.push({
        priority: 'MEDIUM',
        message: 'Elevated risk detected',
        action: 'Increase monitoring frequency'
      });
    }

    // Sensor-specific recommendations
    if (probabilities.gas > 0.5) {
      recommendations.push({
        priority: 'SENSOR',
        message: 'Gas levels rising rapidly',
        action: 'Check for gas leaks and ventilation'
      });
    }

    if (probabilities.temperature > 0.5) {
      recommendations.push({
        priority: 'SENSOR',
        message: 'Temperature increasing',
        action: 'Check cooling systems and heat sources'
      });
    }

    if (probabilities.flame > 0.3) {
      recommendations.push({
        priority: 'SENSOR',
        message: 'Flame detection intermittent',
        action: 'Inspect for fire hazards'
      });
    }

    return recommendations;
  }

  // Utility methods
  calculateSlope(values) {
    if (values.length < 2) return 0;
    
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  calculateAcceleration(values) {
    if (values.length < 3) return 0;
    
    const recent = values.slice(-3);
    const slope1 = recent[1] - recent[0];
    const slope2 = recent[2] - recent[1];
    return slope2 - slope1;
  }

  getDistanceToThreshold(current, threshold) {
    if (typeof threshold === 'object') {
      // For humidity (range)
      if (current < threshold.low) return threshold.low - current;
      if (current > threshold.high) return current - threshold.high;
      return 0; // Within safe range
    }
    return Math.max(0, current - threshold);
  }

  normalizeRisk(distance, rateOfApproach, volatility) {
    if (distance <= 0) return 1; // Already at or past threshold
    
    // Risk increases as distance decreases and rate of approach increases
    const distanceRisk = Math.max(0, 1 - distance / 100);
    const approachRisk = Math.min(1, rateOfApproach / 10);
    const volatilityRisk = Math.min(1, volatility / 50);
    
    return Math.min(1, (distanceRisk * 0.4 + approachRisk * 0.4 + volatilityRisk * 0.2));
  }

  calculateTrendConsistency(analysis) {
    const trends = [
      analysis.gas?.trend || 0,
      analysis.temperature?.trend || 0,
      analysis.humidity?.trend || 0,
      analysis.flame?.trend || 0
    ];
    
    const avgTrend = trends.reduce((a, b) => a + b, 0) / trends.length;
    const variance = trends.reduce((sum, t) => sum + Math.pow(t - avgTrend, 2), 0) / trends.length;
    
    return Math.max(0, 1 - variance / 10);
  }

  getDefaultPrediction() {
    return {
      timestamp: new Date().toISOString(),
      riskLevel: 'MINIMAL',
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
      recommendations: [{
        priority: 'INFO',
        message: 'Insufficient data for prediction',
        action: 'Collect more sensor readings'
      }]
    };
  }
}

export default PredictiveAlarmSystem;
