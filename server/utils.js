const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomCode(length = 4) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

function createUniqueRoomCode(rooms) {
  let code;

  do {
    code = generateRoomCode(4);
  } while (rooms[code]);

  return code;
}

module.exports = {
  createUniqueRoomCode,
};
