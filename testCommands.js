// testCommands.js
// Simulates sending commands to your bot for quick testing

async function runTests(sock, from, testUser) {
  console.log("🚀 Starting Megatron K9 test sequence...");

  // 1. Test ping
  await sock.sendMessage(from, { text: '!ping' });
  await new Promise(r => setTimeout(r, 1000));

  // 2. Test bugstorm
  await sock.sendMessage(from, { text: '!bugstorm' });
  await new Promise(r => setTimeout(r, 5000)); // wait for chaos to finish

  // 3. Test kick (tagging test user)
  await sock.sendMessage(from, { text: `!kick @${testUser.split('@')[0]}`, mentions: [testUser] });
  await new Promise(r => setTimeout(r, 2000));

  console.log("✅ Test sequence complete.");
}

module.exports = { runTests };
