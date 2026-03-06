# SmartEmergency Prediction System - Complete Guide

## Overview
The prediction system calculates **exact countdown time** to alarm based on:
1. **Calibration Baseline** - Safe normal value from calibration
2. **Current Value** - Real-time sensor reading
3. **Threshold** - Alarm trigger point
4. **Rate of Change** - How fast the value is changing (per second)

## How It Works

### 1. Calibration Phase (ESP8266 Startup)
```
ESP8266 takes 5 readings:
- Gas: 88, 90, 90, 90, 90 → Average: 90
- Temp: 27.4, 27.4, 27.4, 27.4, 27.4 → Average: 27.4°C
- Humidity: 46.4, 46.4, 46.4, 46.4, 46.4 → Average: 46.4%

Sends to server:
{
  "uid": "ABC123",
  "label": "room1",
  "readings": [
    {"g": 90, "t": 27.4, "h": 46.4},
    {"g": 90, "t": 27.4, "h": 46.4},
    ... (5 readings)
  ]
}

Server calculates and stores:
- gas_safe_baseline: 90
- temp_safe_baseline: 27.4
- humidity_safe_baseline: 46.4
```

### 2. Real-Time Prediction

#### Example: Gas Sensor
```
Calibration Baseline: 90
Current Value: 250
Threshold: 400
Rate of Change: +5 per second

Calculation:
Distance to threshold = 400 - 250 = 150
Time to alarm = 150 / 5 = 30 seconds

Display: "⏰ Alarm in 30 seconds"
```

#### Example: Temperature
```
Calibration Baseline: 27.4°C
Current Value: 45°C
Threshold: 60°C
Rate of Change: +0.5°C per second

Calculation:
Distance = 60 - 45 = 15°C
Time = 15 / 0.5 = 30 seconds

Display: "⏰ Alarm in 30 seconds"
```

#### Example: Humidity (Range)
```
Calibration Baseline: 46.4%
Current Value: 75%
Low Threshold: 20%
High Threshold: 80%
Rate of Change: +1% per second

Since 75% > baseline (46.4%), approaching HIGH threshold
Distance = 80 - 75 = 5%
Time = 5 / 1 = 5 seconds

Display: "🚨 ALARM IN 5 SECONDS!"
```

### 3. Rate of Change Calculation

Uses **Linear Regression** on last 10 readings:
```javascript
// Example data points
readings = [
  {time: 0s, value: 100},
  {time: 1s, value: 105},
  {time: 2s, value: 110},
  {time: 3s, value: 115},
  {time: 4s, value: 120}
]

// Calculate slope (rate per second)
slope = 5 units/second

// Predict time to threshold (400)
current = 120
distance = 400 - 120 = 280
time = 280 / 5 = 56 seconds
```

## Display Formats

### Countdown Display
- **0s**: `🚨 NOW!` (red, blinking)
- **1-10s**: `🚨 5s` (red, blinking)
- **11-30s**: `⚠️ 25s` (red, bold)
- **31-60s**: `⏰ 45s` (orange, bold)
- **1-2min**: `⏱️ 1m 30s` (orange)
- **2-10min**: `⏱️ 5m 15s` (yellow)
- **10-60min**: `🕐 ~25 min` (blue)
- **1+ hour**: `📊 ~2 hours` (gray)

### Visual Indicators
```
Time < 10s:  🚨 Red + Blinking animation
Time < 30s:  ⚠️ Red + Bold
Time < 60s:  ⏰ Orange + Bold
Time < 5min: ⏱️ Yellow
Time < 1hr:  🕐 Blue
Time > 1hr:  📊 Gray
```

## Database Schema

```sql
CREATE TABLE thresholds (
  -- Alarm thresholds (when to trigger)
  gas_threshold INT DEFAULT 400,
  temp_threshold DECIMAL(5,2) DEFAULT 60.00,
  humidity_low_threshold DECIMAL(5,2) DEFAULT 20.00,
  humidity_high_threshold DECIMAL(5,2) DEFAULT 80.00,
  
  -- Calibration baselines (safe normal values)
  gas_safe_baseline INT DEFAULT 100,
  temp_safe_baseline DECIMAL(5,2) DEFAULT 25.00,
  humidity_safe_baseline DECIMAL(5,2) DEFAULT 50.00
);
```

## API Flow

### 1. Calibration (POST /api/calibrate)
```json
Request:
{
  "uid": "ABC123",
  "label": "room1",
  "readings": [
    {"g": 90, "t": 27.4, "h": 46.4},
    {"g": 90, "t": 27.4, "h": 46.4},
    {"g": 90, "t": 27.4, "h": 46.4},
    {"g": 90, "t": 27.4, "h": 46.4},
    {"g": 90, "t": 27.4, "h": 46.4}
  ]
}

Response:
{
  "ok": true,
  "baselines": {
    "gas": 90,
    "temperature": 27.4,
    "humidity": 46.4
  }
}
```

### 2. Real-Time Data (POST /api/ingest)
```json
Request:
{
  "uid": "ABC123",
  "label": "room1",
  "h": 75.0,
  "t": 45.0,
  "g": 250,
  "f": 1,
  "alarm": 0
}

Response includes prediction:
{
  "ok": true,
  "alarm": 0,
  "prediction": {
    "riskLevel": "HIGH",
    "timeToAlarm": 30,  // 30 seconds!
    "probabilities": {
      "gas": 0.6,
      "temperature": 0.5,
      "humidity": 0.8,
      "overall": 0.8
    },
    "confidence": 0.85,
    "recommendations": [
      {
        "priority": "HIGH",
        "message": "⏰ Alarm in 30 seconds",
        "action": "Prepare safety measures immediately"
      }
    ]
  }
}
```

## Frontend Display

### Device Widget
```html
<div class="prediction-time">
  <div class="d-flex align-items-center justify-content-between">
    <span class="time-label small text-warning fw-bold">
      ⏰ Time to alarm:
    </span>
    <span class="time-value small fw-bold text-warning">
      30s
    </span>
  </div>
</div>
```

### Countdown Animation
- Updates every second
- Shows exact seconds for precision
- Blinks when < 10 seconds
- Color changes based on urgency

## Testing Examples

### Test 1: Slow Gas Increase
```
Baseline: 90
Threshold: 400
Rate: +1/second

Current: 100 → Time: 300s (5 minutes)
Current: 200 → Time: 200s (3m 20s)
Current: 300 → Time: 100s (1m 40s)
Current: 350 → Time: 50s
Current: 390 → Time: 10s (🚨 BLINKING)
Current: 395 → Time: 5s (🚨 CRITICAL)
Current: 400 → Time: 0s (🚨 NOW!)
```

### Test 2: Fast Temperature Rise
```
Baseline: 27.4°C
Threshold: 60°C
Rate: +2°C/second

Current: 40°C → Time: 10s (🚨 CRITICAL)
Current: 50°C → Time: 5s (🚨 BLINKING)
Current: 58°C → Time: 1s (🚨 IMMEDIATE)
Current: 60°C → Time: 0s (🚨 ALARM!)
```

### Test 3: Humidity Approaching High
```
Baseline: 46.4%
Low: 20%, High: 80%
Rate: +0.5%/second

Current: 70% → Time: 20s (⚠️ WARNING)
Current: 75% → Time: 10s (🚨 CRITICAL)
Current: 78% → Time: 4s (🚨 BLINKING)
Current: 80% → Time: 0s (🚨 ALARM!)
```

## Key Features

✅ **Exact Countdown**: Shows precise seconds (6, 5, 4, 3, 2, 1...)
✅ **Uses Calibration**: Based on safe baseline values
✅ **All Sensors**: Works for gas, temperature, humidity
✅ **Rate Analysis**: Uses last 10 readings for accuracy
✅ **Visual Feedback**: Colors, icons, blinking animations
✅ **Real-Time Updates**: Updates every second
✅ **Smart Predictions**: Only shows when trend is reliable

## Configuration

Users can adjust thresholds in the Config tab:
- Gas threshold (0-1023)
- Temperature threshold (°C)
- Humidity range (low-high %)

Calibration baselines are set automatically on ESP8266 boot.
