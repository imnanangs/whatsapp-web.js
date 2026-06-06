require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const WA_SESSION_ID = process.env.WA_SESSION_ID || "main-session";

let isReady = false;

// Inisialisasi WhatsApp Client
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

// Fungsi untuk format nomor HP ke standar WhatsApp
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

// Event: Generate QR Code
client.on("qr", (qr) => {
  isReady = false;
  console.log("Scan QR ini:");
  qrcode.generate(qr, { small: true });
});

// Event: WhatsApp Siap
client.on("ready", () => {
  isReady = true;
  console.log("WhatsApp siap digunakan!");
});

// Event: Pesan Masuk
client.on("message", async (msg) => {
  console.log("Pesan masuk:", msg.from, msg.body);

  if (msg.body === "!ping") {
    await msg.reply("pong");
  }
});

// Event: WhatsApp Disconnected
client.on("disconnected", (reason) => {
  isReady = false;
  console.log("WhatsApp disconnected:", reason);
});

// Endpoint: Cek Health
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "WhatsApp Gateway aktif",
    ready: isReady,
  });
});

// Endpoint: Cek Status Detail
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
  });
});

// Endpoint: Kirim Pesan
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

    // Proses pengiriman pesan
    const sentMessage = await client.sendMessage(chatId, message);

    // Response saat sukses dengan data yang lebih lengkap
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
  console.log(`WhatsApp Gateway running at http://127.0.0.1:${PORT}`);
});
