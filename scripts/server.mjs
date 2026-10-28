/**
 * Phone gateway for the DSH web UI.
 *
 * Sits in front of the DSH web server (default 127.0.0.1:3080) on its own port and:
 *   - injects a viewport meta with viewport-fit=cover + the mobile stylesheet/script
 *   - serves a fixed entry URL (/m) that redirects to the current token, so a
 *     home-screen shortcut survives restarts (DSH re-issues its token on every start)
 *   - rewrites Host/Origin to the host DSH was started with (--trusted-host), so a
 *     second port is not rejected by the origin check
 *
 * It never modifies the DSH install or its data. Only the HTML it forwards is rewritten
 * on the way out (viewport meta + the two asset tags). Removing this process and the
 * port leaves everything exactly as it was.
 *
 * Env:
 *   PORT          listen port                (default 8450)
 *   UPSTREAM      DSH web origin             (default http://127.0.0.1:3080)
 *   TRUSTED_HOST  host:port DSH trusts. Leave unset to forward Host/Origin unchanged.
 *                Set it when DSH runs with --trusted-host <host:port>: the gateway then
 *                presents that Host (and Origin) upstream, so requests arriving on this
 *                second port pass DSH's origin check.
 *   TRUSTED_ORIGIN scheme+host+port to present as Origin (default: unset = unchanged)
 *   TOKEN_LOG     file DSH prints its URL to (default ~/.dsh/dsh-launchd.log)
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8450);
const UPSTREAM = new URL(process.env.UPSTREAM || 'http://127.0.0.1:3080');
const UP_HOST = UPSTREAM.hostname;
const UP_PORT = Number(UPSTREAM.port || 80);
/* Both rewrites are opt-in: without them nothing is invented on the way upstream. */
const TRUSTED_HOST = process.env.TRUSTED_HOST || '';
const TRUSTED_ORIGIN = process.env.TRUSTED_ORIGIN || '';
const TOKEN_LOG =
  process.env.TOKEN_LOG || path.join(process.env.HOME || '', '.dsh', 'dsh-launchd.log');

const log = (...a) => console.log(new Date().toISOString(), ...a);

function logHit(req) {
  const p = (req.url || '/').split('?')[0];
  const ua = String(req.headers['user-agent'] || '');
  const tag = /iPhone|iPad|Android/i.test(ua) ? 'phone' : 'other';
  if (p === '/m' || p === '/' || p.startsWith('/__dshm/')) log('hit', req.method, p, tag);
}

/** Last token DSH printed to its log. DSH logs a URL with ?token=... on every start. */
function currentToken() {
  try {
    const txt = fs.readFileSync(TOKEN_LOG, 'utf8');
    const found = [...txt.matchAll(/token=([A-Za-z0-9._-]+)/g)];
    return found.length ? found[found.length - 1][1] : null;
  } catch {
    return null;
  }
}

/* Only advertise icon/manifest routes when the files are actually there: a broken
 * apple-touch-icon reference is worse than none. Drop your own PNGs into icons/. */
const ICONS = {
  'apple-touch-icon-180': fs.existsSync(path.join(DIR, 'icons', 'apple-touch-icon-180.png')),
  'icon-192': fs.existsSync(path.join(DIR, 'icons', 'icon-192.png')),
  'icon-512': fs.existsSync(path.join(DIR, 'icons', 'icon-512.png')),
};
const HAVE_ICONS = ICONS['icon-192'] && ICONS['icon-512'];

const HEAD_INJECT =
  `
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#151517" media="(prefers-color-scheme: dark)">
` +
  (ICONS['apple-touch-icon-180']
    ? `    <link rel="apple-touch-icon" href="/__dshm/apple-touch-icon-180.png">\n`
    : '') +
  (HAVE_ICONS ? `    <link rel="manifest" href="/__dshm/manifest.webmanifest">\n` : '') +
  `    <link rel="stylesheet" href="/__dshm/mobile.css">
    <script src="/__dshm/mobile.js" defer></script>
`;

const VIEWPORT_OLD = /<meta\s+name="viewport"\s+content="[^"]*"\s*\/?>/i;
const VIEWPORT_NEW =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />';

function injectHtml(html) {
  let out = html;
  if (VIEWPORT_OLD.test(out)) out = out.replace(VIEWPORT_OLD, VIEWPORT_NEW);
  else out = out.replace(/<head[^>]*>/i, (m) => m + VIEWPORT_NEW);
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, HEAD_INJECT + '  </head>');
  else out = HEAD_INJECT + out;
  return out;
}

function decodeBody(buf, enc) {
  if (!enc || enc === 'identity') return buf;
  try {
    if (/gzip/i.test(enc)) return zlib.gunzipSync(buf);
    if (/deflate/i.test(enc)) return zlib.inflateSync(buf);
    if (/br/i.test(enc)) return zlib.brotliDecompressSync(buf);
  } catch (e) {
    log('decode failed', enc, e.message);
  }
  return buf;
}

function sendText(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function sendLocalFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) return sendText(res, 404, 'not found');
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    res.end(buf);
  });
}

const MANIFEST = {
  name: 'DSH',
  short_name: 'DSH',
  /* start at /m so an installed shortcut picks up a fresh token after a DSH restart */
  start_url: '/m',
  scope: '/',
  display: 'fullscreen',
  background_color: '#151517',
  theme_color: '#151517',
  icons: [
    { src: '/__dshm/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/__dshm/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
};

function handleLocal(req, res) {
  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/m' || pathname === '/m/') {
    const tok = currentToken();
    if (!tok) return sendText(res, 503, `no token in ${TOKEN_LOG} yet (wait for DSH to start)`);
    res.writeHead(302, { location: `/?token=${encodeURIComponent(tok)}`, 'cache-control': 'no-store' });
    return res.end();
  }
  if (pathname === '/__dshm/status') {
    return sendText(
      res,
      200,
      JSON.stringify({ ok: true, port: PORT, upstream: UPSTREAM.origin, hasToken: !!currentToken() }),
      'application/json; charset=utf-8',
    );
  }
  if (pathname === '/__dshm/mobile.css') return sendLocalFile(res, path.join(DIR, 'mobile.css'), 'text/css; charset=utf-8');
  if (pathname === '/__dshm/mobile.js') return sendLocalFile(res, path.join(DIR, 'mobile.js'), 'text/javascript; charset=utf-8');
  if (pathname === '/__dshm/manifest.webmanifest')
    return sendText(res, 200, JSON.stringify(MANIFEST), 'application/manifest+json; charset=utf-8');
  const icon = pathname.match(/^\/__dshm\/(apple-touch-icon-180|icon-192|icon-512)\.png$/);
  if (icon) return sendLocalFile(res, path.join(DIR, 'icons', `${icon[1]}.png`), 'image/png');
  return false;
}

const server = http.createServer((req, res) => {
  logHit(req);
  if (handleLocal(req, res) !== false) return;

  const headers = { ...req.headers, 'accept-encoding': 'identity' };
  if (TRUSTED_HOST) headers.host = TRUSTED_HOST;
  if (TRUSTED_ORIGIN && headers.origin) headers.origin = TRUSTED_ORIGIN;

  const upReq = http.request(
    { hostname: UP_HOST, port: UP_PORT, path: req.url, method: req.method, headers },
    (upRes) => {
      const type = String(upRes.headers['content-type'] || '');
      const isHtml = /text\/html/i.test(type);

      if (!isHtml) {
        const outHeaders = { ...upRes.headers };
        delete outHeaders['content-length'];
        res.writeHead(upRes.statusCode || 502, outHeaders);
        upRes.pipe(res);
        return;
      }

      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        const raw = decodeBody(Buffer.concat(chunks), String(upRes.headers['content-encoding'] || ''));
        const body = Buffer.from(injectHtml(raw.toString('utf8')), 'utf8');
        const outHeaders = { ...upRes.headers };
        delete outHeaders['content-encoding'];
        delete outHeaders['transfer-encoding'];
        outHeaders['content-length'] = String(body.length);
        outHeaders['cache-control'] = 'no-store';
        outHeaders['x-dshm'] = 'injected';
        res.writeHead(upRes.statusCode || 200, outHeaders);
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    },
  );
  upReq.on('error', (e) => {
    log('upstream error', e.message);
    if (!res.headersSent) sendText(res, 502, 'DSH upstream unreachable');
    else res.end();
  });
  req.pipe(upReq);
});

/* WebSocket upgrades pass through as raw sockets (Host/Origin rewritten the same way). */
server.on('upgrade', (req, socket, head) => {
  const headers = { ...req.headers };
  if (TRUSTED_HOST) headers.host = TRUSTED_HOST;
  if (TRUSTED_ORIGIN && headers.origin) headers.origin = TRUSTED_ORIGIN;
  if (TRUSTED_ORIGIN && headers['sec-websocket-origin']) headers['sec-websocket-origin'] = TRUSTED_ORIGIN;

  const up = net.connect(UP_PORT, UP_HOST, () => {
    let raw = `GET ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(headers)) raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
    raw += '\r\n';
    up.write(raw);
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const die = () => {
    try { socket.destroy(); } catch {}
    try { up.destroy(); } catch {}
  };
  up.on('error', die);
  socket.on('error', die);
});

process.on('uncaughtException', (e) => log('uncaught', e && e.stack));
process.on('unhandledRejection', (e) => log('unhandled', e));

server.listen(PORT, '127.0.0.1', () => {
  log(
    `dsh-phone gateway on 127.0.0.1:${PORT} -> ${UPSTREAM.origin} ` +
      `(host/origin ${TRUSTED_HOST || 'forwarded unchanged'})`,
  );
});
