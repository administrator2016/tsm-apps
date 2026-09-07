// Client-side only — no backend cost. Replaces AWS Polly / Lex / Transcribe.

export function speakPhrase(text, { voiceIndex = 0 } = {}) {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];
  speechSynthesis.speak(utterance);
}

export function voiceSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Opt-in, host-triggered, browser-only speech recognition — replaces the
// AWS Lex idea with zero API key and zero new service. Restarts itself on
// `end` (mobile Chrome/Safari auto-stop after a few seconds of silence) so
// "always listening while the toggle is on" actually holds; onerror also
// retries rather than dying silently, except for 'not-allowed' (mic denied)
// where retrying would just spam the permission prompt.
export function listenForCommand(onCommand) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('SpeechRecognition not supported in this browser');
    return () => {};
  }

  let stopped = false;
  let recognition = null;

  function start() {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const said = event.results[event.results.length - 1][0].transcript.toLowerCase();
      onCommand(said);
    };
    recognition.onend = () => {
      if (!stopped) start();
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        stopped = true;
      }
    };
    recognition.start();
  }

  start();
  return () => {
    stopped = true;
    recognition?.stop();
  };
}

// Matches a heard phrase against a set of trigger words/phrases, tolerant
// of the small amount of noise speech recognition tends to add around the
// actual command (e.g. "ok next player please").
export function matchesCommand(said, triggers) {
  return triggers.some((trigger) => said.includes(trigger));
}
