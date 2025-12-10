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

const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN belum diisi.");
  process.exit(1);
}

if (!AYAH_ID || !MAMA_ID) {
  console.error("ERROR: AYAH_ID atau MAMA_ID belum benar.");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ====== LOAD SESSION ======
const SESSION_FILE = "./sessions.json";
await fs.ensureFile(SESSION_FILE);
let sessions = {};
try {
  sessions = await fs.readJSON(SESSION_FILE);
} catch {
  sessions = {};
}
if (!sessions.users) sessions.users = {};

function saveSessions() {
  return fs.writeJSON(SESSION_FILE, sessions, { spaces: 2 });
}

function isAuthorized(id) {
  return id === AYAH_ID || id === MAMA_ID;
}
function getOther(id) {
  return id === AYAH_ID ? MAMA_ID : id === MAMA_ID ? AYAH_ID : null;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function sanitize(t) {
  return t?.trim().slice(0, 500) || "";
}

// ====== MOOD SYSTEM ======
const MOODS = ["ceria", "manja", "ngantuk", "superhappy"];
const MOOD_CONFIG = {
  ceria: {
    emojis: ["😊","😄","🙂"],
    suffixes: ["ya~","hehe","uwu"]
  },
  manja: {
    emojis: ["🥺","😘","🤍"],
    suffixes: ["yaa~","muah~","ciiiin~"]
  },
  ngantuk: {
    emojis: ["😴","😪","🫠"],
    suffixes: ["ngantuk~","mimpi yuk...","(ngu~)"]
  },
  superhappy: {
    emojis: ["🤩","🎉","💥"],
    suffixes: ["yaaayyy!!","yeay~","hore~"]
  }
};
function defaultMood() {
  return "ceria";
}

// ====== TEMPLATES ======
const PREFIXES = [
  "Mama~","Papa~","Heii~","Halo halo~","Psst",
  "Mama sayang,","Papa sayang,", "Mamaa...", "Papaa..."
];
const INTERJ = [
  "aku denger nih,", "dia bilang,", "katanya,", "dia bisik:",
  "dia nulis:", "dia cerita:", "ada pesan nih:"
];
const PATTERNS = [
  'aku bilang: "{t}"',
  '"{t}" katanya',
  'dia bilang gini: "{t}"',
  'pesannya: "{t}"',
  '"{t}" itu pesannya',
  '"{t}" dia titipin'
];
const CLOSERS = [
  "Mama ga kangen papa?",
  "Mama pasti kangen kan?",
  "Pulang ya nanti?",
  "Peluk dong~",
  "Jangan marah ya~",
  "Papa kangen juga loh~"
];
const CUTE_SUFFIX = ["uwu", "(>_<)", "hehe", "muach", ":3", "*peluk*"];
const CONFIRMATIONS = [
  "Oke, sudah aku sampaikan ke {t}!",
  "Sip! Aku bilang ke {t} ya~",
  "Baik, nanti aku kasih tau {t} hehe",
  "Sudah~ aku kirim ke {t} ya",
  "Tenang, aku sampaikan ke {t}!"
];

// ====== REACTIONS ======
const REACT_WORDS = {
  love: ["kangen","sayang","rindu","cinta"],
  angry: ["marah","kesal","ngambek"],
  happy: ["senang","happy","bahagia"],
  sorry: ["maaf"]
};
const REACT_EMOJI = {
  love: ["🥰","😘","💕"],
  angry: ["😳","😬","🤭"],
  happy: ["😁","😆","🎈"],
  sorry: ["😢","🙏","🥺"]
};

// generator anak
function generateChildTemplate(text, mood) {
  const p = pick(PREFIXES);
  const i = pick(INTERJ);
  const pat = pick(PATTERNS);
  const c = pick(CLOSERS);

  const mCfg = MOOD_CONFIG[mood];
  const mEmoji = pick(mCfg.emojis);
  const mSuf = pick(mCfg.suffixes);
  const cs = Math.random() < 0.3 ? pick(CUTE_SUFFIX) : "";

  let t = text;
  t = t.replace(/\bkangen\b/gi, "kangen juga");
  if (t.length > 120) t = t.slice(0, 117) + "...";

  return `${p} ${i} ${pat.replace("{t}", t)} — ${c} ${mEmoji} ${mSuf} ${cs}`;
}

// fallback Gemini
async function generateGemini(text, mood) {
  if (!GEMINI_API_KEY) {
    return generateChildTemplate(text, mood);
  }

  try {
    const prompt = `Buat pesan anak kecil mood ${mood}: "${text}"`;
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateText?key=${GEMINI_API_KEY}`,
      { prompt: { text: prompt } }
    );
    const out = r.data?.candidates?.[0]?.output_text;
    return out || generateChildTemplate(text, mood);
  } catch {
    return generateChildTemplate(text, mood);
  }
}

// detect reaction
function detectReaction(text) {
  const low = text.toLowerCase();
  for (const k in REACT_WORDS) {
    for (const w of REACT_WORDS[k]) {
      if (low.includes(w)) return k;
    }
  }
  return null;
}

// send message
async function sendMsg(id, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: id,
    text
  });
}
async function sendSticker(id, sticker) {
  await axios.post(`${TELEGRAM_API}/sendSticker`, {
    chat_id: id,
    sticker
  });
}

// ====== BOT DENGAN WEBHOOK ======
const bot = new TelegramBot(BOT_TOKEN, {
  webHook: true
});

// Express server
const app = express();
app.use(express.json());

// webhook endpoint
app.post("/webhook", async (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// set webhook URL
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.error("ERROR: WEBHOOK_URL belum diset");
  process.exit(1);
}

bot.setWebHook(`${WEBHOOK_URL}/webhook`);

// EVENTS
bot.onText(/\/start/, async (msg) => {
  const id = msg.from.id;
  if (!isAuthorized(id)) return bot.sendMessage(id, "Akses ditolak.");

  bot.sendMessage(id, "Halo! Ketik 'Saya Ayah' atau 'Saya Mama'");
});

bot.onText(/\/mood (.+)/, async (msg, match) => {
  const id = msg.from.id;
  if (!isAuthorized(id)) return;

  const m = match[1].toLowerCase();
  if (!MOODS.includes(m)) {
    return bot.sendMessage(id, `Mood tidak valid. Pilih: ${MOODS.join(", ")}`);
  }

  sessions.users[id] = sessions.users[id] || {};
  sessions.users[id].mood = m;
  await saveSessions();
  bot.sendMessage(id, `Mood diubah ke: ${m}`);
});

// pesan umum
bot.on("message", async (msg) => {
  if (!msg.text) return;
  const id = msg.from.id;
  const txt = msg.text.trim();

  if (!isAuthorized(id)) {
    return bot.sendMessage(id, "Bot ini hanya untuk Ayah & Mama.");
  }

  if (!sessions.users[id] || !sessions.users[id].role) {
    const low = txt.toLowerCase();
    if (["saya ayah","ayah"].includes(low)) {
      sessions.users[id] = { role: "ayah", mood: defaultMood(), history: [] };
      await saveSessions();
      return bot.sendMessage(id, "Kamu Ayah. Kirim pesan kapan saja.");
    }
    if (["saya mama","mama"].includes(low)) {
      sessions.users[id] = { role: "mama", mood: defaultMood(), history: [] };
      await saveSessions();
      return bot.sendMessage(id, "Kamu Mama. Kirim pesan kapan saja.");
    }
    return bot.sendMessage(id, "Ketik 'Saya Ayah' atau 'Saya Mama'.");
  }

  // history
  sessions.users[id].history.push({ text: txt, at: Date.now() });
  if (sessions.users[id].history.length > 50)
    sessions.users[id].history.shift();
  await saveSessions();

  const role = sessions.users[id].role;
  const mood = sessions.users[id].mood;
  const targetLabel = role === "ayah" ? "Mama" : "Ayah";
  const recipient = getOther(id);

  bot.sendMessage(id,
    pick(CONFIRMATIONS).replace("{t}", targetLabel)
  );

  const r = detectReaction(txt);
  if (r) bot.sendMessage(id, pick(REACT_EMOJI[r]));

  const child = await generateGemini(sanitize(txt), mood);

  if (STICKER_IDS.length > 0 && Math.random() < 0.35) {
    await sendSticker(recipient, pick(STICKER_IDS));
  }

  await sendMsg(recipient, child + "\n\n(— disampaikan anak kecil imut)");
});

// health check
app.get("/", (req, res) => res.send("Anak Perantara Bot webhook aktif."));

app.listen(PORT, () => console.log("Webhook server port", PORT));
