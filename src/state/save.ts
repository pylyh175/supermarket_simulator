/**
 * Persistent save state. Pure logic with an injectable Storage so tests can
 * stub it; defaults to localStorage in the browser. All money is integer
 * sen — never floats, never strings.
 *
 * Save format is `{ version: 2, moneySen: number, day: number }` under the
 * key `supermarket-sim-save`. A version-1 save (`{ version: 1, moneySen }`)
 * loads as day 1. Anything unexpected — missing key, unparseable JSON,
 * unknown version, bad fields — loads as `null`, so a corrupt save can never
 * stop the game from booting.
 */

export const SAVE_KEY = "supermarket-sim-save";

export interface SaveData {
  version: 2;
  /** Lifetime takings across every shift. */
  moneySen: number;
  /** The shift day the player is on (1-based). */
  day: number;
}

/** localStorage may be missing or throw on access (privacy mode) — never let it escape. */
function defaultStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function saveGame(data: SaveData, storage?: Storage): void {
  const store = storage ?? defaultStorage();
  if (!store) {
    return;
  }
  store.setItem(SAVE_KEY, JSON.stringify({ version: 2, moneySen: data.moneySen, day: data.day }));
}

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);

/** Returns the saved data, or null for missing/corrupt/unknown saves. Never throws. */
export function loadGame(storage?: Storage): SaveData | null {
  try {
    const store = storage ?? defaultStorage();
    if (!store) {
      return null;
    }
    const raw = store.getItem(SAVE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (!isInt(candidate.moneySen)) {
      return null;
    }
    if (candidate.version === 1) {
      return { version: 2, moneySen: candidate.moneySen, day: 1 };
    }
    if (candidate.version !== 2 || !isInt(candidate.day) || candidate.day < 1) {
      return null;
    }
    return { version: 2, moneySen: candidate.moneySen, day: candidate.day };
  } catch {
    return null;
  }
}
