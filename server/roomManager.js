const { createUniqueRoomCode } = require("./utils");

const rooms = {};
const socketToRoom = {};

function createRoom(socketId, name, gameMode) {
  const code = createUniqueRoomCode(rooms);

  const room = {
    code,
    gameMode,
    hostSocketId: socketId,
    maxPlayers: 4,
    gameStarted: false,
    players: {},
  };

  room.players[socketId] = makePlayer(socketId, name);

  rooms[code] = room;
  socketToRoom[socketId] = code;

  return room;
}

function makePlayer(socketId, name) {
  return {
    socketId,
    name: name || "Player",
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    hp: 100,
    alive: true,
  };
}

function joinRoom(roomCode, socketId, name) {
  const room = rooms[roomCode];

  if (!room) return { error: "Room not found" };
  if (room.gameStarted) return { error: "Game already started" };

  if (Object.keys(room.players).length >= room.maxPlayers) {
    return { error: "Room is full" };
  }

  room.players[socketId] = makePlayer(socketId, name);
  socketToRoom[socketId] = roomCode;

  return { room };
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

  delete room.players[socketId];
  delete socketToRoom[socketId];

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomCode];
  }

  return roomCode;
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  getRoomBySocket,
  leaveRoom,
};
