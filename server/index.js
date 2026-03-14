const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const {
  createRoom,
  joinRoom,
  getRoomBySocket,
  leaveRoom,
  rooms,
  updatePlayerColor,
} = require("./roomManager");

const app = express();
app.use(cors());

app.get("/", (req, res) => res.send("FRC MiniGames Server v2 — running"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

function emitRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit("roomState", {
    code: room.code,
    gameMode: room.gameMode,
    players: Object.values(room.players),
    gameStarted: room.gameStarted,
    hostSocketId: room.hostSocketId,
  });
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("createRoom", ({ gameMode }) => {
    const room = createRoom(socket.id, gameMode || "");
    socket.join(room.code);
    socket.emit("roomCreated", { roomCode: room.code });
    emitRoomState(room.code);
  });

  socket.on("joinRoom", ({ roomCode }) => {
    const code = (roomCode || "").toUpperCase();
    const result = joinRoom(code, socket.id);
    if (result.error) {
      socket.emit("roomError", { message: result.error });
      return;
    }
    socket.join(code);
    socket.emit("joinedRoom", { roomCode: code });
    emitRoomState(code);
  });

  socket.on("selectColor", ({ playerNum, color, accent }) => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    updatePlayerColor(socket.id, color, accent);
    emitRoomState(room.code);
  });

  socket.on("startGame", () => {
    const room = getRoomBySocket(socket.id);
    if (!room) return;
    if (socket.id !== room.hostSocketId) {
      socket.emit("roomError", { message: "Only the host can start" });
      return;
    }
    if (Object.keys(room.players).length < 2) {
      socket.emit("roomError", { message: "Need 2 players to start" });
      return;
    }
    room.gameStarted = true;
    io.to(room.code).emit("gameStarting");
  });

  // P2 client sends input → relay to host
  socket.on("playerInput", (input) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !room.gameStarted) return;
    socket.to(room.hostSocketId).emit("remoteInput", input);
  });

  // Host sends game state → relay to all clients in room
  socket.on("gameState", (state) => {
    const room = getRoomBySocket(socket.id);
    if (!room || socket.id !== room.hostSocketId) return;
    socket.to(room.code).emit("gameState", state);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    const roomCode = leaveRoom(socket.id);
    if (roomCode) {
      io.to(roomCode).emit("playerLeft");
      emitRoomState(roomCode);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
