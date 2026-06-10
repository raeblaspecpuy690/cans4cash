require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    postal_code TEXT NOT NULL,
    card_type TEXT NOT NULL,
    cans_offer TEXT,
    cash_offer TEXT,
    nego TEXT,
    description TEXT,
    price TEXT,
    asking_cans TEXT,
    need_cans TEXT,
    meetup TEXT,
    phone TEXT,
    email TEXT,
    created_at BIGINT NOT NULL
  )
`).catch(e => { console.error('DB init error:', e.message); process.exit(1); });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const POSTAL_CODES = {
  "H4A": "NDG",
  "H4B": "NDG",
  "H3X": "NDG/Snowdon/Hampstead/Côte Saint-Luc",
  "H4V": "Côte Saint-Luc",
  "H4W": "Côte Saint-Luc",
  "H4X": "Hampstead/Westmount",
  "H3Y": "Westmount",
  "H3Z": "Westmount"
};

async function cleanupExpired() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const r = await pool.query('DELETE FROM cards WHERE created_at < $1', [cutoff]);
  if (r.rowCount > 0) console.log('Cleaned up', r.rowCount, 'expired card(s)');
}

app.get('/api/postal-codes', (req, res) => {
  res.json(POSTAL_CODES);
});

app.get('/api/cards/:postalCode', async (req, res) => {
  await cleanupExpired();
  const r = await pool.query('SELECT * FROM cards WHERE postal_code = $1 ORDER BY created_at DESC', [req.params.postalCode.toUpperCase()]);
  res.json(r.rows);
});

app.post('/api/cards', async (req, res) => {
  const data = req.body;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id;
  let attempts = 0;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    attempts++;
    if (attempts > 100) return res.status(500).json({ error: 'Could not generate unique ID' });
  } while ((await pool.query('SELECT id FROM cards WHERE id = $1', [id])).rows.length > 0);

  await pool.query(`
    INSERT INTO cards (id, postal_code, card_type, cans_offer, cash_offer, nego, description, price, asking_cans, need_cans, meetup, phone, email, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    id, data.postalCode, data.cardType,
    data.cansOffer || null, data.cashOffer || null,
    data.nego || null, data.description || null,
    data.price || null, data.askingCans || null,
    data.needCans || null, data.meetup || null,
    data.phone || null, data.email || null,
    Date.now()
  ]);

  res.json({ success: true, cardId: id });
});

app.get('/api/cards/lookup/:id', async (req, res) => {
  await cleanupExpired();
  const r = await pool.query('SELECT * FROM cards WHERE id = $1', [req.params.id.toUpperCase()]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
  const card = r.rows[0];
  const expired = (Date.now() - Number(card.created_at)) > 24 * 60 * 60 * 1000;
  if (expired) {
    await pool.query('DELETE FROM cards WHERE id = $1', [req.params.id.toUpperCase()]);
    return res.json({ expired: true, card: null });
  }
  res.json({ expired: false, card });
});

app.delete('/api/cards/:id', async (req, res) => {
  const id = req.params.id.toUpperCase();
  const r = await pool.query('SELECT * FROM cards WHERE id = $1', [id]);
  if (r.rows.length === 0) return res.status(404).json({ error: 'Card not found' });
  const expired = (Date.now() - Number(r.rows[0].created_at)) > 24 * 60 * 60 * 1000;
  await pool.query('DELETE FROM cards WHERE id = $1', [id]);
  res.json({ success: true, expired });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log('CANS 4 CASH server running on http://localhost:' + PORT);
  console.log('Access from LAN: http://' + getLocalIP() + ':' + PORT);
  await cleanupExpired();
  startTunnel();
});

function getLocalIP() {
  const os = require('os');
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '0.0.0.0';
}

function startTunnel() {
  const token = process.env.LOCALTONET_TOKEN;
  if (!token) { console.log('No LOCALTONET_TOKEN set. Tunnel not started.'); return; }
  const tunnelUrl = process.env.TUNNEL_URL || 'https://olstya0jbf.localto.net';
  const binary = process.env.LOCALTONET_PATH || path.join(__dirname, 'localtonet.exe');
  const fs = require('fs');
  if (!fs.existsSync(binary)) {
    console.log('localtonet binary not found at ' + binary + '. Download from https://localtonet.com/download');
    console.log('Place localtonet.exe in the project directory or set LOCALTONET_PATH.');
    return;
  }
  console.log('Starting localtonet tunnel...');
  console.log('Public URL: ' + tunnelUrl);
  const proc = spawn(binary, ['--authtoken', token], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => process.stdout.write('[localtonet] ' + d));
  proc.stderr.on('data', (d) => process.stderr.write('[localtonet] ' + d));
  proc.on('close', (code) => console.log('localtonet exited with code ' + code));
  proc.on('error', (err) => console.log('localtonet error: ' + err.message));
}
