/**
 * Anak Perantara Bot (dengan mood, memory, reaksi, sticker, variasi 200+)
 *
 * ENV yang wajib diset di Render / env:
 * - TELEGRAM_BOT_TOKEN    (contoh: 123456:ABCdef...)
 * - AYAH_ID               (contoh: 5547109522)
 * - MAMA_ID               (contoh: 1442119828)
 * - GEMINI_API_KEY        (optional placeholder: YOUR_NEW_PLACEHOLDER_KEY)
 * - STICKER_IDS           (optional, comma-separated Telegram sticker file_ids)
 * - PORT                  (opsional, default 3000)
 *
 * Catatan placeholder: saat mengisi environment variables di panel Render / hosting,
 * masukkan nilai tanpa tanda petik. Contoh:
 *   TELEGRAM_BOT_TOKEN = 123456:ABCdef...
 *
 * Cara kerja singkat:
 * - Hanya AYAH_ID dan MAMA_ID yang diizinkan.
 * - Saat user belum memilih role, mereka harus pilih lewat /start (ketik "ayah" atau "mama").
 * - Ketika mengirim teks, bot membalas konfirmasi & menyampaikan pesan ke pasangan
 *   dalam "suara anak kecil" (menggunakan generator template + (opsional) Gemini).
 * - Mood memengaruhi nada/pilihan kata/emoji/sticker.
 * - Memory menyimpan N pesan terakhir per user.
 */

import fs from "fs-extra";
import express from "express";
import axios from "axios";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.8315912129:AAE7R4GoeEs77rNHaWYN-SLTytLzQjVEdQM || "";
const AYAH_ID = Number(process.env.5547109522 || 0);
const MAMA_ID = Number(process.env.1442119828 || 0);
const GEMINI_API_KEY = process.env.AIzaSyDE6224M--QqEJ-5MgFWjGbrrGRMffaY_E || "YOUR_NEW_PLACEHOLDER_KEY";
const STICKER_IDS_RAW = process.env.STICKER_IDS || ""; // comma-separated
const STICKER_IDS = STICKER_IDS_RAW.split(",").map(s => s.trim()).filter(Boolean);

if (!BOT_TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN belum diset. Set environment variable TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}
if (!AYAH_ID || !MAMA_ID) {
  console.error("ERROR: AYAH_ID atau MAMA_ID belum diset dengan benar.");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const SESSION_FILE = "./sessions.json";
await fs.ensureFile(SESSION_FILE);
let sessions = {};
try {
  sessions = await fs.readJson(SESSION_FILE);
} catch (e) {
  sessions = {};
}

// Memory for messages per user (persisted)
const MEMORY_LIMIT = 50; // simpan maksimal 50 pesan terakhir per user

if (!sessions.users) sessions.users = {}; // struktur: users[userId] = { role, mood, history:[] }

function saveSessions() {
  return fs.writeJson(SESSION_FILE, sessions, { spaces: 2 });
}

function isAuthorized(userId) {
  return userId === AYAH_ID || userId === MAMA_ID;
}

function getOther(userId) {
  if (userId === AYAH_ID) return MAMA_ID;
  if (userId === MAMA_ID) return AYAH_ID;
  return null;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ----- MOOD SYSTEM -----
const MOODS = ["ceria", "manja", "ngantuk", "superhappy"];
// default mood when user sets role
function defaultMood() {
  return "ceria";
}

// mood impact: suffix, emoji, word-replacements per mood
const MOOD_CONFIG = {
  "ceria": {
    emojis: ["😊","😄","🙂"],
    suffixes: ["ya~","hehe","uwu"],
    styleHint: "ceria dan riang"
  },
  "manja": {
    emojis: ["🥺","😘","🤍"],
    suffixes: ["yaa~","muah~","ciiiin~"],
    styleHint: "manja dan manis"
  },
  "ngantuk": {
    emojis: ["😴","😪","🫠"],
    suffixes: ["ngantuk~","mimpi yuk...","(ngu~)"],
    styleHint: "pelan dan ngantuk"
  },
  "superhappy": {
    emojis: ["🤩","🎉","💥"],
    suffixes: ["yaaayyy!!","yeay~","hore~"],
    styleHint: "sangat semangat"
  }
};

// ----- VARIATION GENERATOR (kombinatorial) -----
// Arrays basis untuk kombinasi — dengan ukuran cukup besar untuk menghasilkan ratusan kombinasi.
const PREFIXES = [
  "Mama~","Papa~","Mamaa...","Heii~","Psst","Dengar ya,",
  "Mama sayang,","Papa sayang,","Haii~","Halo halo,","Kok gitu sih,"
];
const INTERJECTIONS = [
  "aku denger nih,","dia bilang,","kata papa,","kata mama,","dia nulis:", "ada yang bilang:",
  "katanya,","dia cuma bilang:", "dia bisik:", "dia ceritanya:"
];
const CUTE_PATTERNS = [
  'aku bilang: "{t}"', '"{t}" katanya', 'dia bilang gini: "{t}"', 'pesannya: "{t}"',
  'kata dia: "{t}"', 'dia nulis: "{t}"'
];
const CLOSERS = [
  "Mama ga kangen papa?", "Mama pasti kangen kan?", "Pulang ya nanti?", "Boleh dipeluk nggak?",
  "Peluk ya~", "Jangan marah ya~", "Pulang cepet dong~", "Mama, papa kangen juga~"
];
const CUTE_SUFFIXES = ["(uwu)","(>_<)","hehe","muach~","ngu~",":3","(ngek)","*peluk*"];

// confirmation replies ke pengirim (banyak variasi)
const CONFIRMATIONS = [
  "Oke, sudah aku sampaikan ke {target}!",
  "Sip! Nanti aku bilang ke {target}, tenang ya~",
  "Baik, aku katakan ke {target} sekarang juga hehe",
  "Siap! Anak kecil sudah ngantar pesan ke {target}",
  "Wokee! Aku kasih tahu {target} yaa~",
  "Udah kuy bilang ke {target}, jangan sedih~",
  "Hehe aku sampaikan ke {target} ya, pasti kangen!",
  "Siap kak, nanti aku suapin pesannya ke {target}! (nunjuk-nunjuk)",
  "Okee, aku bilangin ke {target} sekarang. Jangan lupa pake bantal ya~",
  "Aku sudah beritahu {target}, semoga dia senyum ya!"
];
// plus tambah pool untuk menambah variasi programatik
const EXTRA_CONFIRM_PHRASES = [
  "Tenang~ aku yang urus", "Udah kukirim ya", "Nanti aku kabarin", "Sudah aku catat",
  "Langsung kukabari", "Baiklah, dikirim sekarang", "Siap, ditunggu ya"
];

// ----- REACTIONS (emoji/sticker) berdasarkan keyword / mood -----
const REACTION_KEYWORDS = {
  "love": ["kangen","sayang","rindu","cinta"],
  "angry": ["marah","kesal","ngambek"],
  "happy": ["senang","happy","bahagia","seneng"],
  "sorry": ["maaf","minta maaf"]
};
const REACTION_EMOJI = {
  love: ["🥰","😘","💕"],
  angry: ["😳","😬","🤭"],
  happy: ["😁","😆","🎈"],
  sorry: ["😢","🙏","🥺"]
};

// ----- UTIL: sanitize & shorten -----
function sanitizeText(t) {
  if (!t) return "";
  return t.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, "").trim().slice(0, 500);
}

// ----- GENERATE CHILD MESSAGE (template-based, combinatorial) -----
function generateTemplateChildReply(originalText, mood = "ceria") {
  const p = pick(PREFIXES);
  const i = pick(INTERJECTIONS);
  const pattern = pick(CUTE_PATTERNS);
  const closer = pick(CLOSERS);
  const suffix = Math.random() < 0.35 ? (" " + pick(CUTE_SUFFIXES)) : "";

  // mood influence
  const moodCfg = MOOD_CONFIG[mood] || MOOD_CONFIG["ceria"];
  const moodEmoji = pick(moodCfg.emojis);
  const moodSuffix = pick(moodCfg.suffixes);

  // small transforms to make text 'lebih anak kecil'
  let t = originalText;
  t = t.replace(/\bkangen\b/gi, "kangen juga");
  t = t.replace(/\bsayang\b/gi, "sayang banget");
  if (t.length > 120) t = t.slice(0, 117) + "...";

  // combine
  const candidateTemplates = [
    `${p} ${i} ${pattern.replace("{t}", t)} — ${closer} ${moodEmoji} ${moodSuffix}${suffix}`,
    `${p} ${i} "${t}" ${closer} ${moodEmoji}${suffix}`,
    `${p} bilang "${t}". ${closer} ${moodEmoji} ${moodSuffix}${suffix}`,
    `${i} dia bilang: "${t}" ${closer} ${moodEmoji}${suffix}`,
    `${p} ${pattern.replace("{t}", t)} ${moodEmoji} ${moodSuffix}${suffix}`,
    `${pattern.replace("{t}", t)} ${closer} ${moodEmoji}${suffix}`
  ];

  // occasionally add small cute interjection
  let out = pick(candidateTemplates);
  if (Math.random() < 0.18) out = out + " " + pick(["Hehe","Hihi","Awww~","Muach~"]);
  return out.replace(/\s+/g, " ").trim();
}

// ----- GEMINI (placeholder) -----
// Jika kamu mengisi GEMINI_API_KEY dengan key valid, fungsi ini bisa diganti
// untuk memanggil API Gemini. Saat ini fallback ke template generator.
async function generateWithGemini(originalText, mood = "ceria") {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_NEW_PLACEHOLDER_KEY") {
    return generateTemplateChildReply(originalText, mood);
  }

  // Placeholder: panggilan Gemini harus disesuaikan dengan dokumentasi terbaru.
  // Sampel pseudo-code: (ganti endpoint & payload sesuai dokumentasi)
  try {
    const prompt = `Kamu adalah anak kecil dengan mood: ${mood}. Ubah pesan berikut menjadi gaya anak kecil imut:\n\n"${originalText}"\n\nBuat 1 versi.`;
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateText?key=${GEMINI_API_KEY}`,
      { prompt: { text: prompt } }
    );
    // sesuaikan parsing sesuai respons Gemini
    const textOut = resp.data?.candidates?.[0]?.output_text;
    if (textOut) return textOut;
    return generateTemplateChildReply(originalText, mood);
  } catch (err) {
    console.error("Gemini error, fallback ke template:", err?.message || err);
    return generateTemplateChildReply(originalText, mood);
  }
}

// ----- BUILDER KONFIRMASI KE PENGIRIM -----
function buildConfirmationForSender(targetLabel) {
  const t = pick(CONFIRMATIONS);
  // targetLabel = "Mama" atau "Ayah"
  return t.replace("{target}", targetLabel) + " " + pick(EXTRA_CONFIRM_PHRASES);
}

// ----- REACTION ENGINE: cek kata kunci, kirim emoji/sticker -----
function detectReactionKeywords(text) {
  const lower = text.toLowerCase();
  for (const [k, arr] of Object.entries(REACTION_KEYWORDS)) {
    for (const word of arr) {
      if (lower.includes(word)) return k;
    }
  }
  return null;
}

// ----- SENDING HELPERS -----
async function sendTelegramMessage(chatId, text, options = {}) {
  // gunakan endpoint sendMessage via axios supaya bebas custom
  try {
    const payload = {
      chat_id: chatId,
      text
    };
    if (options.parse_mode) payload.parse_mode = options.parse_mode;
    await axios.post(`${TELEGRAM_API}/sendMessage`, payload);
  } catch (err) {
    console.error("sendTelegramMessage error:", err?.response?.data || err.message);
  }
}

async function sendSticker(chatId, stickerFileId) {
  if (!stickerFileId) return;
  try {
    await axios.post(`${TELEGRAM_API}/sendSticker`, {
      chat_id: chatId,
      sticker: stickerFileId
    });
  } catch (err) {
    console.error("sendSticker error:", err?.response?.data || err.message);
  }
}

// ----- BOT SETUP (polling mode, aman untuk Render) -----
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// /start handler to guide selection
bot.onText(/\/start/, async (msg) => {
  const fromId = msg.from.id;
  if (!isAuthorized(fromId)) {
    await bot.sendMessage(fromId, "Maaf, bot ini hanya untuk Ayah & Mama. Akses ditolak.");
    return;
  }
  // reset role if wants to reselect
  const keyboard = {
    reply_markup: {
      keyboard: [["Saya Ayah"], ["Saya Mama"], ["/status", "/mood"]],
      one_time_keyboard: true,
      resize_keyboard: true
    }
  };
  await bot.sendMessage(fromId, "Halo! Pilih peranmu untuk sesi ini: ketik 'Saya Ayah' atau 'Saya Mama'.", keyboard);
});

// /status to check role & mood
bot.onText(/\/status/, async (msg) => {
  const uid = msg.from.id;
  if (!isAuthorized(uid)) {
    await bot.sendMessage(uid, "Akses ditolak.");
    return;
  }
  const u = sessions.users[uid] || {};
  await bot.sendMessage(uid, `Statusmu: role=${u.role || "belum dipilih"}, mood=${u.mood || "belum diset"}`);
});

// /mood <moodname> untuk set mood manual
bot.onText(/\/mood (.+)/, async (msg, match) => {
  const uid = msg.from.id;
  if (!isAuthorized(uid)) {
    await bot.sendMessage(uid, "Akses ditolak.");
    return;
  }
  const m = (match[1] || "").toLowerCase();
  if (!MOODS.includes(m)) {
    await bot.sendMessage(uid, `Mood tidak dikenal. Pilih salah satu: ${MOODS.join(", ")}`);
    return;
  }
  if (!sessions.users[uid]) sessions.users[uid] = {};
  sessions.users[uid].mood = m;
  await saveSessions();
  await bot.sendMessage(uid, `Mood diubah menjadi: ${m}`);
});

// Pesan teks handler utama
bot.on("message", async (msg) => {
  // skip non-text or service messages
  if (!msg.text) return;
  const uid = msg.from.id;
  const text = msg.text.trim();

  // ignore /start handled above
  if (text.startsWith("/start") || text.startsWith("/mood") || text.startsWith("/status")) return;

  if (!isAuthorized(uid)) {
    await bot.sendMessage(uid, "Maaf, bot ini hanya untuk Ayah & Mama.");
    return;
  }

  // ensure user session exists
  if (!sessions.users[uid] || !sessions.users[uid].role) {
    // try to parse simple selection
    const lower = text.toLowerCase();
    if (["saya ayah", "ayah", "aku ayah"].includes(lower)) {
      sessions.users[uid] = sessions.users[uid] || {};
      sessions.users[uid].role = "ayah";
      sessions.users[uid].mood = sessions.users[uid].mood || defaultMood();
      sessions.users[uid].history = sessions.users[uid].history || [];
      await saveSessions();
      await bot.sendMessage(uid, "Terdaftar sebagai Ayah. Sekarang kirim pesan, aku akan menyampaikan ya!");
      return;
    }
    if (["saya mama", "mama", "aku mama"].includes(lower)) {
      sessions.users[uid] = sessions.users[uid] || {};
      sessions.users[uid].role = "mama";
      sessions.users[uid].mood = sessions.users[uid].mood || defaultMood();
      sessions.users[uid].history = sessions.users[uid].history || [];
      await saveSessions();
      await bot.sendMessage(uid, "Terdaftar sebagai Mama. Sekarang kirim pesan, aku akan menyampaikan ya!");
      return;
    }
    await bot.sendMessage(uid, "Kamu belum pilih peran. Ketik 'Saya Ayah' atau 'Saya Mama', atau /start untuk panduan.");
    return;
  }

  // user is authorized and has role
  const userSession = sessions.users[uid];
  userSession.history = userSession.history || [];
  // push to memory (sender's perspective)
  userSession.history.push({ text, at: Date.now() });
  // trim history
  if (userSession.history.length > MEMORY_LIMIT) userSession.history.splice(0, userSession.history.length - MEMORY_LIMIT);
  await saveSessions();

  // decide mood (random small chance to change mood subtly)
  if (!userSession.mood) userSession.mood = defaultMood();
  if (Math.random() < 0.08) {
    // random small mood drift
    userSession.mood = pick(MOODS);
    await saveSessions();
  }

  // build confirmation for sender
  const targetLabel = userSession.role === "ayah" ? "Mama" : "Ayah";
  const confirmation = buildConfirmationForSender(targetLabel);
  await bot.sendMessage(uid, confirmation);

  // detect reaction keywords
  const reactionKey = detectReactionKeywords(text);
  if (reactionKey) {
    // send a reaction emoji to sender (fun)
    const emoji = pick(REACTION_EMOJI[reactionKey]);
    await bot.sendMessage(uid, `(${emoji})`);
  }

  // build childlike message for recipient
  const mood = userSession.mood;
  const childText = await generateWithGemini(sanitizeText(text), mood);

  // store delivered message to recipient's memory
  const recipientId = getOther(uid);
  sessions.users[recipientId] = sessions.users[recipientId] || { history: [], mood: defaultMood() };
  sessions.users[recipientId].history = sessions.users[recipientId].history || [];
  sessions.users[recipientId].history.push({ from: uid, text: childText, at: Date.now() });
  if (sessions.users[recipientId].history.length > MEMORY_LIMIT) sessions.users[recipientId].history.splice(0, sessions.users[recipientId].history.length - MEMORY_LIMIT);
  await saveSessions();

  // send optional sticker based on mood (random chance)
  if (STICKER_IDS.length > 0 && Math.random() < 0.35) {
    const s = pick(STICKER_IDS);
    await sendSticker(recipientId, s);
    // slight delay so sticker appears before text
    await new Promise(r => setTimeout(r, 400));
  }

  // send child message to recipient
  const delivered = `${childText}\n\n(— disampaikan oleh anak kecil yang imut)`;
  await sendTelegramMessage(recipientId, delivered);
});

// lightweight express health endpoint
const app = express();
app.get("/", (req, res) => res.send("Anak Perantara Bot aktif"));
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
