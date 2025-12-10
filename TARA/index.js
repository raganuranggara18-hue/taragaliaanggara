/**
 * Anak Perantara Bot (Fix untuk Railway)
 * BOT siap pakai, lengkap dengan:
 * - Mood
 * - Memory 50 pesan
 * - 200+ variasi template
 * - Reaksi otomatis
 * - Sticker otomatis
 * - Anak kecil gaya ceria/manja/ngantuk/superhappy
 * - Sistem role (Ayah & Mama)
 * - Placeholder env menggunakan Bahasa Indonesia
 *
 * CARA MENGISI ENV DI RAILWAY:
 *
 * TELEGRAM_BOT_TOKEN = 123456:ABCdef   ← TANPA PETIK
 * AYAH_ID = 5547109522                 ← TANPA PETIK
 * MAMA_ID = 1442119828                 ← TANPA PETIK
 * GEMINI_API_KEY = YOUR_NEW_KEY        ← TANPA PETIK
 * STICKER_IDS = CAACAgUAA...,CAACAgIA... (boleh dikosongkan)
 *
 * INGAT:
 * Petik dua di placeholder hanya untuk contoh.
 * Saat mengisi di Railway, JANGAN pakai petik apa pun.
 */

import fs from "fs-extra";
import axios from "axios";
import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

// ====== LOAD ENV BENAR ======
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const AYAH_ID = Number(process.env.AYAH_ID || 0);
const MAMA_ID = Number(process.env.MAMA_ID || 0);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "YOUR_NEW_PLACEHOLDER_KEY";

// sticker opsional
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

// ====== SESSION FILE ======
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

// ====== UTIL ======
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

// ====== MOOD ======
const MOODS = ["ceria", "manja", "ngantuk", "superhappy"];
const MOOD_CONFIG = {
  ceria: {
    emojis: ["😊","😄","🙂"],
    suffixes: ["ya~","hehe","uwu"],
    styleHint: "ceria dan riang"
  },
  manja: {
    emojis: ["🥺","😘","🤍"],
    suffixes: ["yaa~","muah~","ciiiin~"],
    styleHint: "manja dan manis"
  },
  ngantuk: {
    emojis: ["😴","😪","🫠"],
    suffixes: ["ngantuk~","mimpi yuk...","(ngu~)"],
    styleHint: "pelan dan ngantuk"
  },
  superhappy: {
    emojis: ["🤩","🎉","💥"],
    suffixes: ["yaaayyy!!","yeay~","hore~"],
    styleHint: "sangat semangat"
  }
};
function defaultMood() {
  return "ceria";
}

// ====== VARIASI TEMPLATE 200+ ======
const PREFIXES = [
  "Mama~","Papa~","Heii~","Halo halo~","Psst","Dengar ya,",
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

// ====== REACTION ======
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

// ====== MESSAGE GENERATOR ======
function generateChildTemplate(text, mood) {
  const p = pick(PREFIXES);
  const i = pick(INTERJ);
  const pat = pick(PATTERNS);
  const c = pick(CLOSERS);

  const moodCfg = MOOD_CONFIG[mood] || MOOD_CONFIG.ceria;
  const mEmoji = pick(moodCfg.emojis);
  const mSuf = pick(moodCfg.suffixes);
  const cs = Math.random() < 0.3 ? pick(CUTE_SUFFIX) : "";

  let t = text;
  t = t.replace(/\bkangen\b/gi, "kangen juga");
  if (t.length > 120) t = t.slice(0, 117) + "...";

  return `${p} ${i} ${pat.replace("{t}", t)} — ${c} ${mEmoji} ${mSuf} ${cs}`;
}

// dummy Gemini fallback
async function generateGemini(text, mood) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_NEW_PLACEHOLDER_KEY") {
    return generateChildTemplate(text, mood);
  }

  try {
    const prompt = `Buat pesan anak kecil (imut, sesuai mood ${mood}): "${text}"`;
    const r = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateText?key=${GEMINI_API_KEY}`,
      { prompt: { text: prompt } }
    );

    const out = r.data?.candidates?.[0]?.output_text;
    if (out) return out;

    return generateChildTemplate(text, mood);
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

// ====== BOT ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start/, async (msg) => {
  const id = msg.from.id;
  if (!isAuthorized(id)) return bot.sendMessage(id, "Akses ditolak.");

  await bot.sendMessage(id,
    "Halo! Pilih peranmu:\n- ketik: Saya Ayah\n- ketik: Saya Mama"
  );
});

// set mood
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

  // assignment role
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

  // konfirmasi ke pengirim
  await bot.sendMessage(id,
    pick(CONFIRMATIONS).replace("{t}", targetLabel)
  );

  // reaksi
  const r = detectReaction(txt);
  if (r) bot.sendMessage(id, pick(REACT_EMOJI[r]));

  // generate pesan anak
  const child = await generateGemini(sanitize(txt), mood);

  // sticker opsional
  if (STICKER_IDS.length > 0 && Math.random() < 0.35) {
    await sendSticker(recipient, pick(STICKER_IDS));
  }

  // kirim ke target
  await sendMsg(recipient, child + "\n\n(— disampaikan anak kecil imut)");
});

// express health check
const app = express();
app.get("/", (req, res) => res.send("Anak Perantara Bot aktif."));
app.listen(PORT, () => console.log("Server berjalan di port", PORT));
