import fs from "fs-extra";
import axios from "axios";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const AYAH_ID = Number(process.env.AYAH_ID || 0);
const MAMA_ID = Number(process.env.MAMA_ID || 0);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const STICKER_IDS = (process.env.STICKER_IDS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN belum diisi");
if (!AYAH_ID || !MAMA_ID) throw new Error("AYAH_ID / MAMA_ID salah");
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL belum diisi");

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ===== SESSION =====
const SESSION_FILE = "./sessions.json";
let sessions = { users: {} };

async function loadSession() {
  await fs.ensureFile(SESSION_FILE);
  try {
    sessions = await fs.readJSON(SESSION_FILE);
  } catch {
    sessions = { users: {} };
  }
}
async function saveSessions() {
  await fs.writeJSON(SESSION_FILE, sessions, { spaces: 2 });
}
await loadSession();

// ===== UTIL =====
const isAuthorized = id => id === AYAH_ID || id === MAMA_ID;
const getOther = id => (id === AYAH_ID ? MAMA_ID : AYAH_ID);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const sanitize = t => t?.trim().slice(0, 500) || "";

// ===== MOOD =====
const MOODS = ["ceria", "manja", "ngantuk", "superhappy"];
const MOOD_CONFIG = {
  ceria: { emojis: ["😊","😄"], suffixes: ["ya~","hehe"] },
  manja: { emojis: ["🥺","😘"], suffixes: ["yaa~","muah~"] },
  ngantuk: { emojis: ["😴","😪"], suffixes: ["ngantuk~"] },
  superhappy: { emojis: ["🤩","🎉"], suffixes: ["yaaayyy!!"] }
};
const defaultMood = () => "ceria";

// ===== TEMPLATE =====
function generateChildTemplate(text, mood) {
  const emoji = pick(MOOD_CONFIG[mood].emojis);
  return `Mama/Papa~ dia bilang "${text}" ${emoji}`;
}

// ===== GEMINI =====
async function generateGemini(text, mood) {
  if (!GEMINI_API_KEY) return generateChildTemplate(text, mood);
  try {
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateText?key=${GEMINI_API_KEY}`,
      { prompt: { text: `Anak kecil mood ${mood}: "${text}"` } }
    );
    return r.data?.candidates?.[0]?.output_text || generateChildTemplate(text, mood);
  } catch {
    return generateChildTemplate(text, mood);
  }
}

// ===== BOT =====
const bot = new TelegramBot(BOT_TOKEN, { webHook: true });

const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.setWebHook(`${WEBHOOK_URL}/webhook`);

bot.on("message", async msg => {
  if (!msg.text) return;
  const id = msg.from.id;
  if (!isAuthorized(id)) return;

  if (!sessions.users[id]) {
    sessions.users[id] = { role: null, mood: defaultMood(), history: [] };
    await saveSessions();
  }

  const childMsg = await generateGemini(sanitize(msg.text), sessions.users[id].mood);
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: getOther(id),
    text: childMsg
  });
});

app.get("/", (_, res) => res.send("Bot aktif"));
app.listen(PORT, () => console.log("Server berjalan"));
