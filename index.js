const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const logs = [];        // Chat logs
const chat = {
    toAll:    true,
    toClient: false
}
const MessageType = {
    CHAT:   "chat",
    GAME:   "game",
    SERVER: "server"
}
const Tile = {
    RED:    0,
    GREEN:  1,
    BLUE:   2,
    BLACK:  3,
    YELLOW: 4
}
var gameInProgress = false;
var bag = [];           // Bag of tiles
var sockets = [];       // Socket IDs of all connected sockets
var playersReady = [];  // Socket IDs of all players that are ready
var players = [];       // Socket IDs of all players in the game
var factories = [];     // Factories
var rooms = [];         // Unused

const emptyBoard = {
    "patternLines": [
                    [-1],
                 [-1,-1],
              [-1,-1,-1],
           [-1,-1,-1,-1],
        [-1,-1,-1,-1,-1]
    ], 
    "wall": [
        [-1,-1,-1,-1,-1],
        [-1,-1,-1,-1,-1],
        [-1,-1,-1,-1,-1],
        [-1,-1,-1,-1,-1],
        [-1,-1,-1,-1,-1],
    ],
    "floor": []
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log("connected: " + socket.id);

    // Disconnect
    socket.on('disconnect', () => {
        // If player was in ready queue, remove them
        const playerReadyIndex = playersReady.indexOf(socket.id);
        if (playerReadyIndex > -1) { // Only remove if player id is found in playersReady array
            playersReady.splice(playerReadyIndex, 1); // Remove player from queue
            sendChat(io, socket.id, chat.toAll, MessageType.GAME, 
                minimizeID(socket.id) + (playersReady.indexOf(socket.id) + 1) + " has left the queue. Players in queue: " + playersReady.length + ".");
            if (playersReady[playerReadyIndex] != null) { // If a player has moved up in queue, send them game message of their new queue position
                let currentIndex = playerReadyIndex + 1;
                for (let i = playerReadyIndex; i < playersReady.length; i++) {
                    sendChat(io, socket.id, chat.toClient, MessageType.GAME, 
                        "Player ahead of you in queue has left. You are now #" + (currentIndex++) + " in queue.");
                }
            }
        }
        console.log("disconnected " + socket.id);
    });

    // Chat message
    socket.on('chat', (msg) => {
        console.log(socket.id + ': ' + msg);
        sendChat(io, socket.id, chat.toAll, MessageType.CHAT, msg);
        logs.push({sender: socket.id, message: msg, color: "black"});
    });

    // Ready status
    socket.on('ready', (status) => {
        if (status) { // Player is ready
            playersReady.push(socket.id);
            sendChat(io, socket.id, chat.toAll, MessageType.GAME, 
                minimizeID(socket.id) + (playersReady.indexOf(socket.id) + 1) + " has joined the queue. " + playersReady.length + ".");
            if (gameInProgress) { // Game is ongoing
                console.log(socket.id + " is ready, #" + playersReady.length + " in queue")
                sendChat(io, socket.id, chat.toClient, MessageType.SERVER, 
                    "Game in progress, you are #" + (playersReady.indexOf(socket.id) + 1) + " in queue.");
            } else { // Game is not ongoing
                if (!(playersReady.length <= 4)) {  // Already 4 players in queue before current player
                    console.log(socket.id + " is ready");
                    sendChat(io, socket.id, chat.toClient, MessageType.SERVER, 
                        "Four players in queue ahead of you, you may not join the next game. You are #" + (playersReady.indexOf(socket.id) + 1) + " in queue.");
                } else { // Already 4 players in queue before current player
                    console.log(socket.id + " is ready");
                }
            }
        } else { // Player is not ready
            console.log(socket.id + " is not ready");
            let playerReadyIndex = playersReady.indexOf(socket.id);
            if (playerReadyIndex > -1) { // Only remove if player id is found in playersReady array
                playersReady.splice(playerReadyIndex, 1); // Remove player from queue
                sendChat(io, socket.id, chat.toAll, MessageType.GAME, 
                    minimizeID(socket.id) + (playersReady.indexOf(socket.id) + 1) + " has left the queue. Players in queue: " + playersReady.length + ".");
                if (playersReady[playerReadyIndex] != null) { // If a player has moved up in queue, send them game message of their new queue position
                    let currentIndex = playerReadyIndex + 1;
                    for (let i = playerReadyIndex; i < playersReady.length; i++) {
                        sendChat(io, socket.id, chat.toClient, MessageType.GAME, 
                            "Player ahead of you in queue has left. You are now #" + (currentIndex++) + " in queue.");
                    }
                }
            }
        }
        console.log("   Currently ready players: " + playersReady);
    });

    // Restart game
    socket.on('restartGame', () => {
        if (playersReady.length < 2) { // Not enough ready players to start game
            sendChat(io, socket.id, chat.toClient, MessageType.SERVER, 
                "Not enough players in queue. Only " + playersReady.length + " player(s) in queue.");
        } else if (gameInProgress && players.some(e => e.id === socket.id)) { // Game already in progress and client is not a participant
            sendChat(io, socket.id, chat.toClient, MessageType.SERVER, 
                "Game in progress, you cannot restart the game as a spectator.");
        } else {
            console.log(socket.id + " restarted the game");

            // Lock in current players and assign them boards
            // remove first 4 players in playersReady[] and add them to players[]
            for (let i = 0; i < 4 && playersReady.length > 0; i++) {
                players.push({
                    "id": playersReady.shift(),
                    "score": 0,
                    "board": JSON.parse(JSON.stringify(emptyBoard))
                });
            }

            // Reset bag
            bag = [];
            for (let i = 0; i < 20; i++) {
                bag.push(
                    Tile.RED,
                    Tile.GREEN,
                    Tile.BLUE,
                    Tile.BLACK,
                    Tile.YELLOW);
            }
            shuffle(bag)
            console.log("bag: " + bag);

            factories = fillFactories();
            console.log("factories: " + factories)
        }
    });

    // Create room (Unused)
    socket.on('createRoom', () => {
        let newRoom = Math.random().toString(36).slice(2, 7);
        console.log('creating new room: ' + newRoom);
        rooms.push(newRoom);
        socket.join(newRoom);
    });

});

server.listen(3000, () => {
    console.log('listening on *:3000');
});



/** 
 * 888    888          888                               8888888888                         888    d8b                            
 * 888    888          888                               888                                888    Y8P                            
 * 888    888          888                               888                                888                                   
 * 8888888888  .d88b.  888 88888b.   .d88b.  888d888     8888888 888  888 88888b.   .d8888b 888888 888  .d88b.  88888b.  .d8888b  
 * 888    888 d8P  Y8b 888 888 "88b d8P  Y8b 888P"       888     888  888 888 "88b d88P"    888    888 d88""88b 888 "88b 88K      
 * 888    888 88888888 888 888  888 88888888 888         888     888  888 888  888 888      888    888 888  888 888  888 "Y8888b. 
 * 888    888 Y8b.     888 888 d88P Y8b.     888         888     Y88b 888 888  888 Y88b.    Y88b.  888 Y88..88P 888  888      X88 
 * 888    888  "Y8888  888 88888P"   "Y8888  888         888      "Y88888 888  888  "Y8888P  "Y888 888  "Y88P"  888  888  88888P' 
 *                         888                                                                                                    
 *                         888                                                                                                    
 *                         888     
*/

// Turns socket.id into something more readable (Ex. "tC9_RhtzaKAqfh4DAAAH" -> "TC9RH")
function minimizeID(id) {
    return id.toUpperCase().replace(/-|_/g, "").substring(0,5);
}

/**
 * @param {Server}  io 
 * @param {string}  id 
 * @param {boolean} SendToAll
 * @param {string}  type 
 * @param {string}  message 
 */
function sendChat(io, id, sendToAll, type, message) {
    let textColor;
    switch (type) {
        case MessageType.CHAT:
            textColor = "black";
            message = minimizeID(id) + ": " + message;
            break;
        case MessageType.GAME:
            textColor = "green";
            message = "[Game]: " + message;
            break;
        case MessageType.SERVER:
            textColor = "red";
            message = "[Server]: " + message;
            break;
        default:
            // Do nothing
    }
    if (sendToAll) { // Send chat to all players
        io.emit('chat', {
            "message": message,
            "color": textColor
        });
    } else { // Send chat only to specified player
        io.to(id).emit('chat', {
            "message": message,
            "color": textColor
        });
    }
}

/**
 * Fills factories with 4 tiles each according to player count:
 * 2 player games: 5 factories
 * 3 player games: 7 factories
 * 4 player games: 9 factories
 * @return {Array} Array of filled factories
 */
function fillFactories() {
    factoriesReturn = [];

    // Get number of factories based on number of players in game
    let numFactories;
    switch (players.length) {
        case 2:
            numFactories = 5;
            break;
        case 3:
            numFactories = 7;
            break;
        case 4:
            numFactories = 9;
            break;
        default:
            numFactories = -1;
    }
    // Fill factories with 4 tiles each
    for (let i = 0; i < numFactories; i++) {
        // Add empty factory
        factoriesReturn.push([]);
        // Push 4 tiles to empty factory
        for (let j = 0; j < 4; j++) {
            factoriesReturn[i].push(bag.pop());
        }
    }
    return factoriesReturn;
}

// Performs scoring phase of a player's board and includes end-game scoring.
/**
player = {
    "id": string,
    "score": int,
    "board": {
        "patternLines": [
                        [-1],
                     [-1,-1],
                  [-1,-1,-1],
               [-1,-1,-1,-1],
            [-1,-1,-1,-1,-1]
        ], 
        "wall": [
            [-1,-1,-1,-1,-1],
            [-1,-1,-1,-1,-1],
            [-1,-1,-1,-1,-1],
            [-1,-1,-1,-1,-1],
            [-1,-1,-1,-1,-1],
        ],
        "floor": []
    }
}
 */
function calculateScore(player) {
    for (let i = 0; i < 4; i++) { // Go down the array of patterns
        if (!(player.board.patternLines[i][0] == -1)) { // If pattern is complete
            [y,x] = [i, i % 5];
            player.board.wall[i][i % 5] = player.board.patternLines[i][0]; // Change tile color in wall to tile in complete pattern

            player.score += 1 
                + countConnected(y, x, "up", player.board.wall)
                + countConnected(y, x, "down", player.board.wall)
                + countConnected(y, x, "left", player.board.wall)
                + countConnected(y, x, "right", player.board.wall);
        }
    }
    if (!gameInProgress) {
        // Check rows (+2)
        for (let i = 0; i < 5; i++) {
            if (!(player.board.wall[i].includes(-1))) {
                score += 2;
            }
        }
        // Check Columns (+7)
        // TODO
        // Check Complete Color (+10)
        // TODO
    }
}

// Recursive function to count number of tiles in a specified cardinal direction according to the given coordinate
function countConnected(y, x, direction, wall) {
    switch (direction) {
        case "up":
            if (wall[y-1] == null || wall[y-1][x] == -1) {
                return 0;
            } else {
                return 1 + addLine(y-1, x, direction, wall);
            }
        case "down":
            if (wall[y+1] == null || wall[y+1][x] == -1) {
                return 0;
            } else {
                return 1 + addLine(y+1, x, direction, wall);
            }
        case "left":
            if (wall[y][x-1] == null || wall[y][x-1] == -1) {
                return 0;
            } else {
                return 1 + addLine(y, x-1, direction, wall);
            }
        case "right":
            if (wall[y][x+1] == null || wall[y][x+1] == -1) {
                return 0;
            } else {
                return 1 + addLine(y, x+1, direction, wall);
            }
    }
}

/**
 * @param {Array} array Array to be shuffled
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * TODO:
 * Server:
 * -taking tiles + adding them to board
 * -placing tiles
 * -center pile
 * -"1" tile + first to grab from center pile logic
 * -finish score calculation from player board
 * -end-game scoring phase
 * 
 * Client:
 * -everything
*/


// // Check end-game status (wall row complete)
// if (!(player.board.wall[i].includes(-1))) {
//     gameInProgress = false;
// }