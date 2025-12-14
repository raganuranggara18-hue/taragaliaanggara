import fs from "fs-extra";
import axios from "axios";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AYAH_ID = Number(process.env.AYAH_ID);
const MAMA_ID = Number(process.env.MAMA_ID);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !AYAH_ID || !MAMA_ID || !WEBHOOK_URL) {
  throw new Error("ENV belum lengkap");
}

/* ================= SESSION ================= */
const SESSION_FILE = "./sessions.json";
let sessions = { users: {} };

await fs.ensureFile(SESSION_FILE);
try {
  sessions = await fs.readJSON(SESSION_FILE);
} catch {
  sessions = { users: {} };
}

const saveSessions = () =>
  fs.writeJSON(SESSION_FILE, sessions, { spaces: 2 });

/* ================= UTIL ================= */
const isAuthorized = id => id === AYAH_ID || id === MAMA_ID;
const getOther = id => (id === AYAH_ID ? MAMA_ID : AYAH_ID);
const sanitize = t => t?.trim().slice(0, 500) || "";

/* ================= MOOD ================= */
const MOODS = ["ceria", "manja", "ngantuk", "superhappy"];
const MOOD_CONFIG = {
  ceria: { emojis: ["😊","😄"] },
  manja: { emojis: ["🥺","😘"] },
  ngantuk: { emojis: ["😴","😪"] },
  superhappy: { emojis: ["🤩","🎉"] }
};

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const defaultMood = () => "ceria";

/* ================= AI ================= */
async function generateGemini(text, mood) {
  if (!GEMINI_API_KEY) {
    return `Mama/Papa~ dia bilang "${text}" ${pick(MOOD_CONFIG[mood].emojis)}`;
  }

  try {
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateText?key=${GEMINI_API_KEY}`,
      { prompt: { text: `Anak kecil mood ${mood}: "${text}"` } }
    );
    return r.data?.candidates?.[0]?.output_text
      || `Mama/Papa~ dia bilang "${text}"`;
  } catch {
    return `Mama/Papa~ dia bilang "${text}"`;
  }
}

/* ================= BOT ================= */
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const app = express();
app.use(express.json());

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;

app.post(WEBHOOK_PATH, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.setWebHook(`${WEBHOOK_URL}${WEBHOOK_PATH}`);

bot.on("message", async msg => {
  if (!msg.text) return;

  const id = msg.from.id;
  if (!isAuthorized(id)) return;

  if (!sessions.users[id]) {
    sessions.users[id] = { mood: defaultMood() };
    await saveSessions();
  }

  const reply = await generateGemini(
    sanitize(msg.text),
    sessions.users[id].mood
  );

  await bot.sendMessage(getOther(id), reply);
});

app.get("/", (_, res) => res.send("Bot aktif"));
app.listen(PORT, () => console.log("Server berjalan"));
