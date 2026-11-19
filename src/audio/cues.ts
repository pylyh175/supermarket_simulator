// Tiny synthesized checkout cues. No audio files, no dependencies, no
// persistent state beyond one lazily-created AudioContext.
//
// All functions are best-effort: browsers without WebAudio (or a context
// blocked by autoplay policy) simply get silence — never an exception, never
// a broken till. `primeAudio()` should be called from a user gesture (the
// till-open E press) so the context is allowed to start; the cue functions
// also resume a suspended context opportunistically.

type AudioContextCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let primed = false;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Create/resume the shared AudioContext. Safe to call repeatedly. */
export function primeAudio(): void {
  const context = ensureContext();
  if (!context) return;
  primed = true;
  if (context.state === "suspended") {
    void context.resume().catch(() => {});
  }
}

interface ToneOptions {
  fromHz: number;
  toHz?: number;
  durationS: number;
  peakGain: number;
  type?: OscillatorType;
}

function playTone(options: ToneOptions): void {
  // A cue before the first gesture cannot start audio anyway; priming here
  // keeps the context ready for the next one.
  if (!primed) primeAudio();

  const context = ensureContext();
  if (!context) return;
  if (context.state === "suspended") {
    void context.resume().catch(() => {});
  }

  try {
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = options.type ?? "sine";
    osc.frequency.setValueAtTime(options.fromHz, now);
    if (options.toHz !== undefined && options.toHz !== options.fromHz) {
      osc.frequency.exponentialRampToValueAtTime(
        options.toHz,
        now + options.durationS,
      );
    }

    // Tiny attack/release avoids clicks; peak gain stays low (cozy).
    const peak = Math.max(0.0001, options.peakGain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.durationS);

    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(now);
    osc.stop(now + options.durationS + 0.02);
  } catch {
    // Audio is decoration; never let it break the till.
  }
}

/** Customer places a pack on the belt: soft rising "plip". */
export function playPlip(): void {
  playTone({ fromHz: 500, toHz: 700, durationS: 0.08, peakGain: 0.05 });
}

/** Scanner beep: short, warm 900 Hz. */
export function playBeep(): void {
  playTone({ fromHz: 900, durationS: 0.12, peakGain: 0.06 });
}
