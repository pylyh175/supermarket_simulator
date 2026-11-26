/**
 * Player settings, persisted separately from the save under
 * `supermarket-sim-settings`. Every field is validated on load and falls back
 * to its default on its own, so one junk value never wipes the rest.
 */

export const SETTINGS_KEY = "supermarket-sim-settings";

export interface Settings {
  /** Mouse-look multiplier (0.3–2). */
  sensitivity: number;
  /** Master volume (0–1). */
  volume: number;
  /** Show the suggested change breakdown on the till screen. */
  changeHint: boolean;
  /** Real minutes one 9am–10pm shift takes. */
  shiftMinutes: 8 | 12 | 20;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  volume: 0.7,
  changeHint: false,
  shiftMinutes: 12,
};

const SHIFT_CHOICES = [8, 12, 20] as const;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function normalise(raw: Record<string, unknown>): Settings {
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sensitivity = num(raw.sensitivity);
  const volume = num(raw.volume);
  const shift = SHIFT_CHOICES.find((c) => c === raw.shiftMinutes);
  return {
    sensitivity: sensitivity === null ? DEFAULT_SETTINGS.sensitivity : clamp(sensitivity, 0.3, 2),
    volume: volume === null ? DEFAULT_SETTINGS.volume : clamp(volume, 0, 1),
    changeHint: typeof raw.changeHint === "boolean" ? raw.changeHint : DEFAULT_SETTINGS.changeHint,
    shiftMinutes: shift ?? DEFAULT_SETTINGS.shiftMinutes,
  };
}

function defaultStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettings(storage?: Storage): Settings {
  try {
    const raw = (storage ?? defaultStorage())?.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };
    return normalise(parsed as Record<string, unknown>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage?: Storage): void {
  try {
    (storage ?? defaultStorage())?.setItem(SETTINGS_KEY, JSON.stringify(normalise({ ...settings })));
  } catch {
    // Storage blocked — settings still apply for this session.
  }
}
