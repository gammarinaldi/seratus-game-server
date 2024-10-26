const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

let rooms = {};
let buzzers = {};

console.log('WebSocket server is starting...');

wss.on('listening', () => {
  console.log('WebSocket server is now listening on port 8080');
});

wss.on('connection', (ws, req) => {
  console.log(`New client connected from ${req.socket.remoteAddress}`);

  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    console.log('Received message:', message.toString());
    try {
      const { type, roomCode, participant } = JSON.parse(message);

      console.log(`Processing message type: ${type}, roomCode: ${roomCode}, participant: ${participant}`);

      switch (type) {
        case 'join':
          handleJoin(ws, roomCode, participant);
          break;
        case 'buzz':
          handleBuzz(roomCode, participant);
          break;
        case 'startQuestion':
          handleStartQuestion(roomCode);
          break;
        case 'gameStart':
          handleGameStart(roomCode);
          break;
        default:
          console.log(`Unknown message type: ${type}`);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`Client disconnected. Code: ${code}, Reason: ${reason}`);
    handleDisconnect(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function handleJoin(ws, roomCode, participant) {
  console.log(`Handling join for roomCode: ${roomCode}, participant: ${participant}`);
  
  if (!rooms[roomCode]) {
    rooms[roomCode] = new Set();
  }

  // Remove any existing connection for this participant
  wss.clients.forEach((client) => {
    if (client.roomCode === roomCode && client.participant === participant) {
      client.close();
    }
  });

  rooms[roomCode].add(participant);
  ws.roomCode = roomCode;
  ws.participant = participant;

  console.log(`Current participants in room ${roomCode}:`, Array.from(rooms[roomCode]));

  broadcastToRoom(roomCode, {
    type: 'update',
    roomCode,
    participants: Array.from(rooms[roomCode])
  });
}

function handleBuzz(roomCode, participant) {
  console.log(`Handling buzz for roomCode: ${roomCode}, participant: ${participant}`);
  console.log("Current buzzers state:", buzzers);
  
  if (!buzzers[roomCode]) {
    buzzers[roomCode] = participant;
    console.log(`First buzz in room ${roomCode} by ${participant}`);
    
    broadcastToRoom(roomCode, {
      type: 'buzzed',
      roomCode,
      participant
    });
  } else {
    console.log(`Buzz ignored: ${participant} was not first in room ${roomCode}`);
  }
}

function handleStartQuestion(roomCode) {
  console.log(`Starting new question for roomCode: ${roomCode}`);
  delete buzzers[roomCode];
  
  broadcastToRoom(roomCode, {
    type: 'questionStart',
    roomCode
  });
}

function handleGameStart(roomCode) {
  console.log(`Game starting for roomCode: ${roomCode}`);
  broadcastToRoom(roomCode, {
    type: 'gameStart',
    roomCode
  });
}

function handleDisconnect(ws) {
  if (ws.roomCode && ws.participant) {
    const roomCode = ws.roomCode;
    console.log(`Handling disconnect for roomCode: ${roomCode}, participant: ${ws.participant}`);
    
    if (rooms[roomCode]) {
      rooms[roomCode].delete(ws.participant);
      
      console.log(`Updated participants in room ${roomCode}:`, Array.from(rooms[roomCode]));

      broadcastToRoom(roomCode, {
        type: 'update',
        roomCode,
        participants: Array.from(rooms[roomCode])
      });
    }
  } else {
    console.log('Disconnected client was not associated with a room');
  }
}

function broadcastToRoom(roomCode, message) {
  console.log(`Broadcasting to room ${roomCode}:`, message);
  let clientCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.roomCode === roomCode) {
      client.send(JSON.stringify(message));
      clientCount++;
    }
  });
  console.log(`Message broadcast to ${clientCount} clients in room ${roomCode}`);
}

// Add a heartbeat to keep connections alive
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

console.log('WebSocket server is running on ws://localhost:8080');
