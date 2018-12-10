// Express middleware for game lobbies

//[IMPORTS]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const shortid = require('shortid');
const timeout = require('./timeout.js');

//[CONSTANTS]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const Code = {
  SUCCESS: 600,
  FAIL:    601,
  MISSING:
  {
    LOBBY:   700,
    PLAYER:  701,
    PASS:    702,
  },
  INVALID:
  {
    REQUEST_TYPE:  800,
    LOBBY_NAME:    801,
    LOBBY_PASS:    802,
    PLAYER_NAME:   803,
  },
  ERROR:
  {
    LOBBY_DNE:      900,
    PLAYER_DNE:     901,
    NAME_IN_USE:    902,
    LOBBIES_FULL:   903,
    PASS_WRONG:     904,
    LOBBY_FULL:     905,
    LOBBY_STARTED:  906,
  },
  BROADCAST:
  {
    PLAYERS_UPDATED:      1000,
    READY_STATE_UPDATED:  1001,
    GAME_START:        1002,
    GAME_END:          1003,
  },
  PLAYER:
  {
    INIT:                  1100,
    READY_STATE_RECEIVED:  1101,
  },
};

//[SETTINGS]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
exports.verbose = false;  // Verbose will print more log messages
function v(msg, ...args) {
  if (exports.verbose) {
    console.log(msg, ...args);
  }
}

let MAX_LOBBIES = 4;  //Default max is 4
let lobbies = new Map();
// Set the max number of lobbies to support
exports.setMaxLobbies = function(max) {
  v("Max lobby count set to: %d", max);
  MAX_LOBBIES = max;
}

let MAX_PLAYERS = 10;  //Default max is 10
exports.setMaxPlayers = function(max) {
  v("Max player count set to: %d", max);
  MAX_PLAYERS = max;
}

//[EVENTS]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// List of event calls and their args
let eventCalls = {
  lobby_create: stub,        // (lobby)
  lobby_delete: stub,        // (lobby)
  player_join: stub,         // (lobby, player)
  player_leave: stub,        // (lobby, player)
  player_msg: stub,          // (lobby, player, data)
  player_sse_attached: stub, // (lobby, player)
  game_start: stub,          // (lobby)
};
function stub(){};

// Attach handlers to lobby events
exports.on = function(eventType, functionToCall) {
  if (eventType in eventCalls) {
    eventCalls[eventType] = functionToCall;
  } else {
    console.warn("Trying to register and invalid event: %s", eventType);
  }
};

//[MIDDLEWARE]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Express middleware to catch requests
exports.expressMiddleware = function() {
  return function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    
    let data = req.body;
    switch (data.type) {
      case "start": 
        handleStartRequest(req, res, data);
        break;
      case "validateId":
        handleValidateRequest(req, res, data);
        break;
      case "join":
        handleJoinRequest(req, res, data);
        break;
      case "ready":
        handleReadyState(req, res, data);
        break;
      case "msg":
        handleMessage(req, res, data);
        break;
      default:
        sendCode(res, Code.INVALID.REQUEST_TYPE, "Request Type Unknown");
    }
    next();
  };
};

// Express middleware to attach SSE Clients
exports.expressSSEMiddleware = function() {
  return (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    // res.header("Access-Control-Allow-Credentials", true);
    res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
          });

    // Validate the request
    let data = parseQuery(req.url);
    if (!("lobbyId" in data)) {
      writeCode(res, Code.MISSING.LOBBY, "missing lobbyId");
      return;
    }
    if (!("playerId" in data)) {
      writeCode(res, Code.MISSING.PLAYER, "no player id");
      return;
    }

    if (!lobbies.has(data.lobbyId)) {
      writeCode(res, Code.ERROR.LOBBY_DNE, "invalid lobby");
      return;
    }
    let lobby = lobbies.get(data.lobbyId);
    let result = lobby._attachSSE(res, data.playerId);
    if (!result) {
      writeCode(res, Code.ERROR.PLAYER_DNE, "player not found");
    }
    next();
  };
};

//[PRIVATE]~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function handleStartRequest(req, res, data) {
  if (!("name" in data) || data.name.length == 0 || data.name.length > 15) {
    sendCode(res, Code.INVALID.LOBBY_NAME, "Invalid lobby name");
    return;
  }
  if (!("pass" in data) || data.pass.length == 0 || data.pass.length > 15) {
    sendCode(res, Code.INVALID.LOBBY_PASS, "Invalid lobby pass");
    return;
  }
  let newLobby = requestLobby(data.name, data.pass);
  if (newLobby === false) {
    sendCode(res, Code.ERROR.LOBBIES_FULL, "Lobbies are full!");
  } else {
    sendCode(res, Code.SUCCESS, newLobby.getId());
  }
}

function handleValidateRequest(req, res, data) {
  if (!("lobbyId" in data) || data.lobbyId.length == 0) {
    //Invalid id
    sendCode(res, Code.MISSING_DATA.LOBBY, "Missing LobbyID");
    return;
  }
  v("Validating lobbyId: " + data.lobbyId);
  if (lobbies.has(data.lobbyId)) {
    sendCode(res, Code.SUCCESS, "LobbyID valid");
  } else {
    sendCode(res, Code.FAIL, "LobbyID invalid");
  }
}

function handleJoinRequest(req, res, data) {
  if (lobbies.has(data.lobbyId)) {
    let lobby = lobbies.get(data.lobbyId);
    if (data.pass !== lobby.getPass()) {
      sendCode(res, Code.ERROR.PASS_WRONG, "password incorrect");
      return;
    }
    let name = data.displayName;
    if (name === null || name.length === 0) {
      sendCode(res, Code.INVALID.PLAYER_NAME, "invalid name");
      return;
    };
    if (lobby.playerCount >= MAX_PLAYERS) {
      sendCode(res, Code.ERROR.LOBBY_FULL, "lobby is full");
      return;
    }
    if (lobby.isStarted()) {
      sendCode(res, Code.ERROR.LOBBY_STARTED, "lobby already started");
      return;
    }
    let player = lobby._addPlayer(name);
    if (player === false) {
      sendCode(res, Code.ERROR.NAME_IN_USE, "name taken");
      return;
    }
    sendCode(res, Code.SUCCESS, player);
  } else {
    sendCode(res, Code.ERROR.LOBBY_DNE, "Lobby doesn't exist!");
  }
}

function handleMessage(req, res, data) {
  if (lobbies.has(data.lobbyId)) {
    let lobby = lobbies.get(data.lobbyId);
    let player = lobby.getPlayer(data.clientId);
    if (player === false) {
      sendCode(res, Code.ERROR.PLAYER_DNE, "Player doesn't exist!");
      return;
    }
    eventCalls.player_msg(lobby, player, data);
    sendCode(res, Code.SUCCESS, "message submitted");
  } else {
    sendCode(res, Code.ERROR.LOBBY_DNE, "Lobby doesn't exist!");
  }
}

function handleReadyState(req, res, data) {
  res.sendStatus(200);
  if (lobbies.has(data.lobbyId)) {
    let lobby = lobbies.get(data.lobbyId);
    lobby.playerReadyState(data.clientId, data.ready);
  }
}

function requestLobby(name, pass) {
  v("Lobby was requested");
  if (lobbies.size < MAX_LOBBIES) {
    let id = generateLobbyId();
    let lobby = new Lobby(id, name, pass);
    lobbies.set(id, lobby);
    v("Created lobby - id: %s", id);
    eventCalls.lobby_create(lobby);
    return lobby;
  }
  v("Lobby capacity full");
  return false;
};

function removeLobby(lobbyId) {
  if (lobbies.has(lobbyId)) {
    let lobby = lobbies.get(lobbyId);
    v("Deleted lobby - id: %s", lobbyId);
    eventCalls.lobby_delete(lobby);
    lobbies.delete(lobbyId);
  }
}

function Lobby(_id, _name, _pass) {
  const NO_RESPONSE_TIMEOUT = 20; //20s
  const id = _id;        // lobbyId
  const name = _name;    // Name of the lobby
  const pass = _pass;    // Password
  const timer = timeout.create(() => {
    removeLobby(id);
  }, NO_RESPONSE_TIMEOUT);
  let players = new Map();      // Map of players connected;
  let started = false;
  
  this.getId = function() {
    return id;
  };
  this.getName = function() {
    return name;
  };
  this.getPass = function() {
    return pass;
  };
  this.playerCount = function() {
    return players.size;
  };
  // Runs a function on all current players
  this.foldPlayers = function(fold) {
    for (let [key, val] of players) {
      fold(val);
    }
  };
  
  this.getPlayer = function(playerId) {
    if (players.has(playerId)) {
      return players.get(playerId);
    }
    return false;
  }
  this.isStarted = function() {
    return started;
  }
  
  this.extras = {};  // Extras that can be used for game data
  
  /**
   * Adds a player with the given name, if the name is not yet taken
   * @param name  name to use
   * @return    the playerId if successful, false otherwise
   */
  this._addPlayer = function(name) {
    for (let [key, val] of players) {
      if (val.getName() === name) {
        return false;
      }
    }
    let player = new Player(name, this);
    players.set(player.getId(), player);
    v("Lobby[%s]: Player %s joined.", id, player.getName());
    if (players.size === 1) {
      v("Player joined, stopping lobby timeout timer");
      timer.stop();
    }
    eventCalls.player_join(this, player);
    // Notify all players
    playersChanged();
    return player.getId();
  };
  
  /*
   * Remove a player with the given id
   * @param id    id of the player to remove
   */
  this._removePlayer = function(playerId) {
    if (players.has(playerId)) {
      let player = players.get(playerId);
      v("Lobby[%s]: Player left - id: %s", id, playerId);
      eventCalls.player_leave(this, player);
      players.delete(playerId);
      playersChanged();
      if (players.size === 0) {
        v("No players remaining, lobby will timeout");
        timer.start();
      }
    }
  };
  
  /**
   * Attaches an SSE to the appropriate player
   * @param  _res      the response to attach
   * @param  playerId  the player id to find
   * @return   true if attached succesfully, false otherwise
   */
  this._attachSSE = function(_res, playerId) {
    let player = players.get(playerId);
    if (player === false) {
      return false;
    }
    player.attachRes(_res);
    player.sendMessage({
          response: Code.PLAYER.INIT,
          lobbyName: name,
          playerName: player.getName(),
          playerList: getPlayerList(),
          readyStates: getReadyList(),
      });
    eventCalls.player_sse_attached(this, player);
    return true;
  };

  this.broadcast = function(data) {
    for (let [key, val] of players) {
      val.sendMessage(data);
    }
  };
  
  //Notify all players of change
  let playersChanged = () => {
    this.broadcast({
      response: Code.BROADCAST.PLAYERS_UPDATED,
      playerList: getPlayerList()
    });
  }
  
  let getPlayerList = () => {
    return Array.from(players.values()).map((p) => {return p.getName()});
  }
  
  let getReadyList = () => {
    return Array.from(players.values()).map((p) => {return p.isReady()});
  }
  
  this.playerReadyState = function(playerId, state) {
    if (players.has(playerId)) {
      let player = players.get(playerId);
      player.setReady(state);
      player.sendMessage({
        response: Code.PLAYER.READY_STATE_RECEIVED
      });
      playerStateChanged();
      if (state) {
        checkReady();
      }
    }
  };
  
  let playerStateChanged = () => {
    this.broadcast({
      response: Code.BROADCAST.READY_STATE_UPDATED,
      readyStates: getReadyList()
    });
  }
  
  // Checks all player ready states, if all ready, start the game
  let checkReady = () => {
    if (players.size < 2) {
      //Not enough players to start a game, abort
      return;
    }
    for (let [key, val] of players) {
      if (!(val.isReady())) {
        return;
      }
    }
    this.broadcast({
      response: Code.BROADCAST.GAME_START,
    });
    started = true;
    eventCalls.game_start(this);
  };
  
  // Ends the game, returning it to lobby mode
  this.endGame = function() {
    started = false;
    this.foldPlayers((p) => {
      p.setReady(false);
    });
    playerStateChanged();
    this.broadcast({
      response: Code.BROADCAST.GAME_END,
    });
  }
  
  timer.start();  //Start the timeout timer
}

function Player(_name, lobby) {
  const TIMEOUT = 5;               // Duration in seconds until the player is removed if SSE response closes
  const name = _name;              // Display name of the player
  const id = generatePlayerId();   // PlayerId used to communicate
  let res = null;                  // The SSE response attached to the player
  let ready = false;               // Ready state of the player
  
  let ssed = false;  // If sse is attached
  let queue = [];    // Queue of missed SSE calls
  const timer = timeout.create(() => {
    lobby._removePlayer(id);
  }, TIMEOUT);
  
  this.extras = {};                // Extras to store game state data
  
  this.getName = function() {
    return name;
  }
  
  this.getId = function() {
    return id;
  }
  
  this.isReady = function() {
    return ready;
  }
  
  this.setReady = function(state) {
    ready = state;
  }
  
  this.attachRes = function(_res) {
    res = _res;
    res.on('close', detach);
    timer.stop();
    v("Player %s SSE attached! %s", id, Date.now());
    ssed = true;
    for (let i = 0; i < queue.length; i++) {
      //Send any queues messages
      this.sendMessage(queue[i]);
    }
    queue = [];
  }
  
  let detach = () => {
    v("Player %s SSE detached! %s", id, Date.now());
    timer.start();
    ssed = false;
  };
  
  this.sendMessage = function(data) {
    if (ssed) {
      if (res !== null) {
        res.write("data: " + JSON.stringify(data) + "\n\n");  // Send a data payload
      }
    } else {
      //Send it later
      queue.push(data);
    }
  };
  
  timer.start();
}

function sendCode(res, code, message) {
  res.status(200).send({
    response: code,
    message: message
  });
}

function writeCode(res, code, message) {
  res.write("data: " + JSON.stringify({
    response: code,
    message: message
  }) + "\n\n");
}

// Parse a url query, returning query vars in a dict
function parseQuery(url) {
  let query = url.split("?")[1];
  if (query === null || query.length === 0) {
    return null;
  }
  let vars = query.split("&");
  let dict = {};
  for (let i = 0; i < vars.length; i++) {
    let pair = vars[i].split("=");
    dict[pair[0]] = pair[1];
  }
  return dict;
}

function generateLobbyId() {
  return "L" + shortid.generate();
}

function generatePlayerId() {
  return "P" + shortid.generate();
}