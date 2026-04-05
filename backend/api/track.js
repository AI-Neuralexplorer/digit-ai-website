// /api/track - Visitor analytics endpoint

const http = require('http');
const jwt = require('jsonwebtoken');
const { Octokit } = require('@octokit/rest');

const JWT_SECRET = process.env.JWT_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const VISITS_PATH = 'cms/visits.json';
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateLimitMap = new Map();

function requireAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try { jwt.verify(token, JWT_SECRET); return true; }
  catch { return false; }
}

function getVisitorIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedIp = raw ? raw.split(',')[0].trim() : '';
  return forwardedIp || req.socket?.remoteAddress || '';
}

function isRateLimited(ip) {
  const now = Date.now();
  const lastSeen = rateLimitMap.get(ip);
  if (lastSeen && now - lastSeen < RATE_LIMIT_WINDOW_MS) return true;
  rateLimitMap.set(ip, now);
  return false;
}

function cleanupRateLimitMap(now = Date.now()) {
  for (const [ip, timestamp] of rateLimitMap.entries()) {
    if (now - timestamp >= RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(ip);
    }
  }
}

async function getFileFromGitHub(octokit, owner, repo, path) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: GITHUB_BRANCH });
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { json: JSON.parse(content), sha: data.sha };
  } catch (e) {
    if (e.status === 404) return { json: { visits: [] }, sha: null };
    throw e;
  }
}

async function writeFileToGitHub(octokit, owner, repo, path, json, sha, message) {
  const content = Buffer.from(JSON.stringify(json, null, 2)).toString('base64');
  const params = {
    owner,
    repo,
    path,
    branch: GITHUB_BRANCH,
    message,
    content,
    ...(sha ? { sha } : {})
  };
  await octokit.repos.createOrUpdateFileContents(params);
}

function fetchJsonWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
  });
}

async function getGeoForIp(ip) {
  if (!ip) {
    return { country: '', countryCode: '', region: '', city: '', org: '' };
  }

  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,org,query`;
  try {
    const data = await fetchJsonWithTimeout(url, 2000);
    if (!data || data.status !== 'success') {
      return { country: '', countryCode: '', region: '', city: '', org: '' };
    }

    return {
      country: data.country || '',
      countryCode: data.countryCode || '',
      region: data.regionName || '',
      city: data.city || '',
      org: data.org || ''
    };
  } catch {
    return { country: '', countryCode: '', region: '', city: '', org: '' };
  }
}

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return {};
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://digit-ai.ai');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const [owner, repo] = (GITHUB_REPO || '').split('/');
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  if (req.method === 'GET') {
    if (!requireAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

    const { json } = await getFileFromGitHub(octokit, owner, repo, VISITS_PATH);
    const visits = json.visits || [];
    return res.status(200).json({ visits });
  }

  if (req.method === 'POST') {
    const body = parseBody(req.body);

    const ip = getVisitorIp(req);
    const rateLimitKey = ip || 'unknown';
    if (isRateLimited(rateLimitKey)) {
      cleanupRateLimitMap();
      return res.status(200).json({ ok: true });
    }
    cleanupRateLimitMap();

    const geo = await getGeoForIp(ip);
    const now = new Date().toISOString();
    const visit = {
      ts: now,
      page: normalizeString(body.page) || '/',
      referrer: normalizeString(body.referrer),
      utm_source: normalizeString(body.utm_source),
      utm_medium: normalizeString(body.utm_medium),
      utm_campaign: normalizeString(body.utm_campaign),
      country: geo.country,
      countryCode: geo.countryCode,
      region: geo.region,
      city: geo.city,
      org: geo.org
    };

    const { json: store, sha } = await getFileFromGitHub(octokit, owner, repo, VISITS_PATH);
    const visits = Array.isArray(store.visits) ? store.visits : [];
    visits.unshift(visit);
    if (visits.length > 2000) visits.length = 2000;

    await writeFileToGitHub(octokit, owner, repo, VISITS_PATH, { visits }, sha, 'track: visit');
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
