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

const CrescendoClash = require("./gameModes/crescendo-clash");

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

// ── SERVER-AUTHORITATIVE GAME LOOP ────────────────────────────────────────────

/**
 * Start a server-side game simulation loop for the given room.
 * Reads room.playerInputs each tick, advances game state, and broadcasts to all clients.
 */
function startGameLoop(room) {
  const playersList = Object.values(room.players);
  const p1Data = playersList.find(p => p.playerNum === 1);
  const p2Data = playersList.find(p => p.playerNum === 2);

  if (room.gameMode === "crescendo-clash") {
    room.gameState = CrescendoClash.createGame(
      p1Data?.color  || "#FF6B00",
      p1Data?.accent || "#FFB347",
      p2Data?.color  || "#0066FF",
      p2Data?.accent || "#44AAFF"
    );
  } else {
    // Other game modes: no server simulation yet — clients handle it
    return;
  }

  // Input state for both players; justShoot is sticky until consumed by a tick
  room.playerInputs = {
    1: { up: false, down: false, left: false, right: false, boost: false, justShoot: false },
    2: { up: false, down: false, left: false, right: false, boost: false, justShoot: false },
  };

  room.gameLoop = setInterval(() => {
    if (room.gameMode === "crescendo-clash") {
      CrescendoClash.tick(room.gameState, room.playerInputs);

      // Consume justShoot after the tick so it fires exactly once per keypress
      room.playerInputs[1].justShoot = false;
      room.playerInputs[2].justShoot = false;

      const state = CrescendoClash.serialize(room.gameState);
      io.to(room.code).emit("gameState", state);

      if (room.gameState.gameEnded) {
        stopGameLoop(room);
      }
    }
  }, 1000 / 60); // ~60fps
}

function stopGameLoop(room) {
  if (!room) return;
  if (room.gameLoop) {
    clearInterval(room.gameLoop);
    room.gameLoop = null;
  }
  room.gameState = null;
  room.playerInputs = null;
}

// ── SOCKET HANDLERS ───────────────────────────────────────────────────────────

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
    // Server takes over as the authority — start the simulation loop
    startGameLoop(room);
  });

  // Both players send their input; server records it for the next game tick
  socket.on("playerInput", (input) => {
    const room = getRoomBySocket(socket.id);
    if (!room || !room.gameStarted || !room.playerInputs) return;
    const playerNum = room.players[socket.id]?.playerNum;
    if (!playerNum || !room.playerInputs[playerNum]) return;

    const pi = room.playerInputs[playerNum];
    pi.up    = !!input.up;
    pi.down  = !!input.down;
    pi.left  = !!input.left;
    pi.right = !!input.right;
    pi.boost = !!input.boost;
    // justShoot is sticky: once set true it stays true until the game tick consumes it
    if (input.justShoot) pi.justShoot = true;
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    const room = getRoomBySocket(socket.id);
    if (room) {
      // Stop the game simulation so it doesn't keep running with a ghost player
      if (room.gameStarted) stopGameLoop(room);
      const roomCode = leaveRoom(socket.id);
      if (roomCode) {
        io.to(roomCode).emit("playerLeft");
        emitRoomState(roomCode);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
