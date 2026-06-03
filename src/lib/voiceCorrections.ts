// Persistent word-level correction memory for the Voice Assistant.
// Stored per browser (localStorage). Applies "from → to" replacements
// automatically so the user doesn't have to fix the same word repeatedly.

const STORAGE_KEY = "voice_corrections_v1";

export interface CorrectionMap {
  [from: string]: string;
}

export function loadCorrections(): CorrectionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCorrections(map: CorrectionMap) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function rememberCorrection(from: string, to: string) {
  const f = from.trim();
  const t = to.trim();
  if (!f || !t || f.toLowerCase() === t.toLowerCase()) return;
  if (f.length > 40 || t.length > 40) return; // ignore long phrases
  const map = loadCorrections();
  map[f.toLowerCase()] = t;
  saveCorrections(map);
}

export function forgetCorrection(from: string) {
  const map = loadCorrections();
  delete map[from.toLowerCase()];
  saveCorrections(map);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$1");

/** Apply learned word-level corrections (case-insensitive, whole word). */
export function applyCorrections(text: string, map?: CorrectionMap): string {
  if (!text) return text;
  const dict = map || loadCorrections();
  const keys = Object.keys(dict);
  if (!keys.length) return text;
  let out = text;
  for (const from of keys) {
    const to = dict[from];
    const re = new RegExp(`\\b${escape(from)}\\b`, "gi");
    out = out.replace(re, to);
  }
  return out;
}

/**
 * Diff two short strings token-by-token and learn 1-to-1 substitutions.
 * Returns the number of new mappings learned. Conservative: only learns when
 * the texts have the same token count and a small number of differences.
 */
export function learnFromEdit(before: string, after: string): number {
  if (!before || !after || before === after) return 0;
  const a = before.trim().split(/\s+/);
  const b = after.trim().split(/\s+/);
  if (a.length !== b.length) return 0;
  let diffs = 0;
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) {
      diffs++;
      pairs.push([a[i], b[i]]);
    }
  }
  // Only learn when a handful of words changed (otherwise it's a rewrite).
  if (diffs === 0 || diffs > 3) return 0;
  pairs.forEach(([from, to]) => rememberCorrection(from, to));
  return pairs.length;
}
