require("dotenv").config();

const fs = require("fs");
const path = require("path");
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
const SESSION_PATH = path.join(__dirname, "sessions");
const SESSION_CLIENT_PATH = path.join(SESSION_PATH, `session-${WA_SESSION_ID}`);

let client = null;
let isReady = false;
let isInitializing = false;
let lastQr = null;
let lastQrSvg = null;
let lastQrGeneratedAt = null;
let clientInfo = null;
let lastError = null;

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

function formatLogTime() {
  return new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetRuntimeState() {
  isReady = false;
  lastQr = null;
  lastQrSvg = null;
  lastQrGeneratedAt = null;
  clientInfo = null;
}

function createClient() {
  const waClient = new Client({
    authStrategy: new LocalAuth({
      clientId: WA_SESSION_ID,
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
      ],
    },
  });

  waClient.on("qr", async (qr) => {
    isReady = false;
    isInitializing = false;
    clientInfo = null;
    lastError = null;

    lastQr = qr;
    lastQrGeneratedAt = new Date().toISOString();

    try {
      lastQrSvg = await qrcodeImage.toString(qr, {
        type: "svg",
        margin: 2,
        width: 280,
      });
    } catch (error) {
      lastQrSvg = null;
      lastError = error.message;
      console.error(`[${formatLogTime()}] Gagal generate QR SVG:`, error.message);
    }

    console.log(`[${formatLogTime()}] Scan QR ini:`);
    qrcodeTerminal.generate(qr, { small: true });
  });

  waClient.on("authenticated", () => {
    lastError = null;
    console.log(`[${formatLogTime()}] WhatsApp authenticated`);
  });

  waClient.on("auth_failure", (message) => {
    isReady = false;
    isInitializing = false;
    clientInfo = null;
    lastError = message;

    console.error(`[${formatLogTime()}] WhatsApp auth failure:`, message);
  });

  waClient.on("ready", () => {
    isReady = true;
    isInitializing = false;
    lastQr = null;
    lastQrSvg = null;
    lastQrGeneratedAt = null;
    clientInfo = waClient.info;
    lastError = null;

    console.log(`[${formatLogTime()}] WhatsApp siap digunakan!`);
  });

  waClient.on("message", async (msg) => {
    console.log(`[${formatLogTime()}] Pesan masuk: ${msg.from} ${msg.body}`);

    if (msg.body === "!ping") {
      const replyText = "Kamu jelek 🤪";
      const replyMessage = await msg.reply(replyText);

      console.log(
        `[${formatLogTime()}] Pesan keluar: ${replyMessage.from} -> ${replyMessage.to} ${replyMessage.body}`
      );
    }
  });

  waClient.on("disconnected", (reason) => {
    isReady = false;
    isInitializing = false;
    clientInfo = null;
    lastError = reason;

    console.log(`[${formatLogTime()}] WhatsApp disconnected:`, reason);
  });

  waClient.on("change_state", (state) => {
    console.log(`[${formatLogTime()}] WhatsApp state:`, state);
  });

  return waClient;
}

async function initializeClient() {
  if (isInitializing) {
    return;
  }

  if (client) {
    return;
  }

  try {
    isInitializing = true;
    resetRuntimeState();
    lastError = null;

    client = createClient();

    await client.initialize();
  } catch (error) {
    isReady = false;
    isInitializing = false;
    lastError = error.message;

    console.error(`[${formatLogTime()}] Gagal initialize WhatsApp client:`, error.message);
  }
}

async function destroyClient() {
  if (!client) {
    return;
  }

  const oldClient = client;
  client = null;

  try {
    oldClient.removeAllListeners();
  } catch (error) {}

  try {
    await oldClient.destroy();
  } catch (error) {
    console.log(`[${formatLogTime()}] Destroy skipped:`, error.message);
  }
}

async function deleteSessionFolder() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      if (fs.existsSync(SESSION_CLIENT_PATH)) {
        fs.rmSync(SESSION_CLIENT_PATH, {
          recursive: true,
          force: true,
        });
      }

      return;
    } catch (error) {
      if (attempt === 5) {
        throw error;
      }

      await sleep(500);
    }
  }
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp Gateway aktif",
    endpoints: {
      health: "/health",
      status: "/status",
      qr: "/qr",
      sendMessage: "/send-message",
      endSession: "/end-session",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp Gateway aktif",
    ready: isReady,
    initializing: isInitializing,
    lastError,
  });
});

app.get("/status", async (req, res) => {
  let state = null;

  try {
    if (client) {
      state = await client.getState();
    }
  } catch (error) {
    state = null;
  }

  res.json({
    success: true,
    ready: isReady,
    initializing: isInitializing,
    state,
    hasQr: Boolean(lastQrSvg),
    generatedAt: lastQrGeneratedAt,
    lastError,
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
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  if (isReady) {
    return res.status(200).json({
      success: true,
      ready: true,
      message: "WhatsApp sudah siap digunakan.",
      svg: "",
      generatedAt: null,
    });
  }

  if (!lastQr || !lastQrSvg) {
    return res.status(404).json({
      success: false,
      ready: false,
      message: "QR belum tersedia. Tunggu beberapa detik lalu refresh.",
      svg: "",
      generatedAt: null,
    });
  }

  res.status(200).json({
    success: true,
    ready: false,
    message: "QR tersedia. Silakan scan QR.",
    svg: lastQrSvg,
    generatedAt: lastQrGeneratedAt,
  });
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

    if (!isReady || !client) {
      return res.status(503).json({
        success: false,
        message: "WhatsApp belum siap. Scan QR dulu.",
      });
    }

    const chatId = formatNumber(number);

    const sentMessage = await client.sendMessage(chatId, message);

    console.log(
      `[${formatLogTime()}] Pesan keluar API: ${sentMessage.from} -> ${sentMessage.to} ${sentMessage.body}`
    );

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
    console.error(`[${formatLogTime()}] Gagal kirim pesan:`, error);

    res.status(500).json({
      success: false,
      message: "Gagal mengirim pesan",
      error: error.message,
    });
  }
});

app.post("/end-session", async (req, res) => {
  try {
    isReady = false;
    isInitializing = false;
    lastQr = null;
    lastQrSvg = null;
    lastQrGeneratedAt = null;
    clientInfo = null;
    lastError = null;

    if (client) {
      try {
        await client.logout();
        console.log(`[${formatLogTime()}] WhatsApp session logged out`);
      } catch (error) {
        console.log(`[${formatLogTime()}] Logout skipped:`, error.message);
      }

      await destroyClient();
    }

    await sleep(1000);
    await deleteSessionFolder();

    console.log(`[${formatLogTime()}] WhatsApp session folder deleted`);

    initializeClient();

    res.json({
      success: true,
      message: "WhatsApp session berhasil diakhiri. QR baru akan dibuat.",
      ready: false,
      initializing: true,
      svg: "",
      generatedAt: null,
    });
  } catch (error) {
    isReady = false;
    isInitializing = false;
    lastError = error.message;

    console.error(`[${formatLogTime()}] Gagal end session:`, error.message);

    res.status(500).json({
      success: false,
      message: "Gagal end session",
      error: error.message,
    });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`WhatsApp Gateway running on http://127.0.0.1:${PORT}`);
  initializeClient();
});
