#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ================= WiFi =================
const char* ssid     = "OrangeWifi-6B40";
const char* password = "qKQf94xNuaZy";

// ================= Server =================
const char* serverBase = "http://192.168.1.10:3000";
const char* apiKey     = "CHANGE_ME_TO_SOMETHING_SECRET";

// Change label per device (room1, room2, kitchen...)
const String deviceLabel = "room1";

// ================= Static IP (optional) =================
#define USE_STATIC_IP 1
#if USE_STATIC_IP
IPAddress local_IP(192, 168, 1, 100);   // change per device (.101 .102 ...)
IPAddress gateway(192, 168, 1, 1);
IPAddress subnet(255, 255, 255, 0);
#endif

// ================= Pins =================
#define GREEN_LED 12   // D6
#define RED_LED_1 16   // D0
#define RED_LED_2 2    // D4
#define BUZZER    14   // D5
#define FLAME_PIN 5    // D1
#define DHTPIN    4    // D2
#define MQ2_PIN   A0

// ================= DHT =================
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// ================= Timers =================
unsigned long prevSendMillis = 0;
unsigned long prevRedMillis  = 0;
unsigned long prevCfgMillis  = 0;

unsigned long sendIntervalMs   = 1000;  // from server (send_interval_sec * 1000)
unsigned long redFlashSpeedMs  = 200;   // from server (red_led_flash_speed_ms)
unsigned long configIntervalMs = 30000; // from server (config_pull_interval_sec * 1000)

// ================= Thresholds (from web) =================
int   GAS_THRESHOLD  = 400;
bool  GAS_ENABLED    = true;
float TEMP_THRESHOLD = 60.0;
bool  TEMP_ENABLED  = true;
bool  FLAME_ENABLED  = true;

// Humidity range thresholds
bool  HUM_ENABLED = false;
float HUM_LOW = 20.0;
float HUM_HIGH = 80.0;

// Alarm outputs (from web: enable/disable buzzer and red LEDs)
bool BUZZER_ENABLED   = true;
bool RED_LIGHT_ENABLED = true;

// ================= State =================
bool isAlarmActive = false;
bool redToggle = LOW;

// Cached sensor readings
float lastH = NAN;
float lastT = NAN;
int lastGas = 0;
int lastFlame = 1;

// Unique ID
String deviceUID;

// ---------------- helpers ----------------
String makeUrl(const String& path) {
  return String(serverBase) + path;
}

void wifiConnect() {
  Serial.println("\n==== CONNECTING WIFI ====");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

#if USE_STATIC_IP
  WiFi.config(local_IP, gateway, subnet);
#endif

  WiFi.begin(ssid, password);

  Serial.print("Connecting");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println("\nWiFi timeout, retry...");
      WiFi.disconnect();
      delay(500);
      WiFi.begin(ssid, password);
      start = millis();
    }
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  Serial.print("RSSI: ");
  Serial.println(WiFi.RSSI());
}

// GET /api/device-config/:uid?label=room1
void fetchConfig() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("CFG: WiFi not connected, using default config");
    return;
  }

  WiFiClient wifiClient;
  HTTPClient http;

  String url = makeUrl("/api/device-config/") + deviceUID + "?label=" + deviceLabel;

  http.setTimeout(2500);
  if (!http.begin(wifiClient, url)) {
    Serial.println("CFG: http.begin failed, using default config");
    return;
  }

  http.addHeader("X-API-KEY", apiKey);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();

    StaticJsonDocument<384> doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (!err && doc["ok"] == true) {
      // Update all config from server when connected
      GAS_THRESHOLD  = doc["gas_threshold"]  | GAS_THRESHOLD;
      GAS_ENABLED    = ((doc["gas_enabled"]    | 1) == 1);
      TEMP_THRESHOLD = doc["temp_threshold"] | TEMP_THRESHOLD;
      TEMP_ENABLED   = ((doc["temp_enabled"]   | 1) == 1);
      FLAME_ENABLED  = ((doc["flame_enabled"]  | 1) == 1);

      HUM_LOW   = doc["humidity_low_threshold"]  | HUM_LOW;
      HUM_HIGH  = doc["humidity_high_threshold"] | HUM_HIGH;
      HUM_ENABLED = ((doc["humidity_enabled"] | 0) == 1);

      BUZZER_ENABLED    = doc["buzzer_enabled"].isNull()    ? true : (doc["buzzer_enabled"].as<int>() == 1);
      RED_LIGHT_ENABLED = doc["red_light_enabled"].isNull() ? true : (doc["red_light_enabled"].as<int>() == 1);

      int pullSec = doc["config_pull_interval_sec"] | 30;
      if (pullSec < 5) pullSec = 5;
      if (pullSec > 600) pullSec = 600;
      configIntervalMs = (unsigned long)pullSec * 1000;

      int sendSec = doc["send_interval_sec"] | 1;
      if (sendSec < 1) sendSec = 1;
      if (sendSec > 60) sendSec = 60;
      sendIntervalMs = (unsigned long)sendSec * 1000;

      int flashMs = doc["red_led_flash_speed_ms"] | 200;
      if (flashMs < 50) flashMs = 50;
      if (flashMs > 2000) flashMs = 2000;
      redFlashSpeedMs = (unsigned long)flashMs;

      Serial.printf("CFG OK => gas=%d(%s) temp=%.1f(%s) flame=%d hum[%.1f..%.1f](%s) buzzer=%s redLight=%s pull=%lus send=%lus flash=%lums\n",
                    GAS_THRESHOLD, GAS_ENABLED ? "on" : "off",
                    TEMP_THRESHOLD, TEMP_ENABLED ? "on" : "off",
                    FLAME_ENABLED, HUM_LOW, HUM_HIGH, HUM_ENABLED ? "on" : "off",
                    BUZZER_ENABLED ? "on" : "off", RED_LIGHT_ENABLED ? "on" : "off",
                    (unsigned long)(configIntervalMs / 1000), 
                    (unsigned long)(sendIntervalMs / 1000),
                    redFlashSpeedMs);
    } else {
      Serial.println("CFG: parse/ok error, using default config");
    }
  } else {
    Serial.printf("CFG HTTP code: %d, using default config\n", code);
  }

  http.end();
}

void readSensors() {
  lastGas = analogRead(MQ2_PIN);
  lastFlame = digitalRead(FLAME_PIN);

  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (!isnan(h)) lastH = h;
  if (!isnan(t)) lastT = t;
}

bool humidityBad() {
  if (!HUM_ENABLED) return false;
  if (isnan(lastH)) return false;
  return (lastH < HUM_LOW || lastH > HUM_HIGH);
}

void checkSafety(unsigned long nowMs) {
  bool flameDetected = (lastFlame == LOW);
  bool gasHigh   = GAS_ENABLED   && (lastGas >= GAS_THRESHOLD);
  bool tempHigh  = TEMP_ENABLED  && (!isnan(lastT) && lastT >= TEMP_THRESHOLD);
  bool humBad    = humidityBad();
  bool flameBad  = FLAME_ENABLED && flameDetected;

  bool danger = gasHigh || tempHigh || humBad || flameBad;

  // ESP controls alarm state directly based on local sensor readings
  if (danger && !isAlarmActive) {
    Serial.println("\nALARM STARTED - Local detection!");
    Serial.printf("Triggers: flame=%d gas=%d temp=%d humidity=%d\n",
                  flameBad, gasHigh, tempHigh, humBad);
    isAlarmActive = true;
  } else if (!danger && isAlarmActive) {
    Serial.println("Alarm cleared - Local detection");
    isAlarmActive = false;
  }

  // Control outputs based on local alarm state
  if (isAlarmActive) {
    if (BUZZER_ENABLED) {
      digitalWrite(BUZZER, HIGH);
    } else {
      digitalWrite(BUZZER, LOW);
    }

    if (RED_LIGHT_ENABLED) {
      if (nowMs - prevRedMillis >= redFlashSpeedMs) {
        prevRedMillis = nowMs;
        redToggle = !redToggle;
        digitalWrite(RED_LED_1, redToggle);
        digitalWrite(RED_LED_2, !redToggle);
        Serial.printf("LED toggle: %d (flash speed: %lums)\n", redToggle, redFlashSpeedMs);
      }
    } else {
      digitalWrite(RED_LED_1, LOW);
      digitalWrite(RED_LED_2, LOW);
    }
  } else {
    digitalWrite(BUZZER, LOW);
    digitalWrite(RED_LED_1, LOW);
    digitalWrite(RED_LED_2, LOW);
  }
}

void sendSensorDataHTTP() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, trying to reconnect...");
    WiFi.reconnect();
    return;
  }

  String json;
  json.reserve(240);

  json += "{";
  json += "\"uid\":\"" + deviceUID + "\",";
  json += "\"label\":\"" + deviceLabel + "\",";
  json += "\"h\":" + String(lastH, 1) + ",";
  json += "\"t\":" + String(lastT, 1) + ",";
  json += "\"g\":" + String(lastGas) + ",";
  json += "\"f\":" + String(lastFlame) + ",";
  json += "\"alarm\":" + String(isAlarmActive ? 1 : 0) + ",";
  json += "\"rssi\":" + String(WiFi.RSSI());
  json += "}";

  Serial.println(json);

  WiFiClient wifiClient;
  HTTPClient http;

  String url = makeUrl("/api/ingest");
  http.setTimeout(2500);

  if (!http.begin(wifiClient, url)) {
    Serial.println("HTTP begin failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-KEY", apiKey);

  int code = http.POST(json);
  if (code > 0) {
    Serial.printf("POST code: %d\n", code);
    
    // Try to read server response but don't depend on it for alarm state
    String response = http.getString();
    Serial.printf("Server response: %s\n", response.substring(0, 100));
    
    // Parse response to get updated config, but ignore alarm state from server
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, response);
    
    if (!err && doc["ok"] == true) {
      // Update config if server sends new thresholds
      if (doc.containsKey("gas_threshold")) {
        Serial.println("Received updated config from server");
        // Note: We could update config here, but ESP works independently
      }
    } else {
      Serial.printf("Server response error (ESP continues working independently): %s\n", err.c_str());
    }
  } else {
    Serial.printf("Server POST failed (ESP continues working independently): %s\n", http.errorToString(code).c_str());
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED_1, OUTPUT);
  pinMode(RED_LED_2, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(FLAME_PIN, INPUT);

  // Test red LEDs at startup
  Serial.println("Testing red LEDs...");
  digitalWrite(RED_LED_1, HIGH);
  digitalWrite(RED_LED_2, HIGH);
  delay(500);
  digitalWrite(RED_LED_1, LOW);
  digitalWrite(RED_LED_2, LOW);
  Serial.println("Red LED test completed");

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(BUZZER, LOW);

  dht.begin();

  Serial.println("\n==== SYSTEM BOOTING: SmartEmergency Station ====");
  wifiConnect();

  deviceUID = String(ESP.getChipId(), HEX);
  deviceUID.toUpperCase();

  Serial.print("UID: ");
  Serial.println(deviceUID);

  fetchConfig();   // pull thresholds once
  readSensors();   // initial values

  // Test red LED flashing with current settings
  Serial.println("Testing red LED flashing...");
  Serial.printf("Flash speed: %lums, Red light enabled: %s\n", redFlashSpeedMs, RED_LIGHT_ENABLED ? "YES" : "NO");
  
  for (int i = 0; i < 5; i++) {
    digitalWrite(RED_LED_1, HIGH);
    digitalWrite(RED_LED_2, LOW);
    delay(redFlashSpeedMs);
    digitalWrite(RED_LED_1, LOW);
    digitalWrite(RED_LED_2, HIGH);
    delay(redFlashSpeedMs);
  }
  digitalWrite(RED_LED_1, LOW);
  digitalWrite(RED_LED_2, LOW);
  Serial.println("Red LED flash test completed");
}

void loop() {
  unsigned long nowMs = millis();

  if (nowMs - prevCfgMillis >= configIntervalMs) {
    prevCfgMillis = nowMs;
    fetchConfig();
  }

  if (nowMs - prevSendMillis >= sendIntervalMs) {
    prevSendMillis = nowMs;

    digitalWrite(GREEN_LED, !digitalRead(GREEN_LED)); // heartbeat

    readSensors();
    checkSafety(nowMs);
    sendSensorDataHTTP();
  }

  yield();
}
