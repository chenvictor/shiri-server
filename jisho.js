// Jisho api hook

const wanakana = require('wanakana');
const request = require('request');

exports.verbose = false;
function v(msg, ...args) {
  if (exports.verbose) {
    console.log(msg, args);
  }
}

const JISHO = "https://jisho.org/api/v1/search/words?keyword=";
exports.searchNoun = function(word, callback) {
  let formatted = formatUrl(word);
  v("JISHO Api call: %s", formatted);
  request(formatted, { json: true }, (err, res, body) => {
    if (err) {
      return console.log(err);
    }
    callback(processResult(body, word));
  });
};

function processResult(result, original) {
  let data = result.data;
  for (let i = 0; i < data.length; i++) {
    let word = data[i];
    let reading = word.japanese[0].reading;
    if (wanakana.toHiragana(reading) !== original) {
      continue;
    }
    let senses = word.senses;
    for (let j = 0; j < senses.length; j++) {
      let pos = senses[j].parts_of_speech;
      for (let k = 0; k < pos.length; k++) {
        if (pos[k].toLowerCase().includes("noun")) {
          //some form of noun
          v("word matched type: %s", pos[k]);
          return true;
        }
      }
    }
  }
  return false;
}

/*
 * Return formatted URL to request from
 */
function formatUrl(word) {
  return encodeURI(JISHO + word);
}