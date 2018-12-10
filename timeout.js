// Create and return a new timeout timer with the given timeout duration, and callback, starting the timer as well
exports.create = function(_callback, _duration) {
  return new TimeoutTimer(_callback, _duration);
}

function TimeoutTimer(_callback, _duration) {
  const callback = _callback;  //Callback function to execute when timer finishes
  const duration = _duration;  //Duration in seconds, NOT MILLISECONDS!!!
  let timeout = null;
  
  this.start = function() {
    //Starts a timer
    this.stop();  // Stop to avoid 2 calls to start creating multiple timers
    timeout = setTimeout(callback, duration * 1000);
  };
  
  this.stop = function() {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
}