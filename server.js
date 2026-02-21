const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const localIP = getLocalIP();
const PORT = 3000;
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};
function getRoom(id) {
  if (!rooms[id]) rooms[id] = { state: { status: 0, eta: null, msg: '', meetPoint: '', targetTime: null, liveMapUrl: null }, timeline: [] };
  return rooms[id];
}
function addTL(id, ev) { const r = getRoom(id); r.timeline.push({ time: Date.now(), event: ev }); if (r.timeline.length > 30) r.timeline.shift(); }

io.on('connection', (socket) => {
  const rid = socket.handshake.query.room || 'default';
  socket.join(rid);
  const room = getRoom(rid);
  socket.emit('state-update', room.state);
  socket.emit('timeline-sync', room.timeline);

  socket.on('change-state', (p) => {
    if (typeof p === 'number') { room.state.status = p; room.state.eta = null; room.state.msg = ''; room.state.liveMapUrl = null; addTL(rid, '🔄 系統重置'); }
    else {
      if (p.status !== undefined) room.state.status = p.status;
      if (p.eta !== undefined) room.state.eta = p.eta;
      if (p.msg !== undefined) room.state.msg = p.msg;
      if (p.meetPoint !== undefined) room.state.meetPoint = p.meetPoint;
      if (p.targetTime !== undefined) room.state.targetTime = p.targetTime;
      if (p.liveMapUrl !== undefined) room.state.liveMapUrl = p.liveMapUrl;
      if (p.timelineEvent) addTL(rid, p.timelineEvent);
    }
    io.to(rid).emit('state-update', room.state);
    io.to(rid).emit('timeline-sync', room.timeline);
  });
});

app.get('/api/qrcode', async (req, res) => {
  const roomId = req.query.room || 'default';
  const role = req.query.role || 'rider';
  const url = `http://${localIP}:${PORT}?room=${roomId}&role=${role}`;
  try {
    const d = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#ffffff', light: '#00000000' } });
    res.json({ qr: d, url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('══════════════════════════════════════════════════');
  console.log('🚗 接送神隊友 v9');
  console.log('');
  console.log(`🛒 乘客: http://${localIP}:${PORT}?role=rider`);
  console.log(`🚙 司機: http://${localIP}:${PORT}?role=driver`);
  console.log('══════════════════════════════════════════════════');
});
