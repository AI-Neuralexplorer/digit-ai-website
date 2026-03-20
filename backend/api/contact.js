// /api/contact — Contact form handler
// POST /api/contact { name, email, company, message } → sends email via Resend.com

const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'hello@digit-ai.ai';

// Simple in-memory rate limit (resets on cold start — good enough for serverless)
const rateMap = new Map();
const RATE_LIMIT = 3; // max submissions per IP per hour
const RATE_WINDOW = 60 * 60 * 1000;

function checkRate(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { rateMap.set(ip, { count: 1, start: now }); return true; }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  rateMap.set(ip, entry);
  return true;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://digit-ai.ai');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
  }

  const { name, email, company, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required' });
  }
  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: 'Digit-AI Website <noreply@digit-ai.ai>',
      to: CONTACT_EMAIL,
      replyTo: email,
      subject: `New enquiry from ${name}${company ? ' — ' + company : ''}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;color:#1a1a1a">
          <h2 style="color:#B8926A;margin-bottom:24px">New Contact Enquiry</h2>
          <p><strong>Name:</strong> ${escHtml(name)}</p>
          <p><strong>Email:</strong> <a href="mailto:${escHtml(email)}">${escHtml(email)}</a></p>
          ${company ? `<p><strong>Company:</strong> ${escHtml(company)}</p>` : ''}
          <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap;background:#f5f5f5;padding:16px;border-radius:4px">${escHtml(message)}</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
          <p style="color:#888;font-size:12px">Sent from digit-ai.ai contact form</p>
        </div>`,
      text: `Name: ${name}\nEmail: ${email}${company ? '\nCompany: ' + company : ''}\n\nMessage:\n${message}`
    });

    return res.status(200).json({ ok: true, message: 'Message sent successfully' });
  } catch(e) {
    console.error('Contact form error:', e);
    return res.status(500).json({ error: 'Failed to send message. Please try again or email hello@digit-ai.ai directly.' });
  }
};

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
