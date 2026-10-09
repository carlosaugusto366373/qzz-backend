const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'qzz-admin-2025';

app.use(cors());
app.use(express.json());

function makeKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = (len) => {
    let s = '';
    const bytes = crypto.randomBytes(len);
    for (let i = 0; i < len; i++) s += chars[bytes[i] % chars.length];
    return s;
  };
  return `QZZ-${part(6)}-${part(6)}`;
}

function log(key, action, detail, ip) {
  db.prepare(`INSERT INTO logs (key, action, detail, ip, created_at) VALUES (?,?,?,?,?)`)
    .run(key, action, detail || '', ip || '', Date.now());
}

function authAdmin(req, res, next) {
  const pass = req.headers['x-admin-pass'];
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Não autorizado' });
  }
  next();
}

// ===== HELPER: converte periodo em timestamp inicial =====
function getInicio(periodo) {
  const agora = Date.now();
  const ms = {
    '1h':  60 * 60 * 1000,
    '1d':  24 * 60 * 60 * 1000,
    '7d':  7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  if (periodo === 'all' || !ms[periodo]) return 0; // 0 = sem filtro
  return agora - ms[periodo];
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ===== AUTH =====
app.post('/api/auth/login', (req, res) => {
  const { key, hwid } = req.body;
  const ip = req.ip;

  if (!key) return res.json({ success: false, message: 'Key não informada' });

  const row = db.prepare(`SELECT * FROM keys WHERE key = ?`).get(key.trim());

  if (!row) {
    log(key, 'login_fail', 'Key inexistente', ip);
    return res.json({ success: false, message: 'Key inválida' });
  }

  if (!row.active) {
    log(key, 'login_fail', 'Key desativada', ip);
    return res.json({ success: false, message: 'Key desativada' });
  }

  if (row.expires_at === 0) {
    const expiresAt = Date.now() + (row.duration_days * 86400000);
    db.prepare(`UPDATE keys SET expires_at = ? WHERE id = ?`).run(expiresAt, row.id);
    row.expires_at = expiresAt;
    log(key, 'first_activation', `Ativada — válida por ${row.duration_days} dias`, ip);
  }

  if (Date.now() > row.expires_at) {
    log(key, 'login_fail', 'Key expirada', ip);
    return res.json({ success: false, message: 'Key expirada' });
  }

  if (!row.hwid) {
    db.prepare(`UPDATE keys SET hwid = ?, activated_at = ?, last_ip = ? WHERE id = ?`)
      .run(hwid, Date.now(), ip, row.id);
    log(key, 'activate', `HWID registrado: ${hwid}`, ip);
  } else if (row.hwid !== hwid) {
    log(key, 'login_fail', `HWID diferente: ${hwid}`, ip);
    return res.json({ success: false, message: 'Key registrada em outro dispositivo' });
  } else {
    db.prepare(`UPDATE keys SET last_ip = ? WHERE id = ?`).run(ip, row.id);
  }

  log(key, 'login_ok', '', ip);

  return res.json({
    success: true,
    token: 'tk_' + Buffer.from(key + ':' + hwid).toString('base64'),
    expiresAt: row.expires_at
  });
});

app.get('/api/auth/session', (req, res) => {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '');
  if (!token) return res.json({ success: false });

  try {
    const decoded = Buffer.from(token.replace('tk_', ''), 'base64').toString();
    const [key, hwid] = decoded.split(':');
    const row = db.prepare(`SELECT * FROM keys WHERE key = ?`).get(key);

    if (!row || !row.active) return res.json({ success: false });
    if (row.expires_at === 0) return res.json({ success: false });
    if (Date.now() > row.expires_at) return res.json({ success: false });
    if (row.hwid && row.hwid !== hwid) return res.json({ success: false });

    return res.json({ success: true, expiresAt: row.expires_at });
  } catch (e) {
    return res.json({ success: false });
  }
});

// ===== ADMIN =====
app.post('/api/admin/generate', authAdmin, (req, res) => {
  const { days = 30, quantity = 1, note = '' } = req.body;
  const d = Math.max(1, parseInt(days) || 30);
  const q = Math.min(100, Math.max(1, parseInt(quantity) || 1));

  const created = [];
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO keys (key, duration_days, created_at, expires_at, note) VALUES (?, ?, ?, ?, ?)`);

  for (let i = 0; i < q; i++) {
    let newKey, tries = 0;
    do {
      newKey = makeKey();
      tries++;
    } while (db.prepare(`SELECT 1 FROM keys WHERE key = ?`).get(newKey) && tries < 10);

    insert.run(newKey, d, now, 0, note);
    created.push({ key: newKey, expiresAt: null, durationDays: d });
    log(newKey, 'generated', `${d} dias (aguardando ativação)`, req.ip);
  }

  res.json({ success: true, count: created.length, keys: created });
});

app.get('/api/admin/keys', authAdmin, (req, res) => {
  const rows = db.prepare(`SELECT key, hwid, duration_days, created_at, expires_at, activated_at, active, note FROM keys ORDER BY created_at DESC LIMIT 500`).all();
  res.json({ success: true, keys: rows });
});

app.post('/api/admin/toggle', authAdmin, (req, res) => {
  const { key } = req.body;
  const row = db.prepare(`SELECT * FROM keys WHERE key = ?`).get(key);
  if (!row) return res.json({ success: false, message: 'Key não encontrada' });
  const newState = row.active ? 0 : 1;
  db.prepare(`UPDATE keys SET active = ? WHERE id = ?`).run(newState, row.id);
  log(key, newState ? 'reactivated' : 'deactivated', '', req.ip);
  res.json({ success: true, active: newState });
});

app.post('/api/admin/reset-hwid', authAdmin, (req, res) => {
  const { key } = req.body;
  db.prepare(`UPDATE keys SET hwid = NULL, activated_at = NULL WHERE key = ?`).run(key);
  log(key, 'hwid_reset', '', req.ip);
  res.json({ success: true });
});

app.post('/api/admin/delete', authAdmin, (req, res) => {
  const { key } = req.body;
  db.prepare(`DELETE FROM keys WHERE key = ?`).run(key);
  log(key, 'deleted', '', req.ip);
  res.json({ success: true });
});

// ===== LOGS COM FILTRO DE PERÍODO =====
app.get('/api/admin/logs', authAdmin, (req, res) => {
  const periodo = req.query.periodo || '1h';
  const inicio = getInicio(periodo);

  let rows;
  if (inicio === 0) {
    rows = db.prepare(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 500`).all();
  } else {
    rows = db.prepare(`SELECT * FROM logs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500`).all(inicio);
  }

  res.json({ success: true, logs: rows });
});

// ===== STATS COM FILTRO DE PERÍODO =====
app.get('/api/admin/stats', authAdmin, (req, res) => {
  const periodo = req.query.periodo || '1h';
  const agora = Date.now();
  const inicio = getInicio(periodo);

  // globais (não filtram por período)
  const total = db.prepare(`SELECT COUNT(*) as c FROM keys`).get().c;
  const ativas = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE active = 1 AND expires_at > ?`).get(agora).c;
  const expiradas = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE expires_at > 0 AND expires_at <= ?`).get(agora).c;
  const aguardando = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE expires_at = 0`).get().c;

  // filtradas por período
  let usadas;
  if (inicio === 0) {
    usadas = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE hwid IS NOT NULL`).get().c;
  } else {
    usadas = db.prepare(`SELECT COUNT(*) as c FROM keys WHERE hwid IS NOT NULL AND activated_at >= ?`).get(inicio).c;
  }

  res.json({ success: true, total, ativas, expiradas, usadas, aguardando });
});

app.listen(PORT, () => {
  console.log(`✅ API rodando na porta ${PORT}`);
  console.log(`🔑 Painel admin: http://localhost:${PORT}`);
});
