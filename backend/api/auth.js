// /api/auth — Admin login + token verification
// POST /api/auth         { password } → { token, plausibleUrl }
// GET  /api/auth/verify  (Bearer token) → { ok: true, plausibleUrl }

const jwt = require('jsonwebtoken');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const PLAUSIBLE_DASHBOARD_URL = process.env.PLAUSIBLE_DASHBOARD_URL || '';

if (!ADMIN_PASSWORD || !JWT_SECRET) {
  console.error('ADMIN_PASSWORD and JWT_SECRET environment variables are required');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://digit-ai.ai');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/auth/verify
  if (req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    try {
      jwt.verify(token, JWT_SECRET);
      return res.status(200).json({ ok: true, plausibleUrl: PLAUSIBLE_DASHBOARD_URL });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  // POST /api/auth — login
  if (req.method === 'POST') {
    const { password } = req.body;
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '7d' });
    return res.status(200).json({ token, plausibleUrl: PLAUSIBLE_DASHBOARD_URL });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
