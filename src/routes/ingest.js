import express from 'express';

function parseJSONMaybe(x) {
  if (!x) return null;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch { return null; }
}

export function makeIngestRouter({ db, io }) {
  const router = express.Router();

  async function ensureDevice({ uid, label, ip, rssi }) {
    await db.query(
      `INSERT INTO devices (uid, label, last_ip, last_rssi, last_seen)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         label=VALUES(label),
         last_ip=VALUES(last_ip),
         last_rssi=VALUES(last_rssi),
         last_seen=NOW()`,
      [uid, label, ip, Number.isFinite(rssi) ? rssi : null]
    );

    const [rows] = await db.query(`SELECT id FROM devices WHERE uid=? LIMIT 1`, [uid]);
    return rows?.[0]?.id || null;
  }

  async function getOrCreateThresholds(deviceId) {
    const [rows] = await db.query(
      `SELECT gas_threshold, temp_threshold, flame_enabled,
              humidity_low_threshold, humidity_high_threshold, humidity_enabled
       FROM thresholds WHERE device_id=? LIMIT 1`,
      [deviceId]
    );

    if (rows.length) return rows[0];

    await db.query(
      `INSERT INTO thresholds
       (device_id, gas_threshold, temp_threshold, flame_enabled,
        humidity_low_threshold, humidity_high_threshold, humidity_enabled)
       VALUES (?, 400, 60.00, 1, 20.00, 80.00, 0)`,
      [deviceId]
    );

    return {
      gas_threshold: 400,
      temp_threshold: 60.0,
      flame_enabled: 1,
      humidity_low_threshold: 20.0,
      humidity_high_threshold: 80.0,
      humidity_enabled: 0
    };
  }

  async function getOpenAlarmEvent(deviceId) {
    const [rows] = await db.query(
      `SELECT id, started_at, triggers, peak_gas, peak_temp, peak_humidity
       FROM alarm_events
       WHERE device_id=? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
      [deviceId]
    );
    return rows[0] || null;
  }

  async function startAlarmEvent(deviceId, triggers, r) {
    await db.query(
      `INSERT INTO alarm_events (device_id, triggers, peak_gas, peak_temp, peak_humidity)
       VALUES (?, ?, ?, ?, ?)`,
      [deviceId, JSON.stringify(triggers), r.g, r.t, r.h]
    );
  }

  async function updateAlarmEvent(event, triggersUnion, r) {
    const peakGas = Math.max(event.peak_gas ?? 0, r.g);
    const peakTemp = Math.max(Number(event.peak_temp ?? 0), r.t);
    const peakHum = Math.max(Number(event.peak_humidity ?? 0), r.h);

    await db.query(
      `UPDATE alarm_events
       SET triggers=?, peak_gas=?, peak_temp=?, peak_humidity=?
       WHERE id=?`,
      [JSON.stringify(triggersUnion), peakGas, peakTemp, peakHum, event.id]
    );
  }

  async function closeAlarmEvent(eventId) {
    await db.query(
      `UPDATE alarm_events
       SET ended_at=NOW(),
           duration_seconds=TIMESTAMPDIFF(SECOND, started_at, NOW())
       WHERE id=?`,
      [eventId]
    );
  }

  // ========= ESP pulls per-device thresholds =========
  router.get('/device-config/:uid', async (req, res) => {
    try {
      const apiKey = req.header('X-API-KEY');
      if (!apiKey || apiKey !== process.env.IOT_API_KEY) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      const uid = String(req.params.uid || '').trim();
      const label = String(req.query.label || 'unknown').trim();
      if (!uid) return res.status(400).json({ ok: false, error: 'Invalid uid' });

      const ip =
        (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) ||
        req.socket.remoteAddress?.replace('::ffff:', '') ||
        'unknown';

      const deviceId = await ensureDevice({ uid, label, ip, rssi: null });
      if (!deviceId) return res.status(500).json({ ok: false, error: 'Device error' });

      const th = await getOrCreateThresholds(deviceId);

      return res.json({
        ok: true,
        uid,
        gas_threshold: Number(th.gas_threshold),
        temp_threshold: Number(th.temp_threshold),
        flame_enabled: Number(th.flame_enabled),
        humidity_low_threshold: Number(th.humidity_low_threshold),
        humidity_high_threshold: Number(th.humidity_high_threshold),
        humidity_enabled: Number(th.humidity_enabled)
      });
    } catch (e) {
      console.error('device-config error:', e);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  });

  // ========= ESP sends readings =========
  router.post('/ingest', async (req, res) => {
    try {
      const apiKey = req.header('X-API-KEY');
      if (!apiKey || apiKey !== process.env.IOT_API_KEY) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }

      const b = req.body || {};
      const uid = typeof b.uid === 'string' ? b.uid.trim() : '';
      const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : 'unknown';

      const h = Number(b.h);
      const t = Number(b.t);
      const g = Number(b.g);
      const f = Number(b.f);

      const alarmDevice = Number.isFinite(Number(b.alarm)) ? (Number(b.alarm) === 1 ? 1 : 0) : 0;
      const rssi = b.rssi !== undefined ? Number(b.rssi) : null;

      if (!uid) return res.status(400).json({ ok: false, error: 'Invalid uid' });
      if (![h, t, g, f].every(Number.isFinite)) {
        return res.status(400).json({ ok: false, error: 'Invalid sensor values' });
      }

      const ip =
        (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) ||
        req.socket.remoteAddress?.replace('::ffff:', '') ||
        'unknown';

      const deviceId = await ensureDevice({ uid, label, ip, rssi });
      if (!deviceId) return res.status(500).json({ ok: false, error: 'Device error' });

      const th = await getOrCreateThresholds(deviceId);

      // Compute server-side triggers (per-device thresholds)
      const flameDetected = Number(th.flame_enabled) === 1 && Number(f) === 0;
      const gasHigh = Number(g) >= Number(th.gas_threshold);
      const tempHigh = Number(t) >= Number(th.temp_threshold);

      const humEnabled = Number(th.humidity_enabled) === 1;
      const humLow = Number(th.humidity_low_threshold);
      const humHigh = Number(th.humidity_high_threshold);
      const humidityBad = humEnabled && (Number(h) < humLow || Number(h) > humHigh);

      const alarmComputed = (flameDetected || gasHigh || tempHigh || humidityBad) ? 1 : 0;

      const triggersNow = { flame: flameDetected, gas: gasHigh, temp: tempHigh, humidity: humidityBad };

      // Store reading
      await db.query(
        `INSERT INTO readings (device_id, humidity, temperature, gas, flame, alarm, triggers, alarm_device)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [deviceId, h, t, g, f, alarmComputed, JSON.stringify(triggersNow), alarmDevice]
      );

      // Alarm events with duration
      const openEvent = await getOpenAlarmEvent(deviceId);

      if (alarmComputed === 1) {
        if (!openEvent) {
          await startAlarmEvent(deviceId, triggersNow, { h, t, g });
        } else {
          const oldTriggers = parseJSONMaybe(openEvent.triggers) || {};
          const union = {
            flame: Boolean(oldTriggers.flame) || flameDetected,
            gas: Boolean(oldTriggers.gas) || gasHigh,
            temp: Boolean(oldTriggers.temp) || tempHigh,
            humidity: Boolean(oldTriggers.humidity) || humidityBad
          };
          await updateAlarmEvent(openEvent, union, { h, t, g });
        }
      } else {
        if (openEvent) await closeAlarmEvent(openEvent.id);
      }

      const payload = {
        uid,
        label,
        h, t, g, f,
        alarm: alarmComputed,
        alarm_device: alarmDevice,
        triggers: triggersNow,
        thresholds: {
          gas_threshold: Number(th.gas_threshold),
          temp_threshold: Number(th.temp_threshold),
          flame_enabled: Number(th.flame_enabled),
          humidity_low_threshold: Number(th.humidity_low_threshold),
          humidity_high_threshold: Number(th.humidity_high_threshold),
          humidity_enabled: Number(th.humidity_enabled)
        },
        rssi: Number.isFinite(rssi) ? rssi : null,
        ip,
        ts: new Date().toISOString()
      };

      io.emit('reading', payload);
      return res.json({ ok: true, alarm: alarmComputed, triggers: triggersNow });
    } catch (e) {
      console.error('Ingest error:', e);
      return res.status(500).json({ ok: false, error: 'Server error' });
    }
  });

  return router;
}
