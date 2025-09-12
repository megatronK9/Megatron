require('events').EventEmitter.defaultMaxListeners = 50;
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const qrcode = require('qrcode-terminal');

// ===== Owner & config =====
const OWNER_JID = '2547XXXXXXXX@s.whatsapp.net'; // set your full JID (no +)
const OWNER_WHITELIST = new Set([OWNER_JID]);

// ===== AI config =====
const OPENAI_MODEL = 'gpt-4o-mini'; // chat model
const WHISPER_MODEL = 'whisper-1';  // speech-to-text
const AI_MEMORY_FILE = './ai_memory.json';
const MAX_TURNS = 12; // last N messages per chat to include as context

// ===== Utilities =====
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const RANDOM_EMOJIS = ['😈','🔥','💀','⚡','👁️','🚀','🎭','🧠','🤖','👾','💫','🗿','🛡️','🦾','🐍','🦈','🦂','💥','✨','🎯','🏆','🌀','🌪️','🌟','🧨','🥷','🧩','🔮','🗡️','🎮','📟','🛰️','🧪','🪬'];

// persist memory to disk (simple, robust)
function loadMemory() {
  try {
    const raw = fs.readFileSync(AI_MEMORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function saveMemory(db) {
  try {
    fs.writeFileSync(AI_MEMORY_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('AI memory save error:', e);
  }
}

// build VCF
function buildVCF(participants) {
  let i = 1, vcf = '';
  for (const p of participants) {
    const num = p.id.split('@')[0];
    const name = `Megatron (${i})`;
    vcf += `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\nTEL;TYPE=CELL:+${num}\nEND:VCARD\n`;
    i++;
  }
  return vcf;
}

// group admin check
async function isAdmin(sock, from, jid) {
  const meta = await sock.groupMetadata(from);
  const admins = meta.participants.filter(p => ['admin','superadmin'].includes(p.admin)).map(p => p.id);
  return admins.includes(jidNormalizedUser(jid));
}

// yt-dlp download
async function ytdlpDownload({ query, type }) {
  const stamp = Date.now();
  const out = path.resolve(`${type}_${stamp}.${type}`);
  const base = `yt-dlp -o "${out}" "${query}"`;
  const cmd = type === 'mp3'
    ? `${base} -f bestaudio -x --audio-format mp3`
    : `${base} -f bestvideo+bestaudio/best`;
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => err ? reject(err) : resolve(out));
  });
}

// ===== AI: Chat & Whisper =====
async function aiChat(messages) {
  if (!process.env.OPENAI_API_KEY) {
    return 'Megatron K9: AI core is locked. Set OPENAI_API_KEY to unleash full power.';
  }
  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature: 0.3
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return `Megatron K9: AI growled (${res.status}). ${t}`;
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || '...';
}

async function aiTranscribeOgg(buffer) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  // Minimal multipart form without extra deps
  const boundary = `----megatron${Date.now()}`;
  const CRLF = '\r\n';
  const head =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="audio.ogg"${CRLF}` +
    `Content-Type: audio/ogg${CRLF}${CRLF}`;
  const tailModel =
    `${CRLF}--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="model"${CRLF}${CRLF}${WHISPER_MODEL}${CRLF}` +
    `--${boundary}--${CRLF}`;
  const bodyBuffer = Buffer.concat([
    Buffer.from(head, 'utf8'),
    buffer,
    Buffer.from(tailModel, 'utf8')
  ]);

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body: bodyBuffer
  });
  if (!res.ok) {
    console.error('Whisper error:', await res.text().catch(()=>''), res.status);
    return null;
  }
  const json = await res.json();
  return json.text || null;
}

// memory helpers
function pushMemory(memDB, chatId, role, content) {
  if (!memDB[chatId]) memDB[chatId] = [];
  memDB[chatId].push({ role, content, t: Date.now() });
  if (memDB[chatId].length > MAX_TURNS*2) {
    memDB[chatId] = memDB[chatId].slice(-MAX_TURNS*2);
  }
}
function buildChatMessages(memDB, chatId, systemPrompt) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  const history = memDB[chatId] || [];
  for (const h of history.slice(-MAX_TURNS*2)) {
    msgs.push({ role: h.role, content: h.content });
  }
  return msgs;
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();
  const memDB = loadMemory();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: 'silent' }),
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);
  process.on('SIGINT', () => { saveMemory(memDB); process.exit(0); });
  process.on('SIGTERM', () => { saveMemory(memDB); process.exit(0); });

  // QR handling
sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        if (shouldReconnect) {
            console.log('🔄 Reconnecting...');
            startBot(); // your function to init the bot
        } else {
            console.log('❌ Logged out. Scan QR again.');
        }
    } else if (connection === 'open') {
        console.log('✅ Connected to WhatsApp');
    }
});
  // Main handler
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = isGroup ? (msg.key.participant || '') : from;
    const pushName = msg.pushName || 'Unknown';

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    const meme = text.trim();
    const memeLC = meme.toLowerCase();

    // ===== Status auto-handling =====
    if (from === 'status@broadcast') {
      try {
        await sock.readMessages([msg.key]); // auto-view
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }); // react ❌
        await sock.sendMessage(from, {
          text: `Megatron was here 👁\nStatus viewed by the legend @${pushName}`,
          mentions: [sender]
        }, { quoted: msg });
      } catch (e) {
        console.error('Auto-status error:', e);
      }
      return;
    }

    // ===== Private chat: auto-react random emoji =====
    if (!isGroup) {
      try {
        const emoji = RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
        await sock.sendMessage(from, { react: { text: emoji, key: msg.key } });
      } catch (_) {}
    }

    // ===== Voice notes: transcribe + answer =====
    if (msg.message.audioMessage) {
      try {
        const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
        let buf = Buffer.from([]);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        const transcript = await aiTranscribeOgg(buf);
        if (transcript) {
          // store and answer
          pushMemory(memDB, from, 'user', transcript);
          const systemPrompt = 'You are Megatron K9 — concise, accurate, no fluff. Answer with the real truth. If unsure, say so plainly.';
          const messages = buildChatMessages(memDB, from, systemPrompt);
          const answer = await aiChat(messages);
          pushMemory(memDB, from, 'assistant', answer);
          saveMemory(memDB);
          await sock.sendMessage(from, { text: `🎙️ You said: ${transcript}\n\n🤖 ${answer}` }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { text: '❌ Could not transcribe this audio.' }, { quoted: msg });
        }
      } catch (e) {
        console.error('voice transcribe error:', e);
      }
      // continue; allow commands in caption-less audio? we stop here.
      return;
    }

    // ===== Commands =====

    // ping
    if (memeLC === 'ping' || memeLC === '!ping') {
      const t1 = Date.now();
      await sock.sendMessage(from, { text: 'Pinging…' });
      const t2 = Date.now();
      await sock.sendMessage(from, { text: `🏓 Pong: ${t2 - t1}ms` });
      return;
    }

    // status
    if (memeLC === 'status' || memeLC === '!status') {
      const up = process.uptime();
      const h = Math.floor(up / 3600);
      const m2 = Math.floor((up % 3600) / 60);
      const s = Math.floor(up % 60);
      await sock.sendMessage(from, { text: `🟢 Megatron K9 online\nUptime: ${h}h ${m2}m ${s}s` });
      return;
    }

    // help/menu
    if (['help','!help','menu','!menu'].includes(memeLC)) {
      const help = [
        'Megatron K9 — Commands',
        '',
        'Private:',
        '- ping | status | help | menu',
        '- !ytmp3 <url/search> | !ytmp4 <url/search>',
        '- Auto-reacts with random emojis',
        '- Voice note Q&A (transcribe + answer)',
        '',
        'Group (admin only moderation):',
        '- !warn @user <reason> | !kick @user | !ban @user',
        '- !vcf  (export contacts as VCF named Megatron (n))',
        '- !gstats',
        '',
        'Statuses:',
        '- Auto-view, auto-react ❌, auto-reply',
        '- Reply to a status: !save (owner only)',
        '',
        'AI:',
        '- !megatron <question> (also replies when mentioned/tagged)',
        '',
        'Owner:',
        '- !bug @user <1-30> (soft buzz, rate-limited)'
      ].join('\n');
      await sock.sendMessage(from, { text: help });
      return;
    }

    // YouTube MP3
    if (memeLC.startsWith('!ytmp3 ')) {
      const query = meme.slice(7).trim();
      if (!query) {
        await sock.sendMessage(from, { text: '🎵 Usage: !ytmp3 <url or search>' });
        return;
      }
      await sock.sendMessage(from, { text: '⏬ Downloading MP3…' });
      try {
        const out = await ytdlpDownload({ query, type: 'mp3' });
        await sock.sendMessage(from, {
          audio: { url: out },
          mimetype: 'audio/mpeg',
          ptt: true
        });
      } catch (e) {
        console.error('ytmp3 error:', e);
        await sock.sendMessage(from, { text: '❌ Failed to download MP3.' });
      }
      return;
    }

    // YouTube MP4
    if (memeLC.startsWith('!ytmp4 ')) {
      const query = meme.slice(7).trim();
      if (!query) {
        await sock.sendMessage(from, { text: '📹 Usage: !ytmp4 <url or search>' });
        return;
      }
      await sock.sendMessage(from, { text: '⏬ Downloading MP4…' });
      try {
        const out = await ytdlpDownload({ query, type: 'mp4' });
        await sock.sendMessage(from, {
          video: { url: out },
          caption: '🎬 Megatron K9 delivery'
        });
      } catch (e) {
        console.error('ytmp4 error:', e);
        await sock.sendMessage(from, { text: '❌ Failed to download MP4.' });
      }
      return;
    }

    // ===== AI: explicit command =====
    if (memeLC.startsWith('!megatron ')) {
      const q = meme.slice('!megatron '.length).trim();
      if (!q) {
        await sock.sendMessage(from, { text: '🤖 Ask like: !megatron Why is the sky blue?' });
        return;
      }
      const sys = 'You are Megatron K9 — concise, accurate, no fluff. Answer with the real truth. Cite facts plainly; if uncertain, say so.';
      pushMemory(memDB, from, 'user', q);
      const messages = buildChatMessages(memDB, from, sys);
      const ans = await aiChat(messages);
      pushMemory(memDB, from, 'assistant', ans);
      saveMemory(memDB);
      await sock.sendMessage(from, { text: ans }, { quoted: msg });
      return;
    }

    // ===== AI: Mention or tag triggers =====
    // Trigger if bot is mentioned or name appears
    const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const botMentioned = mentionedJid.includes(jidNormalizedUser(sock.user.id)) || /megatron/i.test(meme);
    if (botMentioned && memeLC !== '!megatron') {
      const q = meme.replace(/@?\w*megatron\w*/ig, '').trim() || 'Answer succinctly.';
      const sys = 'You are Megatron K9 — concise, accurate, no fluff. Answer with the real truth. Avoid disclaimers.';
      pushMemory(memDB, from, 'user', q);
      const messages = buildChatMessages(memDB, from, sys);
      const ans = await aiChat(messages);
      pushMemory(memDB, from, 'assistant', ans);
      saveMemory(memDB);
      await sock.sendMessage(from, { text: ans }, { quoted: msg });
      return;
    }

    // ===== Group-only moderation & tools =====
    if (isGroup) {
      // warn
      if (memeLC.startsWith('!warn ')) {
        if (!(await isAdmin(sock, from, sender))) {
          await sock.sendMessage(from, { text: '🚫 Admins only.' }, { quoted: msg });
          return;
        }
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const mentioned = ctx?.mentionedJid || [];
        const reason = meme.slice(6).trim() || 'No reason';
        if (!mentioned.length) {
          await sock.sendMessage(from, { text: 'Usage: !warn @user <reason>' }, { quoted: msg });
          return;
        }
        await sock.sendMessage(from, {
          text: `⚠️ Warned ${mentioned.map(x=>`@${x.split('@')[0]}`).join(' ')} — ${reason}`,
          mentions: mentioned
        }, { quoted: msg });
        return;
      }

      // kick
      if (memeLC.startsWith('!kick ')) {
        if (!(await isAdmin(sock, from, sender))) {
          await sock.sendMessage(from, { text: '🚫 Admins only.' }, { quoted: msg });
          return;
        }
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const mentioned = ctx?.mentionedJid || [];
        if (!mentioned.length) {
          await sock.sendMessage(from, { text: 'Usage: !kick @user' }, { quoted: msg });
          return;
        }
        try {
          await sock.groupParticipantsUpdate(from, mentioned, 'remove');
          await sock.sendMessage(from, {
            text: `🚪 Kicked ${mentioned.map(x=>`@${x.split('@')[0]}`).join(' ')}`,
            mentions: mentioned
          });
        } catch (e) {
          console.error('kick error:', e);
          await sock.sendMessage(from, { text: '❌ Kick failed.' }, { quoted: msg });
        }
        return;
      }

      // ban (same as kick here)
      if (memeLC.startsWith('!ban ')) {
        if (!(await isAdmin(sock, from, sender))) {
          await sock.sendMessage(from, { text: '🚫 Admins only.' }, { quoted: msg });
          return;
        }
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const mentioned = ctx?.mentionedJid || [];
        if (!mentioned.length) {
          await sock.sendMessage(from, { text: 'Usage: !ban @user' }, { quoted: msg });
          return;
        }
        try {
          await sock.groupParticipantsUpdate(from, mentioned, 'remove');
          await sock.sendMessage(from, {
            text: `🔨 Banned ${mentioned.map(x=>`@${x.split('@')[0]}`).join(' ')}`,
            mentions: mentioned
          });
        } catch (e) {
          console.error('ban error:', e);
          await sock.sendMessage(from, { text: '❌ Ban failed.' }, { quoted: msg });
        }
        return;
      }

      // group stats
      if (memeLC === '!gstats' || memeLC === 'gstats') {
        try {
          const meta = await sock.groupMetadata(from);
          const admins = meta.participants.filter(p => ['admin','superadmin'].includes(p.admin)).length;
          const total = meta.participants.length;
          const subject = meta.subject || 'Unnamed';
          const owner = meta.owner || 'Unknown';
          const created = meta.creation ? new Date(meta.creation * 1000).toLocaleString() : 'Unknown';
          const txt = [
            `📊 Group Stats — ${subject}`,
            `Members: ${total}`,
            `Admins: ${admins}`,
            `Owner: ${owner}`,
            `Created: ${created}`
          ].join('\n');
          await sock.sendMessage(from, { text: txt });
        } catch (e) {
          console.error('gstats error:', e);
          await sock.sendMessage(from, { text: '❌ Failed to fetch group stats.' });
        }
        return;
      }

      // vcf export
      if (memeLC === '!vcf' || memeLC === 'vcf') {
        try {
          const meta = await sock.groupMetadata(from);
          const vcf = buildVCF(meta.participants);
          const file = path.resolve(`Megatron_Contacts_${Date.now()}.vcf`);
          fs.writeFileSync(file, vcf);
          await sock.sendMessage(from, {
            document: { url: file },
            mimetype: 'text/vcard',
            fileName: path.basename(file),
            caption: `📇 Exported ${meta.participants.length} contacts`
          });
        } catch (e) {
          console.error('vcf error:', e);
          await sock.sendMessage(from, { text: '❌ Failed to export VCF.' }, { quoted: msg });
        }
        return;
      }
    }

    // ===== Status save (owner only; must reply to a status) =====
    if (memeLC === '!save' && sender === OWNER_JID) {
      const ctx = msg.message.extendedTextMessage?.contextInfo;
      if (!ctx || !ctx.quotedMessage) {
        await sock.sendMessage(from, { text: '❌ Reply to a status to save it.' }, { quoted: msg });
        return;
      }
      const quotedFrom = ctx.remoteJid || '';
      if (quotedFrom !== 'status@broadcast') {
        await sock.sendMessage(from, { text: '❌ This is not a status.' }, { quoted: msg });
        return;
      }
      try {
        const mediaMsg = ctx.quotedMessage;
        const mediaType = Object.keys(mediaMsg)[0];
        const stream = await downloadContentFromMessage(
          mediaMsg[mediaType],
          mediaType.replace('Message', '')
        );
        let buffer = Buffer.from([]);
        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
        await sock.sendMessage(OWNER_JID, {
          [mediaType.replace('Message', '')]: buffer,
          caption: '💾 Megatron K9 — Status Secured'
        });
        await sock.sendMessage(from, { text: '✅ Status saved to your DM.' }, { quoted: msg });
      } catch (e) {
        console.error('save status error:', e);
        await sock.sendMessage(from, { text: '❌ Failed to save status.' }, { quoted: msg });
      }
      return;
    }

    // ===== Owner-only soft “bug” (rate-limited) =====
    if (memeLC.startsWith('!bug ')) {
      if (!OWNER_WHITELIST.has(jidNormalizedUser(sender))) {
        await sock.sendMessage(from, { text: '🚫 Owner only.' }, { quoted: msg });
        return;
      }
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];
      let count = parseInt(memeLC.split(' ').pop(), 10);
      if (!mentioned.length || Number.isNaN(count)) {
        await sock.sendMessage(from, { text: 'Usage: !bug @user <count 1-30>' }, { quoted: msg });
        return;
      }
      if (count < 1) count = 1;
      if (count > 30) count = 30;
      const target = mentioned[0];
      await sock.sendMessage(from, { text: `🐝 Buzzing @${target.split('@')[0]} x${count}`, mentions: [target] });
      for (let i = 1; i <= count; i++) {
        await sock.sendMessage(target, { text: `Megatron ping ${i}/${count} ⚡` }).catch(()=>{});
        await sleep(350);
      }
      await sock.sendMessage(from, { text: `✅ Buzz complete for @${target.split('@')[0]}`, mentions: [target] });
      return;
    }

  }); // end messages.upsert
} // end startBot

startBot();
