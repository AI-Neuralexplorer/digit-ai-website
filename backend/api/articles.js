// /api/articles — Article CRUD via GitHub API
// GET  /api/articles            → all articles (published + drafts for admin)
// POST /api/articles            → create or update article (admin auth required)
// DELETE /api/articles/:slug    → delete article (admin auth required)

const jwt = require('jsonwebtoken');
const { Octokit } = require('@octokit/rest');

const JWT_SECRET = process.env.JWT_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // "username/digit-ai-website"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const ARTICLES_PATH = 'cms/articles.json';
const DRAFTS_PATH = 'cms/drafts.json';

function requireAuth(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  try { jwt.verify(token, JWT_SECRET); return true; }
  catch { return false; }
}

async function getFileFromGitHub(octokit, owner, repo, path) {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: GITHUB_BRANCH });
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { json: JSON.parse(content), sha: data.sha };
  } catch (e) {
    if (e.status === 404) return { json: { articles: [] }, sha: null };
    throw e;
  }
}

async function writeFileToGitHub(octokit, owner, repo, path, json, sha, message) {
  const content = Buffer.from(JSON.stringify(json, null, 2)).toString('base64');
  const params = {
    owner, repo, path, branch: GITHUB_BRANCH, message,
    content,
    ...(sha ? { sha } : {})
  };
  await octokit.repos.createOrUpdateFileContents(params);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://digit-ai.ai');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const [owner, repo] = (GITHUB_REPO || '').split('/');
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  // GET — public (published only) or admin (all)
  if (req.method === 'GET') {
    const isAdmin = requireAuth(req);
    const { json } = await getFileFromGitHub(octokit, owner, repo, ARTICLES_PATH);
    let articles = json.articles || [];
    if (!isAdmin) articles = articles.filter(a => a.published);
    // Sort newest first
    articles.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.status(200).json({ articles });
  }

  // POST — create or update (auth required)
  if (req.method === 'POST') {
    if (!requireAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const { title, slug, category, date, read_time, excerpt, body, published, editingSlug } = req.body;
    if (!title || !slug || !category) return res.status(400).json({ error: 'title, slug and category are required' });

    const { json: store, sha } = await getFileFromGitHub(octokit, owner, repo, ARTICLES_PATH);
    const articles = store.articles || [];

    const existingIdx = articles.findIndex(a => a.slug === (editingSlug || slug));
    const now = new Date().toISOString();
    const article = {
      title, slug, category, date, read_time, excerpt, body, published,
      updatedAt: now,
      createdAt: existingIdx >= 0 ? (articles[existingIdx].createdAt || now) : now
    };

    if (existingIdx >= 0) {
      articles[existingIdx] = article;
    } else {
      articles.push(article);
    }

    await writeFileToGitHub(octokit, owner, repo, ARTICLES_PATH, { articles }, sha,
      `${published ? 'Publish' : 'Draft'}: ${title}`);

    return res.status(200).json({ ok: true, article });
  }

  // DELETE /api/articles/:slug
  if (req.method === 'DELETE') {
    if (!requireAuth(req)) return res.status(401).json({ error: 'Unauthorized' });
    const slugToDelete = req.url.split('/').pop();
    const { json: store, sha } = await getFileFromGitHub(octokit, owner, repo, ARTICLES_PATH);
    const articles = (store.articles || []).filter(a => a.slug !== slugToDelete);
    await writeFileToGitHub(octokit, owner, repo, ARTICLES_PATH, { articles }, sha,
      `Delete article: ${slugToDelete}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
