const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    const sock = makeWASocket({
        auth: state
    });

    // ✅ This is how you listen for QR code updates
    sock.ev.on("connection.update", (update) => {
        const { qr } = update;
        if (qr) {
            console.log("Scan this QR with WhatsApp Web:");
            console.log(qr);
        }
    });

    // ✅ Save credentials when they update
    sock.ev.on("creds.update", saveCreds);

    // ✅ Message handler
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const text = msg.message.conversation || "";
        const sender = msg.key.remoteJid;

        if (text.toLowerCase().includes("roast")) {
            await sock.sendMessage(sender, { text: "You're the reason autocorrect gave up 💀" });
        } else {
            await sock.sendMessage(sender, { text: "Megatron K9 is online. Say 'roast' to get flamed 🔥" });
        }
    });
}

startBot();
