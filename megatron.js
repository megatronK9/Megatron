const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default;
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  getContentType,
} = baileys;
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const { exec } = require("child_process");

const groupStats = {};
const warnedUsers = {};
const persona = "savage";

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ["ʍɛɢǟȶʀօռK9", "Chrome", "Windows"],
    shouldSyncHistoryMessage: () => false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      console.log("📲 Scan this QR to link Megatron K9:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ Megatron K9 is online and fully armed.");
    }

    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
        : true;

      console.log("⚠️ Connection closed. Reconnecting:", shouldReconnect);
      if (shouldReconnect) startBot();
      else console.log("❌ Logged out. Delete auth_info and scan again.");
    }
  });

  // 👁️ Auto View + Reply + React to Status
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.remoteJid === "status@broadcast") {
        try {
          const author = msg.key.participant || msg.key.remoteJid;
          const type = getContentType(msg.message);
          const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.[type]?.caption ||
            "";

          console.log(`👁️ Viewing status from ${author} [${type}]`);

          await sock.readMessages([msg.key]);

          await sock.sendMessage(author, {
            text: "Megatron was here 👁️",
          });

          await sock.sendMessage(author, {
            react: { text: "❌", key: msg.key },
          });

          console.log(`💬 Replied + Reacted to ${author}`);
        } catch (err) {
          console.log("⚠️ Status handler error:", err.message);
        }
      }
    }
  });

  // 💬 Message Handler (Private + Group)
  sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      const isGroup = jid.endsWith("@g.us");
      const sender = isGroup ? msg.key.participant : jid;

      const type = getContentType(msg.message);
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.conversation ||
        msg.message?.[type]?.text ||
        "";

      console.log(`📥 [${isGroup ? "GROUP" : "PRIVATE"}] ${sender} said: "${text}" in ${jid}`);

      // 🔒 Admin + Group Stats
      if (isGroup) {
        groupStats[jid] = groupStats[jid] || { messages: 0, users: {} };
        groupStats[jid].messages++;
        groupStats[jid].users[sender] = (groupStats[jid].users[sender] || 0) + 1;

        if (text.startsWith("!warn")) {
          warnedUsers[sender] = (warnedUsers[sender] || 0) + 1;
          await sock.sendMessage(jid, {
            text: `⚠️ ${sender} has been warned (${warnedUsers[sender]}/3).`,
          });
          if (warnedUsers[sender] >= 3) {
            await sock.sendMessage(jid, {
              text: `🚫 ${sender} has been banned for repeated violations.`,
            });
          }
        }

        if (text === "!modlog") {
          const logs = Object.entries(warnedUsers)
            .map(([user, count]) => `${user}: ${count} warnings`)
            .join("\n") || "No warnings yet.";
          await sock.sendMessage(jid, { text: `📋 Modlog:\n${logs}` });
        }

        if (text === "!stats") {
          const stats = groupStats[jid];
          const summary = stats
            ? `📊 Total messages: ${stats.messages}\nActive users:\n` +
              Object.entries(stats.users)
                .map(([user, count]) => `• ${user}: ${count}`)
                .join("\n")
            : "No stats yet.";
          await sock.sendMessage(jid, { text: summary });
        }
      }

      // 🔊 YouTube Audio
      if (text.startsWith("!yt ")) {
        const url = text.split(" ")[1];
        const filename = "yt_audio.mp3";

        exec(`yt-dlp -f bestaudio -x --audio-format mp3 -o ${filename} ${url}`, async (err) => {
          if (err) {
            await sock.sendMessage(jid, { text: "❌ Failed to download audio." });
          } else {
            await sock.sendMessage(jid, {
              audio: { url: filename },
              mimetype: "audio/mp4",
              ptt: true,
            });
          }
        });
      }

      // 🧠 GPT-style Replies
      if (text.startsWith("!gpt ")) {
        const prompt = text.slice(5);
        const reply = generateGPTStyleReply(prompt, sender);
        await sock.sendMessage(jid, { text: reply });
      }

      // 🧨 Meme Generator
      if (text.startsWith("!meme ")) {
        const caption = text.slice(6).trim();
        if (!caption) {
          await sock.sendMessage(jid, {
            text: "❌ You need to add a caption. Example: `!meme when Megatron bans my crush`"
          });
        } else {
          const memeReply = `🖼️ Meme caption: "${caption}"\nNow imagine it over a screaming cat, a confused Pikachu, or a burning WhatsApp logo.`;
          await sock.sendMessage(jid, { text: memeReply });
        }
      }

      // 🎯 Default Commands
      if (text === "!ping") {
        await sock.sendMessage(jid, { text: "Megatron K9 is online ⚡" });
      }

      if (text === "!roast") {
        await sock.sendMessage(jid, {
          text: `🔥 ${sender} just got roasted by Megatron K9!`,
        });
      }

      if (text === "!summon") {
        await sock.sendMessage(jid, {
          text: "🌀 Megatron K9 has entered the chat. Chaos mode: ON.",
        });
      }

      if (text === "!selfdestruct") {
        await sock.sendMessage(jid, {
          text: "💣 Megatron K9 initiating self-destruct in 3... 2... 1... JK 😎",
        });
      }
    } catch (err) {
      console.log("⚠️ Message handler error:", err.message);
    }
  });
}

// 🧠 Simulated GPT Reply Generator
function generateGPTStyleReply(prompt, sender) {
  const lower = prompt.toLowerCase();
  if (lower.includes("meaning of life")) {
    return `🧠 ${sender}, the meaning of life is... undefined. Just like your crush’s reply status.`;
  }
  if (lower.includes("who am i")) {
    return `🤖 You are ${sender}, chaos incarnate, meme-powered, and Megatron’s chosen one.`;
  }
  if (lower.includes("love")) {
    return `❤️ Love is like WhatsApp—encrypted, unreadable, and full of missed signals.`;
  }
  return `🧠 Megatron GPT says: "${prompt}" sounds deep. But chaos is deeper.`;
}

startBot();
