/**
 * Persistent save state. Pure logic with an injectable Storage so tests can
 * stub it; defaults to localStorage in the browser. All money is integer
 * sen — never floats, never strings.
 *
 * Save format is exactly `{ version: 1, moneySen: number }` under the key
 * `supermarket-sim-save`. Anything unexpected — missing key, unparseable
 * JSON, unknown/missing version — loads as `null`, so a corrupt save can
 * never stop the game from booting.
 */

export const SAVE_KEY = "supermarket-sim-save";

export interface SaveData {
  version: 1;
  moneySen: number;
}

/** localStorage may be missing or throw on access (privacy mode) — never let it escape. */
function defaultStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Always writes `version: 1`, regardless of the version on `data`. */
export function saveGame(data: SaveData, storage?: Storage): void {
  const store = storage ?? defaultStorage();
  if (!store) {
    return;
  }
  store.setItem(SAVE_KEY, JSON.stringify({ version: 1, moneySen: data.moneySen }));
}

/** Returns the saved data, or null for missing/corrupt/wrong-version saves. Never throws. */
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
    if (candidate.version !== 1) {
      return null;
    }
    if (typeof candidate.moneySen !== "number" || !Number.isFinite(candidate.moneySen) || !Number.isInteger(candidate.moneySen)) {
      return null;
    }
    return { version: 1, moneySen: candidate.moneySen };
  } catch {
    return null;
  }
}
