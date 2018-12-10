// server.js
// where your node app starts

// init project
const express = require('express');
const bodyParser = require('body-parser');
const shortid = require('shortid');
const app = express();

// Custom modules
const lobbies = require('./lobbies.js');
// lobbies.verbose = true;
const jisho = require('./jisho.js');
jisho.verbose = true;
const kanas = require('./kana.js');

app.get('/', (req, res) => {
  const url = `https://${req.hostname}/shiritori`;
  res.setHeader('Content-Type', 'text/html');
  
  return res.send(`<pre>The server is running :)<br>${url}</pre>`);
});

app.use('/shiritori', bodyParser.json());
app.use('/shiritori', lobbies.expressMiddleware());
app.use('/sse', lobbies.expressSSEMiddleware());

const ShiriCode = {
  YOUR_TURN:    9,
  PLAYER_TURN: 10,
  PLAYER_LOST: 11,
  MOVE_MADE:   12,
  FEEDBACK:    13,
  WINNER:      14,
};

lobbies.on('player_leave', (lobby, player) => {
  console.log("Player %s left", player.getName());
  if (lobby.isStarted()) {
    // Remove the player from the turn rotation
    for (let i = 0; i < lobby.extras.turns.length; i++) {
      if (lobby.extras.turns[i].getName() === player.getName()) {
        console.log("Removing player from turn rotation");
        lobby.extras.turns.splice(i, 1);
        checkEnded(lobby);
        break;
      }
    }
  }
});

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

lobbies.on('game_start', (lobby) => {
  console.log("Starting game with %d players", lobby.playerCount());
  // Initialize
  lobby.extras.turns = [];
  lobby.extras.seenWords = new Set();
  lobby.extras.lastWord = null;
  lobby.foldPlayers((player)=>{
    lobby.extras.turns.push(player);
  });
  
  
  lobby.extras.current = getRandomInt(lobby.extras.turns.length);
  //signal the first player
  lobby.extras.turns[lobby.extras.current].sendMessage({
    response: ShiriCode.YOUR_TURN,
    lastWord: null
  });
  lobby.broadcast({
    response: ShiriCode.PLAYER_TURN,
    player: lobby.extras.turns[lobby.extras.current].getName(),
  });
});

lobbies.on('player_msg', (lobby, player, msg) => {
  if (msg.subtype === "word") {
    if (lobby.extras.turns[lobby.extras.current] === player) {
      //Check word
      let word = msg.word;
      console.log("Player %s submitted word: %s", player.getName(), word);
      validWord(lobby, word, (isValid, feedback) => {
        if (isValid) {
          lobby.extras.seenWords.add(word);
          lobby.broadcast({
            response: ShiriCode.MOVE_MADE,
            player: player.getName(),
            word: word,
          });
          lobby.extras.lastWord = word,
          lobby.extras.current = (lobby.extras.current + 1) % lobby.extras.turns.length;
          // Signal next player
          lobby.extras.turns[lobby.extras.current].sendMessage({
            response: ShiriCode.YOUR_TURN,
            lastWord: word,
          });
          lobby.broadcast({
            response: ShiriCode.PLAYER_TURN,
            player: lobby.extras.turns[lobby.extras.current].getName(),
          });
        } else {
          lobby.broadcast({
            response: ShiriCode.PLAYER_LOST,
            player: player.getName(),
          });
          player.sendMessage({
            response: ShiriCode.FEEDBACK,
            feedback: feedback,
          });
          // Remove the losing player
          lobby.extras.turns.splice(lobby.extras.current, 1);
          if (lobby.extras.turns.length === 1) {
            //end game
            checkEnded(lobby);
          } else {
            //next player
            lobby.extras.current %= lobby.extras.turns.length;
            lobby.extras.turns[lobby.extras.current].sendMessage({
              response: ShiriCode.YOUR_TURN,
              lastWord: lobby.extras.lastWord
            });
            lobby.broadcast({
              response: ShiriCode.PLAYER_TURN,
              player: lobby.extras.turns[lobby.extras.current].getName(),
            });
          }
        }
      });
    }
  }
});

function validWord(lobby, word, callback) {
  if (lobby.extras.lastWord !== null) {
    let shiri = lobby.extras.lastWord.charAt(lobby.extras.lastWord.length - 1);
    if (kanas.isSmall(shiri)) {
      //match last, or second last kana
      shiri = kanas.toBigKana(shiri);
      let preShiri = lobby.extras.lastWord.charAt(lobby.extras.lastWord.length - 2);
      if (word.charAt(0) !== shiri && word.charAt(0) !== preShiri) {
        callback(false, "Word does not start with " + shiri + " or " + preShiri);
        return;
      }
    } else {
      if (word.charAt(0) !== shiri) {
        callback(false, "Word does not start with " + shiri);
        return;
      }
    }
  }
  if (word.endsWith("ん")) {
    callback(false, "Word ends with 'ん'");
  } else if (lobby.extras.seenWords.has(word)) {
    callback(false, "Word was played earlier!");
  } else {
    jisho.searchNoun(word, (isValid) => {
      callback(isValid, isValid ? "Word is valid!" : "Word is not a noun!");
    });
  }
}

function checkEnded(lobby) {
  //if one player left, end
  if (lobby.extras.turns.length === 1) {
    // Ended
    lobby.endGame();
    lobby.broadcast({
      response: ShiriCode.WINNER,
      winner: lobby.extras.turns[0].getName(),
    });
  }
}

// Start the express application
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`server listening on port ${port}`);
});