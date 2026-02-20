const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Per-room state storage
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      state: {
        status: 0,
        eta: null,
        msg: '',
        meetPoint: '',
        targetTime: null
      },
      timeline: [] // { time, event }
    };
  }
  return rooms[roomId];
}

function addTimeline(roomId, event) {
  const room = getRoom(roomId);
  room.timeline.push({ time: Date.now(), event });
  if (room.timeline.length > 30) room.timeline.shift(); // cap at 30
}

// QR Code API
app.get('/api/qrcode', async (req, res) => {
  const roomId = req.query.room || 'default';
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  const url = `http://${localIP}:${PORT}?room=${roomId}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#ffffff', light: '#00000000' } });
    res.json({ qr: dataUrl, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  const roomId = socket.handshake.query.room || 'default';
  socket.join(roomId);
  const room = getRoom(roomId);

  // Send current state + timeline on connect
  socket.emit('state-update', room.state);
  socket.emit('timeline-sync', room.timeline);

  socket.on('change-state', (payload) => {
    if (typeof payload === 'number') {
      room.state.status = payload;
      room.state.eta = null;
      room.state.msg = '';
      addTimeline(roomId, '🔄 系統重置');
    } else {
      if (payload.status !== undefined) room.state.status = payload.status;
      if (payload.eta !== undefined) room.state.eta = payload.eta;
      if (payload.msg !== undefined) room.state.msg = payload.msg;
      if (payload.meetPoint !== undefined) room.state.meetPoint = payload.meetPoint;
      if (payload.targetTime !== undefined) room.state.targetTime = payload.targetTime;

      // Auto-generate timeline entry
      if (payload.timelineEvent) {
        addTimeline(roomId, payload.timelineEvent);
      }
    }
    io.to(roomId).emit('state-update', room.state);
    io.to(roomId).emit('timeline-sync', getRoom(roomId).timeline);
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('--------------------------------------------------');
  console.log(`🚗 接送神隊友 v7 (終極全功能版) 已啟動！`);
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();

  let localIP = 'localhost';
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log(`📡 手機瀏覽器請開啟: http://${localIP}:${PORT}`);
  console.log(`📡 家庭頻道範例: http://${localIP}:${PORT}?room=myFamily`);
  console.log('--------------------------------------------------');
});
