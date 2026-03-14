const { createUniqueRoomCode } = require("./utils");

const rooms = {};
const socketToRoom = {};

function createRoom(socketId, gameMode) {
  const code = createUniqueRoomCode(rooms);
  const room = {
    code,
    gameMode,
    hostSocketId: socketId,
    maxPlayers: 2,
    gameStarted: false,
    players: {},
  };
  room.players[socketId] = makePlayer(socketId, 1);
  rooms[code] = room;
  socketToRoom[socketId] = code;
  return room;
}

function makePlayer(socketId, playerNum) {
  const defaults = {
    1: { color: "#FF6B00", accent: "#FFB347" },
    2: { color: "#0066FF", accent: "#44AAFF" },
  };
  const d = defaults[playerNum] || defaults[1];
  return { socketId, playerNum, color: d.color, accent: d.accent };
}

function joinRoom(roomCode, socketId) {
  const room = rooms[roomCode];
  if (!room) return { error: "Room not found" };
  if (room.gameStarted) return { error: "Game already started" };
  if (Object.keys(room.players).length >= room.maxPlayers)
    return { error: "Room is full" };

  const playerNum = Object.keys(room.players).length + 1;
  room.players[socketId] = makePlayer(socketId, playerNum);
  socketToRoom[socketId] = roomCode;
  return { room };
}

function updatePlayerColor(socketId, color, accent) {
  const roomCode = socketToRoom[socketId];
  if (!roomCode) return;
  const room = rooms[roomCode];
  if (!room || !room.players[socketId]) return;
  room.players[socketId].color = color;
  room.players[socketId].accent = accent || color;
}

function getRoomBySocket(socketId) {
  const roomCode = socketToRoom[socketId];
  if (!roomCode) return null;
  return rooms[roomCode];
}

function leaveRoom(socketId) {
  const roomCode = socketToRoom[socketId];
  if (!roomCode) return null;
  const room = rooms[roomCode];
  if (!room) return null;

  delete room.players[socketId];
  delete socketToRoom[socketId];

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomCode];
    return roomCode;
  }

  // If host left, reassign host to remaining player
  if (room.hostSocketId === socketId) {
    const newHost = Object.keys(room.players)[0];
    room.hostSocketId = newHost;
    room.players[newHost].playerNum = 1;
    room.gameStarted = false;
  }

  return roomCode;
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  getRoomBySocket,
  leaveRoom,
  updatePlayerColor,
};
