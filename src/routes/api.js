import express from 'express';

function parseJSONMaybe(x) {
  if (!x) return null;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch { return null; }
}

export function makeApiRouter({ db }) {
  const router = express.Router();
  const ONLINE_SECONDS = Number(process.env.DEVICE_ONLINE_SECONDS || 20);

  async function getDevice(uid) {
    const [rows] = await db.query(`SELECT id, uid, label FROM devices WHERE uid=? LIMIT 1`, [uid]);
    return rows[0] || null;
  }

  async function getOrCreateThresholds(deviceId) {
    const [rows] = await db.query(
      `SELECT gas_threshold, gas_enabled, temp_threshold, temp_enabled, flame_enabled,
              humidity_low_threshold, humidity_high_threshold, humidity_enabled,
              buzzer_enabled, red_light_enabled, config_pull_interval_sec, updated_at
       FROM thresholds WHERE device_id=? LIMIT 1`,
      [deviceId]
    );

    if (rows.length) {
      const r = rows[0];
      return {
        gas_threshold: r.gas_threshold,
        gas_enabled: r.gas_enabled ?? 1,
        temp_threshold: r.temp_threshold,
        temp_enabled: r.temp_enabled ?? 1,
        flame_enabled: r.flame_enabled,
        humidity_low_threshold: r.humidity_low_threshold,
        humidity_high_threshold: r.humidity_high_threshold,
        humidity_enabled: r.humidity_enabled,
        buzzer_enabled: r.buzzer_enabled ?? 1,
        red_light_enabled: r.red_light_enabled ?? 1,
        config_pull_interval_sec: r.config_pull_interval_sec,
        updated_at: r.updated_at
      };
    }

    await db.query(
      `INSERT INTO thresholds
       (device_id, gas_threshold, gas_enabled, temp_threshold, temp_enabled, flame_enabled,
        humidity_low_threshold, humidity_high_threshold, humidity_enabled, buzzer_enabled, red_light_enabled, config_pull_interval_sec)
       VALUES (?, 400, 1, 60.00, 1, 1, 20.00, 80.00, 0, 1, 1, 30)`,
      [deviceId]
    );

    return {
      gas_threshold: 400,
      gas_enabled: 1,
      temp_threshold: 60.0,
      temp_enabled: 1,
      flame_enabled: 1,
      humidity_low_threshold: 20.0,
      humidity_high_threshold: 80.0,
      humidity_enabled: 0,
      buzzer_enabled: 1,
      red_light_enabled: 1,
      config_pull_interval_sec: 30,
      updated_at: new Date()
    };
  }

  // Devices list with online status; optional ?withThresholds=1 to include threshold values
  router.get('/devices', async (req, res) => {
    const withThresholds = req.query.withThresholds === '1' || req.query.withThresholds === 'true';
    const [rows] = await db.query(
      withThresholds
        ? `SELECT d.uid, d.label, d.last_ip, d.last_rssi, d.last_seen,
                 TIMESTAMPDIFF(SECOND, d.last_seen, NOW()) AS last_seen_age,
                 CASE WHEN d.last_seen IS NOT NULL AND TIMESTAMPDIFF(SECOND, d.last_seen, NOW()) <= ? THEN 1 ELSE 0 END AS is_online,
                 t.gas_threshold, t.gas_enabled, t.temp_threshold, t.temp_enabled, t.flame_enabled,
                 t.humidity_low_threshold, t.humidity_high_threshold, t.humidity_enabled,
                 t.buzzer_enabled, t.red_light_enabled, t.config_pull_interval_sec, t.updated_at AS thresholds_updated_at
           FROM devices d
           LEFT JOIN thresholds t ON t.device_id = d.id
           ORDER BY d.last_seen DESC`
        : `SELECT uid, label, last_ip, last_rssi, last_seen,
                 TIMESTAMPDIFF(SECOND, last_seen, NOW()) AS last_seen_age,
                 CASE WHEN last_seen IS NOT NULL AND TIMESTAMPDIFF(SECOND, last_seen, NOW()) <= ? THEN 1 ELSE 0 END AS is_online
           FROM devices ORDER BY last_seen DESC`,
      [ONLINE_SECONDS]
    );
    res.json(rows);
  });

  // Latest reading
  router.get('/devices/:uid/latest', async (req, res) => {
    const uid = req.params.uid;
    const [rows] = await db.query(
      `SELECT d.uid, d.label, r.ts, r.humidity, r.temperature, r.gas, r.flame,
              r.alarm, r.alarm_device, r.triggers
       FROM devices d
       JOIN readings r ON r.device_id = d.id
       WHERE d.uid=?
       ORDER BY r.ts DESC
       LIMIT 1`,
      [uid]
    );
    if (!rows[0]) return res.json(null);
    rows[0].triggers = parseJSONMaybe(rows[0].triggers);
    res.json(rows[0]);
  });

  // Readings history for chart + table
  router.get('/devices/:uid/history', async (req, res) => {
    const uid = req.params.uid;
    const limit = Math.min(Number(req.query.limit || 500), 5000);
    const from = req.query.from || null;
    const to = req.query.to || null;

    const params = [uid];
    let where = `WHERE d.uid=?`;
    if (from) { where += ` AND r.ts >= ?`; params.push(from); }
    if (to) { where += ` AND r.ts <= ?`; params.push(to); }
    params.push(limit);

    const [rows] = await db.query(
      `SELECT r.ts, r.humidity, r.temperature, r.gas, r.flame, r.alarm, r.alarm_device, r.triggers
       FROM devices d
       JOIN readings r ON r.device_id = d.id
       ${where}
       ORDER BY r.ts DESC
       LIMIT ?`,
      params
    );

    const data = rows.reverse().map(r => ({ ...r, triggers: parseJSONMaybe(r.triggers) }));
    res.json(data);
  });

  // Thresholds per device (GET)
  router.get('/devices/:uid/thresholds', async (req, res) => {
    const dev = await getDevice(req.params.uid);
    if (!dev) return res.status(404).json({ ok: false, error: 'Device not found' });

    const th = await getOrCreateThresholds(dev.id);
    res.json({
      ok: true,
      uid: dev.uid,
      label: dev.label,
      gas_threshold: Number(th.gas_threshold),
      gas_enabled: Number(th.gas_enabled),
      temp_threshold: Number(th.temp_threshold),
      temp_enabled: Number(th.temp_enabled),
      flame_enabled: Number(th.flame_enabled),
      humidity_low_threshold: Number(th.humidity_low_threshold),
      humidity_high_threshold: Number(th.humidity_high_threshold),
      humidity_enabled: Number(th.humidity_enabled),
      buzzer_enabled: Number(th.buzzer_enabled),
      red_light_enabled: Number(th.red_light_enabled),
      config_pull_interval_sec: Number(th.config_pull_interval_sec),
      updated_at: th.updated_at
    });
  });

  // Thresholds per device (PUT)
  router.put('/devices/:uid/thresholds', async (req, res) => {
    const dev = await getDevice(req.params.uid);
    if (!dev) return res.status(404).json({ ok: false, error: 'Device not found' });

    const gas = Number(req.body?.gas_threshold);
    const temp = Number(req.body?.temp_threshold);
    const gasEnabled = Number(req.body?.gas_enabled) === 1 ? 1 : 0;
    const tempEnabled = Number(req.body?.temp_enabled) === 1 ? 1 : 0;
    const flameEnabled = Number(req.body?.flame_enabled) === 1 ? 1 : 0;
    const humEnabled = Number(req.body?.humidity_enabled) === 1 ? 1 : 0;
    const buzzerEnabled = Number(req.body?.buzzer_enabled) === 1 ? 1 : 0;
    const redLightEnabled = Number(req.body?.red_light_enabled) === 1 ? 1 : 0;
    const humLow = Number(req.body?.humidity_low_threshold);
    const humHigh = Number(req.body?.humidity_high_threshold);
    const pullInterval = Number(req.body?.config_pull_interval_sec);
    if (!Number.isFinite(pullInterval) || pullInterval < 5 || pullInterval > 600) {
      return res.status(400).json({ ok: false, error: 'config_pull_interval_sec must be 5..600' });
    }

    if (!Number.isFinite(gas) || gas < 0 || gas > 1023) {
      return res.status(400).json({ ok: false, error: 'gas_threshold must be 0..1023' });
    }
    if (!Number.isFinite(temp) || temp < -20 || temp > 120) {
      return res.status(400).json({ ok: false, error: 'temp_threshold must be -20..120' });
    }
    if (!Number.isFinite(humLow) || humLow < 0 || humLow > 100) {
      return res.status(400).json({ ok: false, error: 'humidity_low_threshold must be 0..100' });
    }
    if (!Number.isFinite(humHigh) || humHigh < 0 || humHigh > 100) {
      return res.status(400).json({ ok: false, error: 'humidity_high_threshold must be 0..100' });
    }
    if (humLow >= humHigh) {
      return res.status(400).json({ ok: false, error: 'humidity_low_threshold must be < humidity_high_threshold' });
    }

    await getOrCreateThresholds(dev.id);

    await db.query(
      `UPDATE thresholds
       SET gas_threshold=?, gas_enabled=?, temp_threshold=?, temp_enabled=?, flame_enabled=?,
           humidity_low_threshold=?, humidity_high_threshold=?, humidity_enabled=?,
           buzzer_enabled=?, red_light_enabled=?, config_pull_interval_sec=?
       WHERE device_id=?`,
      [gas, gasEnabled, temp, tempEnabled, flameEnabled, humLow, humHigh, humEnabled, buzzerEnabled, redLightEnabled, pullInterval, dev.id]
    );

    res.json({ ok: true });
  });

  // Alarm history per device
  router.get('/devices/:uid/alarms', async (req, res) => {
    const uid = req.params.uid;
    const limit = Math.min(Number(req.query.limit || 100), 500);

    const [rows] = await db.query(
      `SELECT e.id, e.started_at, e.ended_at, e.duration_seconds,
              e.triggers, e.peak_gas, e.peak_temp, e.peak_humidity
       FROM devices d
       JOIN alarm_events e ON e.device_id = d.id
       WHERE d.uid=?
       ORDER BY e.started_at DESC
       LIMIT ?`,
      [uid, limit]
    );

    res.json(rows.map(r => ({ ...r, triggers: parseJSONMaybe(r.triggers) })));
  });

  // Active alarm (if any)
  router.get('/devices/:uid/alarms/active', async (req, res) => {
    const uid = req.params.uid;
    const [rows] = await db.query(
      `SELECT e.id, e.started_at, e.triggers, e.peak_gas, e.peak_temp, e.peak_humidity
       FROM devices d
       JOIN alarm_events e ON e.device_id = d.id
       WHERE d.uid=? AND e.ended_at IS NULL
       ORDER BY e.started_at DESC
       LIMIT 1`,
      [uid]
    );
    if (!rows[0]) return res.json(null);
    rows[0].triggers = parseJSONMaybe(rows[0].triggers);
    res.json(rows[0]);
  });

  // Latest alarms across all devices (optional global view) - supports filters & pagination
  router.get('/alarms', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const deviceUid = req.query.device || null;
    const from = req.query.from || null;
    const to = req.query.to || null;

    const params = [];
    let where = `WHERE 1=1`;
    if (deviceUid) { where += ` AND d.uid=?`; params.push(deviceUid); }
    if (from) { where += ` AND e.started_at >= ?`; params.push(from); }
    if (to) { where += ` AND e.started_at <= ?`; params.push(to); }

    // Count total
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM alarm_events e JOIN devices d ON d.id = e.device_id ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);

    const [rows] = await db.query(
      `SELECT d.uid, d.label, e.id, e.started_at, e.ended_at, e.duration_seconds, e.triggers,
              e.peak_gas, e.peak_temp, e.peak_humidity
       FROM alarm_events e
       JOIN devices d ON d.id = e.device_id
       ${where}
       ORDER BY e.started_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      items: rows.map(r => ({ ...r, triggers: parseJSONMaybe(r.triggers) })),
      total,
      limit,
      offset
    });
  });

  // Readings across all devices - filters & pagination for History tab
  router.get('/readings', async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const deviceUid = req.query.device || null;
    const from = req.query.from || null;
    const to = req.query.to || null;

    const params = [];
    let where = `WHERE 1=1`;
    if (deviceUid) { where += ` AND d.uid=?`; params.push(deviceUid); }
    if (from) { where += ` AND r.ts >= ?`; params.push(from); }
    if (to) { where += ` AND r.ts <= ?`; params.push(to); }

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM readings r JOIN devices d ON d.id = r.device_id ${where}`,
      params
    );
    const total = countRows[0]?.total ?? 0;

    params.push(limit, offset);

    const [rows] = await db.query(
      `SELECT d.uid, d.label, r.ts, r.humidity, r.temperature, r.gas, r.flame, r.alarm, r.triggers
       FROM readings r
       JOIN devices d ON d.id = r.device_id
       ${where}
       ORDER BY r.ts DESC
       LIMIT ? OFFSET ?`,
      params
    );

    res.json({
      items: rows.map(r => ({ ...r, triggers: parseJSONMaybe(r.triggers) })),
      total,
      limit,
      offset
    });
  });

  return router;
}
