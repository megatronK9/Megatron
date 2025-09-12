// ====== LOG FILTER ======
const originalLog = console.log;
const originalInfo = console.info;
const BLOCKED_PATTERNS = [
  'Completed migration attempt for user devices',
  'deviceCount',
  'migration attempt'
];
function shouldBlockLog(args) {
  const str = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return BLOCKED_PATTERNS.some(p => str.includes(p));
}
console.log = (...args) => { if (!shouldBlockLog(args)) originalLog(...args); };
console.info = (...args) => { if (!shouldBlockLog(args)) originalInfo(...args); };

// ====== IMPORTS ======
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const P = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

// ====== GLOBALS ======
let sock;
const OWNER_ID = '254706029195@s.whatsapp.net';
const blockAttemptTracker = {};
const blockCommandLog = new Set();

let AUTO_VIEW_STATUS = true;
let AUTO_STATUS_REACT = true;
let AUTO_STATUS_REPLY = true;
let AUTO_REACT_MESSAGES = true;
// Track recent messages for delete/purge commands
let recentMessages = [];

const statusTracker = {};
const EMOJI_BANK = ['🔥','⚡','💀','👾','🧠','💥','🚀','🐺','🗡️','🛡️','🎯','🌀','😎','🥷','🦂','🌪️','🧨','💣','⛓️','🔮','📡','🌌','✨','💫','🪐','🌋'];
const SAVAGE_EMOJIS = [...EMOJI_BANK];
const LINK_BANK = [
  'https://youtu.be/dQw4w9WgXcQ','https://example.com','https://developer.mozilla.org','https://www.wikipedia.org','https://github.com'
];

// ====== MEMORY SYSTEM ======
let memDB = { statusLog: [] };

function saveMemory(db) {
  try {
    fs.writeFileSync('./memory.json', JSON.stringify(db, null, 2));
    console.log('💾 Memory saved to memory.json');
  } catch (err) {
    console.error('Error saving memory:', err.message);
  }
}

function loadMemory() {
  try {
    if (fs.existsSync('./memory.json')) {
      memDB = JSON.parse(fs.readFileSync('./memory.json'));
      console.log('📂 Memory loaded from memory.json');
    }
  } catch (err) {
    console.error('Error loading memory:', err.message);
  }
}

loadMemory();

// ====== HELPERS ======
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomLinks = (n) => [...LINK_BANK].sort(() => 0.5 - Math.random()).slice(0, Math.min(Math.max(1, n), 10));
const getText = (msg) => {
  if (!msg?.message) return '';
  const m = msg.message;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
};
const isOwner = (jid) => jid === OWNER_ID;
const formatTimestamp = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}.${String(now.getMilliseconds()).padStart(3,'0')}`;
};
const renderMenu = () => [
  '🧭 *Megatron K9 — Command Matrix*',
  '',
  'Public Commands:',
  '• !menu — Show this menu',
  '• !ping — Latency scan with timestamp',
  '• !bug N — Link storm (N=1–10)',
  '• !fight @user — Defensive clapback',
  '• !song query — Search links for music',
  '• !playlist — MegatronK9 YouTube playlist',
  '• !ask question — Ask AI brain',
  '• !about — Bot lore',
  '• !id — Show your JID',
  '• !save — Save memory & status log',
  '',
  'Owner Commands:',
  '• !autoview on/off — Toggle status auto-view',
  '• !autoreact on/off — Toggle status auto-react',
  '• !autoreply on/off — Toggle status auto-reply',
  '• !purge N — Delete last N bot messages',
  '• !block — Block current chat or target',
  '• !unblock — Unblock current chat or target',
  '• !delete — Clear recent chat from both sides',
  '',
  '— Megatron K9: ruthless precision. Unfazed by chaos.'
].join('\n');

// ====== BOOT ======
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: P({ level: 'info' }), syncFullHistory: false });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) { console.log('Scan this QR to link Megatron:'); qrcode.generate(qr, { small: true }); }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ Megatron K9 online.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // ===== STATUS AUTO-PILOT (status@broadcast method) =====
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
// Track all incoming messages (commands + normal)
recentMessages.push(msg);
if (recentMessages.length > 200) recentMessages.shift(); // keep memory light
    if (!msg || msg.key.remoteJid !== 'status@broadcast') return;

    const jid = msg.key.participant || msg.key.remoteJid;
    const today = new Date().toDateString();

    if (AUTO_VIEW_STATUS) {
      await sock.readMessages([msg.key]);
    }
    if (AUTO_STATUS_REACT) {
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }

    const statusText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const mediaType = Object.keys(msg.message || {})[0] || 'unknown';
    memDB.statusLog.push({ jid, date: today, text: statusText, mediaType });

    if (AUTO_STATUS_REPLY && statusTracker[jid] !== today) {
      await sock.sendMessage(jid, { text: 'Status seen by Megatron.' });
      statusTracker[jid] = today;
    }
  });

  // ===== AUTO-UNBLOCK OVERRIDE =====
  sock.ev.on('blocklist.update', async (update) => {
    const list = update.blocklist || [];
    for (const jid of list) {
      if (jid === OWNER_ID && !blockCommandLog.has(jid)) {
        try {
          await sock.updateBlockStatus(jid, 'unblock');
          await sock.sendMessage(jid, { text: `🧠 *Firewall Override Triggered*\nUnauthorized block reversed.` });
        } catch (err) {
          console.error('Auto-unblock failed:', err.message);
        }
      }
    }
  });

  // ===== MESSAGE HANDLER =====
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg) return;
    const from = msg.key.remoteJid;
    const senderId = msg.key.fromMe ? OWNER_ID : (msg.key.participant || msg.key.remoteJid);
    const isGroup = from.endsWith('@g.us');
    const text = getText(msg).trim();
    if (!/^[!.]/.test(text)) return;

    if (AUTO_REACT_MESSAGES) {
      const savageEmoji = SAVAGE_EMOJIS[Math.floor(Math.random() * SAVAGE_EMOJIS.length)];
      await sock.sendMessage(from, { react: { text: savageEmoji, key: msg.key } });
    }

    const [rawCmd, ...rest] = text.replace(/^[!.]/, '').split(/\s+/);
    const cmd = rawCmd.toLowerCase();
    const argLine = rest.join(' ');

    if (cmd === 'playlist') {
    return sock.sendMessage(from, {
        text: `🎶 *MegatronK9 Playlist* 🎶\nTap to open and play the latest drops:\nhttps://www.youtube.com/playlist?list=UULFq4JQaaE8pttYjXT7eU2Neg`
    });
}
    // Block/Unblock
    if (cmd === 'block' || cmd === 'unblock') {
      if (isOwner(senderId)) {
        let targetJid;
        if (!isGroup) {
          targetJid = from;
        } else {
          const ctx = msg.message?.extendedTextMessage?.contextInfo;
          if (ctx?.mentionedJid?.length) {
            targetJid = ctx.mentionedJid[0];
          } else if (rest[0]) {
            targetJid = `${rest[0].replace(/[^0-9]/g, '')}@s.whatsapp.net`;
          } else {
            await sock.sendMessage(from, { text: `⚠️ Usage: .${cmd} <number or @mention>` });
            return;
          }
        }

        try {
          if (cmd === 'block') {
            await sock.sendMessage(from, { text: `🚨 *Overlord Protocol Engaged*\nTarget will be neutralized.` });
            await sock.updateBlockStatus(targetJid, 'block');
            blockCommandLog.add(targetJid);
            await sock.sendMessage(from, { text: `🚫 *Execution Complete*\n${targetJid} has been blocked.` });
          } else if (cmd === 'unblock') {
            await sock.sendMessage(from, { text: `🔓 *Overlord Restoration Protocol*\nAccess for ${targetJid} is being restored…` });
            await sock.updateBlockStatus(targetJid, 'unblock');
            await sock.sendMessage(from, { text: `✅ ${targetJid} has been unblocked.` });
          }
        } catch (err) {
          await sock.sendMessage(from, { text: `❌ ${cmd} failed for ${targetJid}: ${err.message}` });
        }
        return;
      } else {
        const attempts = blockAttemptTracker[senderId] || 0;
        if (attempts === 0) {
          blockAttemptTracker[senderId] = 1;
          await sock.sendMessage(from, { text: `⚠️ *Unauthorized Command Detected*\nNext attempt will result in automatic lockdown.` });
        } else {
          blockAttemptTracker[senderId] = 2;
          await sock.updateBlockStatus(senderId, 'block');
          await sock.sendMessage(from, { text: `🚫 *Megatron Defense Protocol Activated*\nYou are now permanently blocked.` });
        }
        return;
      }
    }

    // Delete (patched to use loadMessages)
if (cmd === 'delete' && isOwner(senderId)) {
    const n = parseInt(rest[0]) || 5; // number to delete
    const toDelete = recentMessages
        .filter(m => m.key.remoteJid === from && m.key.fromMe) // only your messages
        .slice(-n);

    let count = 0;
    for (const m of toDelete) {
        try {
            await sock.sendMessage(from, { delete: m.key });
            count++;
        } catch {}
    }
    return sock.sendMessage(from, { text: `🗑️ Overlord purge complete: ${count} messages cleared.` });
}
    // Public commands
    if (cmd === 'menu') return sock.sendMessage(from, { text: renderMenu() });
    if (cmd === 'ping') {
      const t0 = Date.now();
      const stamp = formatTimestamp();
      await sock.sendMessage(from, { text: `🚀 *Megatron Ping Scan*\n🕒 Timestamp: ${stamp}` });
      const latency = Date.now() - t0;
      return sock.sendMessage(from, { text: `✅ Response window: ~${latency} ms` });
    }
    if (cmd === 'bug') {
      const n = Math.max(1, Math.min(parseInt(rest[0], 10) || 5, 10));
      const links = randomLinks(n);
      return sock.sendMessage(from, { text: `🧨 Protocol: LINK STORM\n${links.join('\n')}` });
    }
    if (cmd === 'fight') {
      const target = rest[0] || '';
      return sock.sendMessage(from, { text: `🛡️ Protocol: DEFENSE ONLINE.${target ? `\nTarget: ${target}` : ''}` });
    }
    if (cmd === 'song') {
      const query = argLine.trim();
      if (!query) return;
      const q = encodeURIComponent(query);
      const links = [
        `https://www.youtube.com/results?search_query=${q}`,
        `https://music.youtube.com/search?q=${q}`,
        `https://open.spotify.com/search/${q}`
      ];
      return sock.sendMessage(from, { text: `🎵 Search links for: ${query}\n\n${links.join('\n')}` });
    }
    if (cmd === 'ask') {
      const aiPrompt = argLine.trim();
      if (!aiPrompt) return;
      await sock.sendMessage(from, { text: `${pick(['🤖','🧠','⚡','🔮'])} Calculating a flawless answer...` });
      return sock.sendMessage(from, { text: 'AI link offline. (Set up your AI backend to enable live answers.)' });
    }
    if (cmd === 'about') return sock.sendMessage(from, { text: '👾 Megatron K9 — meme‑forged, chaos‑tempered, precision‑engineered.' });
    if (cmd === 'id') return sock.sendMessage(from, { text: `🪪 Your JID:\n${from}` });
    if (cmd === 'save') {
      saveMemory(memDB);
      return sock.sendMessage(from, { text: '💾 Status log and memory engraved. Megatron remembers all.' });
    }

    // Status toggles
    if (cmd === 'autoview' && isOwner(senderId)) {
      AUTO_VIEW_STATUS = argLine.toLowerCase() === 'on';
      return sock.sendMessage(from, { text: `✅ Auto-view status: ${AUTO_VIEW_STATUS ? 'ON' : 'OFF'}` });
    }
    if (cmd === 'autoreact' && isOwner(senderId)) {
      AUTO_STATUS_REACT = argLine.toLowerCase() === 'on';
      return sock.sendMessage(from, { text: `✅ Auto-react to status: ${AUTO_STATUS_REACT ? 'ON' : 'OFF'}` });
    }
    if (cmd === 'autoreply' && isOwner(senderId)) {
      AUTO_STATUS_REPLY = argLine.toLowerCase() === 'on';
      return sock.sendMessage(from, { text: `✅ Auto-reply to status: ${AUTO_STATUS_REPLY ? 'ON' : 'OFF'}` });
    }
  });

  process.on('SIGINT', () => { saveMemory(memDB); process.exit(0); });
  process.on('SIGTERM', () => { saveMemory(memDB); process.exit(0); });
}


// --- Keep-Alive Server for Railway ---
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('MegatronK9 is online.');
});

app.listen(3000, () => {
  console.log('Keep-alive server running on port 3000');
});

startBot();
