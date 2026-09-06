// Client-side only — no backend cost. Replaces AWS Polly / Lex / Transcribe.

export function speakPhrase(text, { voiceIndex = 0 } = {}) {
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  if (voices[voiceIndex]) utterance.voice = voices[voiceIndex];
  speechSynthesis.speak(utterance);
}

export function listenForCommand(onCommand) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('SpeechRecognition not supported in this browser');
    return () => {};
  }
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.onresult = (event) => {
    const said = event.results[event.results.length - 1][0].transcript.toLowerCase();
    onCommand(said);
  };
  recognition.start();
  return () => recognition.stop();
}
