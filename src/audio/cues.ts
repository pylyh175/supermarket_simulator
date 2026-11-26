// Synthesized store sounds. No audio files, no dependencies — everything is
// built from WebAudio oscillators and a shared noise buffer.
//
// All functions are best-effort: browsers without WebAudio (or a context
// blocked by autoplay policy) simply get silence — never an exception, never
// a broken till. `primeAudio()` should be called from a user gesture; the cue
// functions also resume a suspended context opportunistically. Everything
// routes through one master gain driven by the volume setting.

type AudioContextCtor = new () => AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let masterVolume = 0.7;
let ambienceStarted = false;

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
    master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

function out(): AudioNode | null {
  return master;
}

/** Create/resume the shared AudioContext. Safe to call repeatedly. */
export function primeAudio(): void {
  const context = ensureContext();
  if (!context) return;
  if (context.state === "suspended") {
    void context.resume().catch(() => {});
  }
}

/** Master volume 0–1 (settings). */
export function setMasterVolume(volume: number): void {
  masterVolume = Math.max(0, Math.min(1, volume));
  if (master && ctx) master.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05);
}

function ready(): AudioContext | null {
  const context = ensureContext();
  if (!context || !out()) return null;
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

interface ToneOptions {
  fromHz: number;
  toHz?: number;
  durationS: number;
  peakGain: number;
  type?: OscillatorType;
  delayS?: number;
  attackS?: number;
}

function playTone(options: ToneOptions): void {
  const context = ready();
  if (!context) return;
  try {
    const now = context.currentTime + (options.delayS ?? 0);
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = options.type ?? "sine";
    osc.frequency.setValueAtTime(options.fromHz, now);
    if (options.toHz !== undefined && options.toHz !== options.fromHz) {
      osc.frequency.exponentialRampToValueAtTime(options.toHz, now + options.durationS);
    }
    // Tiny attack/release avoids clicks; peak gain stays low (cozy).
    const peak = Math.max(0.0001, options.peakGain);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + (options.attackS ?? 0.01));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.durationS);
    osc.connect(gain);
    gain.connect(out()!);
    osc.start(now);
    osc.stop(now + options.durationS + 0.02);
  } catch {
    // Audio is decoration; never let it break the till.
  }
}

function noise(context: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = context.sampleRate * 2;
  noiseBuffer = context.createBuffer(1, length, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

interface NoiseOptions {
  durationS: number;
  peakGain: number;
  filter: BiquadFilterType;
  hz: number;
  q?: number;
  delayS?: number;
  sweepToHz?: number;
}

function playNoise(options: NoiseOptions): void {
  const context = ready();
  if (!context) return;
  try {
    const now = context.currentTime + (options.delayS ?? 0);
    const src = context.createBufferSource();
    src.buffer = noise(context);
    const filter = context.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.hz, now);
    if (options.sweepToHz) filter.frequency.exponentialRampToValueAtTime(options.sweepToHz, now + options.durationS);
    filter.Q.value = options.q ?? 1;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(options.peakGain, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.durationS);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out()!);
    src.start(now, Math.random());
    src.stop(now + options.durationS + 0.02);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

/** Customer places a pack on the belt: soft rising "plip". */
export function playPlip(): void {
  playTone({ fromHz: 500, toHz: 700, durationS: 0.08, peakGain: 0.05 });
}

/** Scanner beep: short, warm 900 Hz. */
export function playBeep(): void {
  playTone({ fromHz: 900, durationS: 0.12, peakGain: 0.06, type: "square" });
}

/** POS key press. */
export function playKey(): void {
  playTone({ fromHz: 1600, toHz: 1200, durationS: 0.03, peakGain: 0.025, type: "triangle" });
}

/** The classic shop-door sensor "ding… dong". */
export function playDoorChime(): void {
  playTone({ fromHz: 784, durationS: 0.9, peakGain: 0.05, attackS: 0.005 });
  playTone({ fromHz: 622, durationS: 1.2, peakGain: 0.045, attackS: 0.005, delayS: 0.45 });
}

/** Cash drawer springs open: latch click, slide, thunk. */
export function playDrawerOpen(): void {
  playTone({ fromHz: 2400, durationS: 0.03, peakGain: 0.03, type: "square" });
  playNoise({ durationS: 0.22, peakGain: 0.05, filter: "bandpass", hz: 900, q: 0.8, delayS: 0.02, sweepToHz: 500 });
  playTone({ fromHz: 140, toHz: 80, durationS: 0.12, peakGain: 0.09, delayS: 0.2 });
}

export function playDrawerClose(): void {
  playNoise({ durationS: 0.15, peakGain: 0.04, filter: "bandpass", hz: 600, q: 0.8 });
  playTone({ fromHz: 160, toHz: 90, durationS: 0.1, peakGain: 0.1, delayS: 0.12 });
}

/** A coin onto the change tray. */
export function playCoin(): void {
  const base = 2600 + Math.random() * 500;
  playTone({ fromHz: base, durationS: 0.18, peakGain: 0.03, attackS: 0.002 });
  playTone({ fromHz: base * 1.34, durationS: 0.12, peakGain: 0.02, attackS: 0.002, delayS: 0.03 });
}

/** A note onto the change tray: paper rustle. */
export function playNote(): void {
  playNoise({ durationS: 0.14, peakGain: 0.035, filter: "highpass", hz: 2500, q: 0.5 });
}

/** Thermal receipt printer buzz. */
export function playPrinter(): void {
  for (let i = 0; i < 10; i += 1) {
    playTone({ fromHz: 310, durationS: 0.045, peakGain: 0.018, type: "square", delayS: i * 0.07 });
  }
}

/** DuitNow / e-wallet "payment received" chime. */
export function playQrSuccess(): void {
  playTone({ fromHz: 988, durationS: 0.16, peakGain: 0.045 });
  playTone({ fromHz: 1319, durationS: 0.3, peakGain: 0.045, delayS: 0.14 });
}

/** Card terminal "approved" double beep. */
export function playCardApproved(): void {
  playTone({ fromHz: 1250, durationS: 0.09, peakGain: 0.04, type: "square" });
  playTone({ fromHz: 1250, durationS: 0.09, peakGain: 0.04, type: "square", delayS: 0.14 });
}

/** Gentle "not quite" tone (wrong key, short change). */
export function playError(): void {
  playTone({ fromHz: 330, toHz: 250, durationS: 0.22, peakGain: 0.04, type: "triangle" });
}

/** Happy little chime for a perfect sale. */
export function playSuccess(): void {
  playTone({ fromHz: 784, durationS: 0.12, peakGain: 0.035 });
  playTone({ fromHz: 1047, durationS: 0.2, peakGain: 0.035, delayS: 0.1 });
}

/**
 * Quiet store bed: low air-con rumble + a faint chiller hum. Starts once,
 * after the first user gesture (autoplay policy).
 */
export function startAmbience(): void {
  if (ambienceStarted) return;
  const context = ready();
  if (!context) return;
  try {
    ambienceStarted = true;
    const src = context.createBufferSource();
    src.buffer = noise(context);
    src.loop = true;
    const low = context.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 320;
    const bedGain = context.createGain();
    bedGain.gain.value = 0.035;
    src.connect(low);
    low.connect(bedGain);
    bedGain.connect(out()!);
    src.start();

    const hum = context.createOscillator();
    hum.frequency.value = 100;
    const humGain = context.createGain();
    humGain.gain.value = 0.004;
    hum.connect(humGain);
    humGain.connect(out()!);
    hum.start();
  } catch {
    ambienceStarted = false;
  }
}
