export function setupSocket(io) {
  io.on('connection', (socket) => {
    socket.emit('hello', { ok: true, ts: new Date().toISOString() });
  });
}
