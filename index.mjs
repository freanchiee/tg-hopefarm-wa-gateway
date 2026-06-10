/**
 * Toni & Guy WhatsApp Gateway — Baileys (ESM)
 * No browser, no Puppeteer. Uses WhatsApp multi-device protocol.
 *
 * Run:  node index.mjs
 * Open: http://localhost:8002  → scan QR once, session saved forever
 *
 * On Railway: if WA blocks cloud IPs, scan QR locally first, then:
 *   node index.mjs --export-creds
 * Copy the printed BAILEYS_CREDS value, set it as a Railway env var.
 * The server will auto-import it on next start.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || process.env.WA_PORT || 8002;
const API_KEY = process.env.OPENWA_API_KEY || "";
const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, ".baileys_auth");

// ── If BAILEYS_CREDS env var is set, pre-seed the auth dir from it ──────────
if (process.env.BAILEYS_CREDS) {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const files = JSON.parse(
      Buffer.from(process.env.BAILEYS_CREDS, "base64").toString("utf8")
    );
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(
        path.join(AUTH_DIR, name),
        typeof content === "string" ? content : JSON.stringify(content)
      );
    }
    console.log("✅ Loaded credentials from BAILEYS_CREDS env var");
  } catch (e) {
    console.error("⚠️  Failed to load BAILEYS_CREDS:", e.message);
  }
}

let latestQRDataUrl = null;
let isReady = false;
let sock = null;
let reconnectDelay = 5000; // starts at 5s, backs off to 2 min max

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    logger: pino({ level: "silent" }),
    browser: ["Toni & Guy Hopefarm", "Chrome", "1.0"],
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    retryRequestDelayMs: 2_000,
    qrTimeout: 60_000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      latestQRDataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
      console.log("\n📱 QR ready — open http://localhost:" + PORT + " to scan\n");
    }

    if (connection === "open") {
      isReady = true;
      latestQRDataUrl = null;
      reconnectDelay = 5000; // reset backoff on successful connect
      console.log("\n✅ WhatsApp connected! Gateway ready.\n");
    }

    if (connection === "close") {
      isReady = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.warn(`⚠️  Disconnected (code ${code}) — ${loggedOut ? "logged out, need new QR" : `reconnecting in ${reconnectDelay / 1000}s`}`);
      if (!loggedOut) {
        setTimeout(startSocket, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 120_000); // cap at 2 min
      }
    }
  });
}

startSocket().catch(console.error);

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  if (req.method === "GET" && req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    if (isReady) {
      return res.end(`<!DOCTYPE html><html><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px">
        <h2 style="color:#c9a84c;font-size:28px">✅ WhatsApp Connected!</h2>
        <p style="color:#aaa">Booking confirmations will now be sent automatically.</p>
      </body></html>`);
    }
    const qrHtml = latestQRDataUrl
      ? `<img id="qr" src="${latestQRDataUrl}" style="border-radius:12px;width:300px;height:300px;display:block" />`
      : `<p style="color:#aaa">⏳ Starting up... QR will appear in a few seconds.<br><small style="color:#555">If QR never appears, WhatsApp may be blocking this server's IP.<br>Scan QR locally and set the BAILEYS_CREDS env var.</small></p>`;
    return res.end(`<!DOCTYPE html><html><head><title>Link WhatsApp</title></head>
      <body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:20px;margin:0;padding:20px;box-sizing:border-box">
        <div style="text-align:center">
          <h2 style="color:#c9a84c;margin:0 0 4px">Toni &amp; Guy Hopefarm</h2>
          <p style="color:#555;margin:0;font-size:13px">WhatsApp Gateway</p>
        </div>
        <p style="color:#aaa;margin:0;font-size:14px;text-align:center">
          WhatsApp &#x2192; <b>Linked Devices</b> &#x2192; <b>Link a Device</b> &#x2192; scan below
        </p>
        ${qrHtml}
        <p style="color:#444;font-size:12px;margin:0">QR auto-refreshes every 5 seconds</p>
        <script>
          setInterval(async () => {
            try {
              const r = await fetch('/qr');
              const d = await r.json();
              if (d.connected) { location.reload(); return; }
              if (d.qr) { const el = document.getElementById('qr'); if (el) el.src = d.qr; else location.reload(); }
            } catch(e) {}
          }, 5000);
        </script>
      </body></html>`);
  }

  if (req.method === "GET" && req.url === "/qr") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ qr: latestQRDataUrl, connected: isReady }));
  }

  res.setHeader("Content-Type", "application/json");

  if (API_KEY) {
    const auth = req.headers["authorization"] ?? "";
    if (auth !== `Bearer ${API_KEY}`) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: "Unauthorized" }));
    }
  }

  if (req.method === "GET" && req.url === "/health") {
    return res.end(JSON.stringify({ ready: isReady }));
  }

  // Export credentials as base64 — run locally after scanning QR, then set BAILEYS_CREDS in Railway
  if (req.method === "GET" && req.url === "/export-creds") {
    try {
      const files = {};
      const entries = fs.readdirSync(AUTH_DIR);
      for (const f of entries) {
        files[f] = fs.readFileSync(path.join(AUTH_DIR, f), "utf8");
      }
      const encoded = Buffer.from(JSON.stringify(files)).toString("base64");
      res.setHeader("Content-Type", "text/plain");
      return res.end(encoded);
    } catch (e) {
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (req.method === "POST" && req.url === "/sendText") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { chatId, text } = JSON.parse(body);
        if (!chatId || !text) { res.writeHead(400); return res.end(JSON.stringify({ error: "chatId and text required" })); }
        if (!isReady || !sock) { res.writeHead(503); return res.end(JSON.stringify({ error: "WhatsApp not connected" })); }
        const jid = chatId.replace("@c.us", "@s.whatsapp.net");
        const msg = await sock.sendMessage(jid, { text });
        res.end(JSON.stringify({ id: msg.key.id, ok: true }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`\n🟡 Gateway starting on http://localhost:${PORT} ...\n`);
});
