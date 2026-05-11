#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function asAnthropicContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content || '') }];

  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text || '' };
    if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      const match = url.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) throw new Error('Anthropic proxy only supports data URL images');
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1],
          data: match[2],
        },
      };
    }
    return { type: 'text', text: JSON.stringify(part) };
  });
}

function normalizeAnthropicModel(model) {
  const key = String(model || '').trim().toLowerCase();
  const aliases = {
    'opus 4.6': 'claude-opus-4-6',
    'claude opus 4.6': 'claude-opus-4-6',
    'claude-opus-4.6': 'claude-opus-4-6',
    'sonnet 4.5': 'claude-sonnet-4-5-20250929',
    'claude sonnet 4.5': 'claude-sonnet-4-5-20250929',
    'claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
    'sonnet 4': 'claude-sonnet-4-20250514',
    'claude sonnet 4': 'claude-sonnet-4-20250514',
    'sonnet 3.7': 'claude-3-7-sonnet-20250219',
    'claude sonnet 3.7': 'claude-3-7-sonnet-20250219',
    'sonnet 3.5': 'claude-3-5-sonnet-20241022',
    'claude sonnet 3.5': 'claude-3-5-sonnet-20241022',
  };
  return aliases[key] || model;
}

function notionKey() {
  return process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
}

function notionDatabaseId() {
  return process.env.NOTION_DATABASE_ID || process.env.NOTION_DB_ID;
}

function richText(text) {
  const s = String(text || '').slice(0, 2000);
  return s ? [{ type: 'text', text: { content: s } }] : [];
}

function notionTextBlocks(text) {
  const s = String(text || '(no text)');
  const chunks = [];
  for (let i = 0; i < s.length; i += 1900) chunks.push(s.slice(i, i + 1900));
  return chunks.map(chunk => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(chunk) },
  }));
}

async function notionFetch(pathname, options = {}) {
  const key = notionKey();
  if (!key) throw new Error('Missing NOTION_API_KEY or NOTION_TOKEN');
  const r = await fetch('https://api.notion.com/v1' + pathname, {
    ...options,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Notion-Version': process.env.NOTION_VERSION || '2022-06-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!r.ok) throw new Error('Notion HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 500));
  return r.json();
}

async function createNotionPage(entry) {
  const databaseId = notionDatabaseId();
  if (!databaseId) throw new Error('Missing NOTION_DATABASE_ID or NOTION_DB_ID');

  const db = await notionFetch('/databases/' + encodeURIComponent(databaseId));
  const schema = db.properties || {};
  const titleName = Object.entries(schema).find(([, p]) => p.type === 'title')?.[0] || 'Name';
  const properties = {
    [titleName]: { title: richText(entry.title || 'OCR note') },
  };

  function addIf(name, value) {
    const prop = schema[name];
    if (!prop) return;
    if (prop.type === 'date') properties[name] = { date: { start: value } };
    if (prop.type === 'multi_select') properties[name] = { multi_select: (value || []).map(name => ({ name })) };
    if (prop.type === 'select') properties[name] = { select: value ? { name: String(value) } : null };
    if (prop.type === 'rich_text') properties[name] = { rich_text: richText(value) };
  }

  addIf('Created Date', entry.createdDate || entry.createdAt?.slice(0, 10));
  addIf('Labels', entry.labels || []);
  addIf('Description', entry.description || '');
  addIf('Provider', entry.provider || '');
  addIf('Model', entry.model || '');

  return notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: [
        { object: 'block', type: 'heading_2', heading_2: { rich_text: richText('Extracted Text') } },
        ...notionTextBlocks(entry.extractedText || ''),
      ],
    }),
  });
}

async function createNotionPages(req, res) {
  const body = JSON.parse(await readBody(req));
  const entries = Array.isArray(body.entries) ? body.entries : [body.entry || body];
  const results = [];
  for (const entry of entries) {
    const page = await createNotionPage(entry);
    results.push({ id: page.id, url: page.url });
  }
  sendJson(res, 200, { ok: true, count: results.length, results });
}

function toAnthropicBody(openAiBody) {
  const system = [];
  const messages = [];

  for (const msg of openAiBody.messages || []) {
    if (msg.role === 'system') {
      if (typeof msg.content === 'string') system.push(msg.content);
      else system.push(JSON.stringify(msg.content));
      continue;
    }
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: asAnthropicContent(msg.content),
    });
  }

  return {
    model: normalizeAnthropicModel(openAiBody.model),
    max_tokens: openAiBody.max_tokens || 4096,
    stream: true,
    ...(system.length ? { system: system.join('\n\n') } : {}),
    messages,
  };
}

async function proxyOpenAI(req, res) {
  console.log('Proxying request to OpenAI');
  if (!process.env.OPENAI_API_KEY) return sendJson(res, 500, { error: 'Missing OPENAI_API_KEY' });
  const body = await readBody(req);
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body,
  });

  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(chunk);
  }
  res.end();
}

async function proxyAnthropic(req, res) {
  console.log('Proxying request to Anthropic');
  if (!process.env.ANTHROPIC_API_KEY) return sendJson(res, 500, { error: 'Missing ANTHROPIC_API_KEY' });
  const incoming = JSON.parse(await readBody(req));
  const body = JSON.stringify(toAnthropicBody(incoming));

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    body,
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err);
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of upstream.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const text = json.type === 'content_block_delta' ? json.delta?.text || '' : '';
        if (text) {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
        }
      } catch {
        // Ignore non-JSON SSE lines.
      }
    }
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) return sendJson(res, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        openai: Boolean(process.env.OPENAI_API_KEY),
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        notion: Boolean(notionKey()),
        notionDatabase: Boolean(notionDatabaseId()),
      });
    }
    if (req.method === 'POST' && req.url === '/api/notion/pages') return createNotionPages(req, res);
    if (req.method === 'POST' && req.url === '/api/openai/chat/completions') return proxyOpenAI(req, res);
    if (req.method === 'POST' && req.url === '/api/anthropic/chat/completions') return proxyAnthropic(req, res);
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`OCRA listening on http://localhost:${PORT}`);
});
