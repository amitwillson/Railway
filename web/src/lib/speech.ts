/**
 * Voice-to-text for the observation field, using the browser's Web Speech API.
 * Availability is feature-detected: the microphone button hides where the API
 * is missing rather than offering something that cannot work.
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => ctor() !== null;

export interface Dictation {
  stop: () => void;
}

/**
 * Starts dictation. `onText` receives the transcript so far (interim results
 * included) so the inspector sees the words appear as they speak.
 */
export function dictate(
  onText: (text: string, isFinal: boolean) => void,
  onEnd: (error?: string) => void,
  lang = 'en-IN'
): Dictation | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let text = '';
    let isFinal = false;
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      text += result?.[0]?.transcript ?? '';
      if (result?.isFinal) isFinal = true;
    }
    onText(text.trim(), isFinal);
  };
  recognition.onerror = (event) => onEnd(event.error);
  recognition.onend = () => onEnd();

  try {
    recognition.start();
  } catch {
    return null;
  }
  return { stop: () => recognition.stop() };
}
