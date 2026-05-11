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
    model: openAiBody.model,
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
      });
    }
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
