const SMALL_KANAS = new Set(["ょ", "ゃ", "ゅ"]);
    let toBigKana = (smol) => {
        
    };
exports.isSmall = function(kana) {
  return SMALL_KANAS.has(kana);
}

exports.toBigKana = function(kana) {
  switch(kana) {
      case "ょ":
          return "よ";
      case "ゃ":
          return "や";
      case "ゅ":
          return "ゆ";
      default:
          console.warn("%s is not a small kana!", kana);
          return kana;
  }
}
