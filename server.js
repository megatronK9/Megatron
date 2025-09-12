const WebSocket = require('ws');
const PORT = 8080;

try {
    const wss = new WebSocket.Server({ host: '127.0.0.1', port: PORT }, () => {
        console.log(`🚀 WebSocket server running on ws://127.0.0.1:${PORT}`);
    });

    wss.on('connection', (ws) => {
        console.log('🟢 WebSocket client connected');
        ws.send('Megatron K9 WebSocket is live');

        ws.on('message', (msg) => {
            console.log('📨 Received:', msg);
        });
    });

    wss.on('error', (err) => {
        console.error('❌ WebSocket server error:', err.message);
    });
} catch (err) {
    console.error('🔥 Failed to start WebSocket server:', err.message);
}
