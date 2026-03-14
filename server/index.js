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
} = require("./roomManager");

const crescendoClashMode = require("./gameModes/crescendo-clash");

const app = express();

app.use(cors());

app.get("/", (req, res) => {
  res.send("Server running");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

function emitRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit("roomState", {
    code: room.code,
    players: Object.values(room.players),
    gameStarted: room.gameStarted,
    hostSocketId: room.hostSocketId,
  });
}

io.on("connection", (socket) => {

  console.log("Connected:", socket.id);

  socket.on("createRoom", ({ name, gameMode }) => {

    const room = createRoom(socket.id, name, gameMode);

    socket.join(room.code);

    socket.emit("roomCreated", {
      roomCode: room.code,
      playerId: socket.id,
    });

    emitRoomState(room.code);

  });

  socket.on("joinRoom", ({ roomCode, name }) => {

    const result = joinRoom(roomCode, socket.id, name);

    if (result.error) {
      socket.emit("roomError", { message: result.error });
      return;
    }

    socket.join(roomCode);

    socket.emit("joinedRoom", {
      roomCode,
      playerId: socket.id,
    });

    emitRoomState(roomCode);

  });

  socket.on("playerInput", (input) => {

    const room = getRoomBySocket(socket.id);
    if (!room) return;

    crescendoClashMode.updatePlayer(room, socket.id, input);

    emitRoomState(room.code);

  });

  socket.on("attack", () => {

    const room = getRoomBySocket(socket.id);
    if (!room) return;

    crescendoClashMode.handleAttack(room, socket.id);

    emitRoomState(room.code);

  });

  socket.on("disconnect", () => {

    console.log("Disconnected:", socket.id);

    const roomCode = leaveRoom(socket.id);

    if (roomCode) {
      emitRoomState(roomCode);
    }

  });

});

server.listen(3001, () => {
  console.log("Server running on port 3001");
});
