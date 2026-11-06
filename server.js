'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const path = require('node:path');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and update it.`);
  process.exit(1);
}

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
  decimalNumbers: true,
  enableKeepAlive: true
});

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.json({limit: '16kb'}));
app.use(express.static(path.join(__dirname, 'public')));

const STATUSES = ['todo', 'in_progress', 'done'];
const toId = value => (/^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value))) ? Number(value) : null;
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max + 1) : null;
const handleDbError = (err, res) => {
  console.error('Database error:', err.code || err.message);
  res.status(503).json({error: 'Database is unavailable. Check server logs and database settings.'});
};

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({status: 'ok', database: 'connected'});
  } catch (err) { handleDbError(err, res); }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, title, description, status, created_at, updated_at FROM tasks ORDER BY created_at DESC, id DESC LIMIT 200');
    res.json({tasks: rows});
  } catch (err) { handleDbError(err, res); }
});

app.post('/api/tasks', async (req, res) => {
  const title = cleanText(req.body?.title, 160);
  const description = cleanText(req.body?.description ?? '', 500);
  if (!title || title.length > 160 || description === null || description.length > 500) {
    return res.status(400).json({error: 'Title (1–160 chars) and description (max 500 chars) required.'});
  }
  try {
    const [result] = await db.execute('INSERT INTO tasks (title, description) VALUES (?, ?)', [title, description]);
    const [rows] = await db.execute('SELECT * FROM tasks WHERE id = ?', [result.insertId]);
    res.status(201).json({task: rows[0]});
  } catch (err) { handleDbError(err, res); }
});

app.patch('/api/tasks/:id', async (req, res) => {
  const id = toId(req.params.id);
  const status = req.body?.status;
  if (!id || !STATUSES.includes(status)) return res.status(400).json({error: 'Invalid task ID or status.'});
  try {
    const [result] = await db.execute('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
    if (!result.affectedRows) return res.status(404).json({error: 'Task not found.'});
    const [rows] = await db.execute('SELECT * FROM tasks WHERE id = ?', [id]);
    res.json({task: rows[0]});
  } catch (err) { handleDbError(err, res); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({error: 'Invalid task ID.'});
  try {
    const [result] = await db.execute('DELETE FROM tasks WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({error: 'Task not found.'});
    res.status(204).end();
  } catch (err) { handleDbError(err, res); }
});

app.use('/api', (_req, res) => res.status(404).json({error: 'API endpoint not found.'}));
app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({error: 'Malformed JSON.'});
  console.error(err);
  res.status(500).json({error: 'Internal server error.'});
});

const server = app.listen(port, host, () => {
  console.log(`Node.js app listening on http://${host}:${port}`);
});
process.on('SIGTERM', () => server.close(() => db.end().then(() => process.exit(0))));
