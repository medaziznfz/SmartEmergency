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

const unsigned long sendInterval   = 1000;
const unsigned long redFlashSpeed  = 200;
unsigned long configIntervalMs    = 30000;  // from server (config_pull_interval_sec * 1000)

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
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClient wifiClient;
  HTTPClient http;

  String url = makeUrl("/api/device-config/") + deviceUID + "?label=" + deviceLabel;

  http.setTimeout(2500);
  if (!http.begin(wifiClient, url)) {
    Serial.println("CFG: http.begin failed");
    return;
  }

  http.addHeader("X-API-KEY", apiKey);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();

    StaticJsonDocument<384> doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (!err && doc["ok"] == true) {
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

      Serial.printf("CFG OK => gas=%d(%s) temp=%.1f(%s) flame=%d hum[%.1f..%.1f](%s) buzzer=%s redLight=%s pull=%lus\n",
                    GAS_THRESHOLD, GAS_ENABLED ? "on" : "off",
                    TEMP_THRESHOLD, TEMP_ENABLED ? "on" : "off",
                    FLAME_ENABLED, HUM_LOW, HUM_HIGH, HUM_ENABLED ? "on" : "off",
                    BUZZER_ENABLED ? "on" : "off", RED_LIGHT_ENABLED ? "on" : "off",
                    (unsigned long)(configIntervalMs / 1000));
    } else {
      Serial.println("CFG: parse/ok error");
    }
  } else {
    Serial.printf("CFG HTTP code: %d\n", code);
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

  // Note: Alarm state is now determined by server response
  // ESP only handles local outputs based on server-confirmed alarm state
  // This prevents fake alarms due to mismatched calculations

  if (danger) {
    if (!isAlarmActive) {
      Serial.println("\n⚠️ Local danger detected - waiting for server confirmation...");
      Serial.printf("Local triggers: flame=%d gas=%d temp=%d humidity=%d\n",
                    flameBad, gasHigh, tempHigh, humBad);
      // Don't set isAlarmActive here - wait for server confirmation
    }
  } else {
    if (isAlarmActive) {
      Serial.println("Local danger cleared - waiting for server confirmation...");
      // Don't clear isAlarmActive here - wait for server confirmation
    }
  }

  // Control outputs based on server-confirmed alarm state only
  if (isAlarmActive) {
    if (BUZZER_ENABLED) {
      digitalWrite(BUZZER, HIGH);
    } else {
      digitalWrite(BUZZER, LOW);
    }

    if (RED_LIGHT_ENABLED) {
      if (nowMs - prevRedMillis >= redFlashSpeed) {
        prevRedMillis = nowMs;
        redToggle = !redToggle;
        digitalWrite(RED_LED_1, redToggle);
        digitalWrite(RED_LED_2, !redToggle);
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
    Serial.println("WiFi disconnected, reconnecting...");
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
  json += "\"alarm\":" + String(isAlarmActive ? 1 : 0) + ",";  // Send current state for reference
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
    
    // Read server response to get confirmed alarm state
    String response = http.getString();
    Serial.printf("Server response: %s\n", response.substring(0, 100));
    
    // Parse JSON response to get server-confirmed alarm state
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, response);
    
    if (!err && doc["ok"] == true) {
      bool serverAlarm = doc["alarm"] | false;
      if (serverAlarm != isAlarmActive) {
        isAlarmActive = serverAlarm;
        Serial.printf("🔥 Alarm state updated by server: %s\n", isAlarmActive ? "ACTIVE" : "SAFE");
      }
    }
  } else {
    Serial.printf("POST failed: %s\n", http.errorToString(code).c_str());
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

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED_1, LOW);
  digitalWrite(RED_LED_2, LOW);
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
}

void loop() {
  unsigned long nowMs = millis();

  if (nowMs - prevCfgMillis >= configIntervalMs) {
    prevCfgMillis = nowMs;
    fetchConfig();
  }

  if (nowMs - prevSendMillis >= sendInterval) {
    prevSendMillis = nowMs;

    digitalWrite(GREEN_LED, !digitalRead(GREEN_LED)); // heartbeat

    readSensors();
    checkSafety(nowMs);
    sendSensorDataHTTP();
  }

  yield();
}
