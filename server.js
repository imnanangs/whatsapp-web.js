require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const qrcodeImage = require("qrcode");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WA_SESSION_ID = process.env.WA_SESSION_ID || "main-session";

let isReady = false;
let lastQr = null;
let lastQrImage = null;
let lastQrGeneratedAt = null;
let clientInfo = null;

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: WA_SESSION_ID,
    dataPath: "./sessions",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  },
});

function formatNumber(number) {
  let phone = String(number).replace(/\D/g, "");

  if (phone.startsWith("0")) {
    phone = "62" + phone.substring(1);
  }

  if (!phone.startsWith("62")) {
    phone = "62" + phone;
  }

  return `${phone}@c.us`;
}

client.on("qr", async (qr) => {
  isReady = false;
  clientInfo = null;

  lastQr = qr;
  lastQrGeneratedAt = new Date().toISOString();

  try {
    lastQrImage = await qrcodeImage.toDataURL(qr);
  } catch (error) {
    console.error("Gagal generate QR image:", error.message);
    lastQrImage = null;
  }

  console.log("Scan QR ini:");
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("WhatsApp authenticated");
});

client.on("auth_failure", (message) => {
  isReady = false;
  clientInfo = null;

  console.error("WhatsApp auth failure:", message);
});

client.on("ready", () => {
  isReady = true;
  lastQr = null;
  lastQrImage = null;
  lastQrGeneratedAt = null;
  clientInfo = client.info;

  console.log("WhatsApp siap digunakan!");
});

client.on("message", async (msg) => {
  console.log(`Pesan masuk: ${msg.from} ${msg.body}`);

  if (msg.body === "!ping") {
    const replyMessage = await msg.reply("Kamu jelek 🤪");

    console.log(
      `Pesan keluar: ${replyMessage.from} -> ${replyMessage.to} ${replyMessage.body}`
    );
  }
});

client.on("disconnected", (reason) => {
  isReady = false;
  clientInfo = null;

  console.log("WhatsApp disconnected:", reason);
});

client.on("change_state", (state) => {
  console.log("WhatsApp state:", state);
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp Gateway aktif",
    endpoints: {
      health: "/health",
      status: "/status",
      qrJson: "/qr",
      qrImage: "/qr-image",
      qrView: "/qr-view",
      sendMessage: "/send-message",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp Gateway aktif",
    ready: isReady,
    sessionId: WA_SESSION_ID,
  });
});

app.get("/status", async (req, res) => {
  let state = null;

  try {
    state = await client.getState();
  } catch (error) {
    state = null;
  }

  res.json({
    success: true,
    ready: isReady,
    state,
    sessionId: WA_SESSION_ID,
    info: clientInfo
      ? {
          wid: clientInfo.wid?._serialized || null,
          pushname: clientInfo.pushname || null,
          platform: clientInfo.platform || null,
        }
      : null,
  });
});

app.get("/qr", (req, res) => {
  if (isReady) {
    return res.json({
      success: true,
      ready: true,
      message: "WhatsApp sudah terhubung",
      sessionId: WA_SESSION_ID,
      qr: null,
      qrImage: null,
      generatedAt: null,
    });
  }

  if (!lastQr || !lastQrImage) {
    return res.json({
      success: true,
      ready: false,
      message: "QR belum tersedia. Tunggu beberapa detik lalu refresh.",
      sessionId: WA_SESSION_ID,
      qr: null,
      qrImage: null,
      generatedAt: null,
    });
  }

  res.json({
    success: true,
    ready: false,
    message: "Silakan scan QR",
    sessionId: WA_SESSION_ID,
    qr: lastQr,
    qrImage: lastQrImage,
    generatedAt: lastQrGeneratedAt,
  });
});

app.get("/qr-image", (req, res) => {
  if (isReady) {
    return res.status(200).send("WhatsApp sudah terhubung");
  }

  if (!lastQrImage) {
    return res.status(404).send("QR belum tersedia. Tunggu beberapa detik lalu refresh.");
  }

  const base64Data = lastQrImage.replace(/^data:image\/png;base64,/, "");
  const imageBuffer = Buffer.from(base64Data, "base64");

  res.setHeader("Content-Type", "image/png");
  res.send(imageBuffer);
});

app.get("/qr-view", (req, res) => {
  if (isReady) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>WhatsApp Connected</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
          }
          .card {
            background: white;
            padding: 32px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          }
          .success {
            color: #16a34a;
            font-size: 22px;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="success">WhatsApp sudah terhubung ✅</div>
          <p>Session: ${WA_SESSION_ID}</p>
        </div>
      </body>
      </html>
    `);
  }

  if (!lastQrImage) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="refresh" content="5" />
        <title>QR Belum Tersedia</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
          }
          .card {
            background: white;
            padding: 32px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>QR belum tersedia</h2>
          <p>Tunggu beberapa detik. Halaman akan refresh otomatis.</p>
        </div>
      </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="refresh" content="20" />
      <title>Scan WhatsApp QR</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
        }
        .card {
          background: white;
          padding: 32px;
          border-radius: 20px;
          text-align: center;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        }
        img {
          width: 280px;
          height: 280px;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
        }
        h1 {
          margin-bottom: 8px;
          color: #0f172a;
        }
        p {
          color: #64748b;
        }
        .session {
          margin-top: 16px;
          font-size: 13px;
          color: #94a3b8;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Scan WhatsApp QR</h1>
        <p>Buka WhatsApp di HP lalu scan QR ini.</p>
        <img src="${lastQrImage}" alt="WhatsApp QR" />
        <div class="session">Session: ${WA_SESSION_ID}</div>
        <div class="session">Generated at: ${lastQrGeneratedAt}</div>
      </div>
    </body>
    </html>
  `);
});

app.post("/send-message", async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(422).json({
        success: false,
        message: "number dan message wajib diisi",
      });
    }

    if (!isReady) {
      return res.status(503).json({
        success: false,
        message: "WhatsApp belum siap. Scan QR dulu.",
      });
    }

    const chatId = formatNumber(number);

    const sentMessage = await client.sendMessage(chatId, message);

    res.json({
      success: true,
      message: "Pesan berhasil dikirim",
      data: {
        id: sentMessage.id._serialized,
        from: sentMessage.from,
        to: sentMessage.to,
        body: sentMessage.body,
        timestamp: sentMessage.timestamp,
        type: sentMessage.type,
        hasMedia: sentMessage.hasMedia,
      },
    });
  } catch (error) {
    console.error("Gagal kirim pesan:", error);

    res.status(500).json({
      success: false,
      message: "Gagal mengirim pesan",
      error: error.message,
    });
  }
});

client.initialize();

app.listen(PORT, "127.0.0.1", () => {
});
