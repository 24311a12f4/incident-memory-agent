import type {
  ConfidenceLabel,
  FreshnessLabel,
  Incident,
  MemoryRecord,
  NewIncident,
  RecalledMemory,
} from "./types";

/**
 * Long-term memory interface.
 *
 * This is the seam where Hindsight plugs in: `retain` / `recall` map 1:1 onto
 * the Hindsight memory-bank operations. Until Hindsight credentials are
 * available the app runs on `LocalMemoryBank`, which is clearly labelled in the
 * UI as a local fallback so nothing is presented as a real Hindsight result.
 */
export interface MemoryBank {
  readonly name: string;
  readonly backend: "hindsight" | "local-fallback";
  retain(record: MemoryRecord): Promise<void>;
  recall(incident: NewIncident, limit?: number): Promise<RecalledMemory[]>;
  all(): Promise<MemoryRecord[]>;
  clear(): Promise<void>;
}

const STORAGE_KEY = "eima.memory-bank.v1";

const STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","in","on","for","with","is","are","was","were","at","by",
  "from","that","this","it","as","be","been","after","during","not","no","but","our","their",
  "error","errors","service","services","issue","issues","problem","problems","failed","failure",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function recordText(r: MemoryRecord): string {
  return [
    r.title,
    r.service,
    r.symptoms,
    r.error_message,
    r.root_cause,
    r.resolution,
    r.lessons_learned,
    ...r.investigation_steps,
    ...r.failed_attempts.map((f) => `${f.action} ${f.why_it_failed}`),
    ...r.corrections,
  ].join(" ");
}

export function incidentQueryText(incident: NewIncident): string {
  return [incident.title, incident.service, incident.symptoms, incident.error_message].join(" ");
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

function freshnessFor(ageDays: number): FreshnessLabel {
  if (ageDays <= 60) return "Fresh";
  if (ageDays <= 180) return "Aging";
  return "Stale";
}

function confidenceFor(
  similarity: number,
  record: MemoryRecord,
  ageDays: number,
): { confidence: ConfidenceLabel; confidenceBasis: string } {
  const verified = Boolean(record.verified_at);
  const basis: string[] = [
    `${Math.round(similarity * 100)}% term overlap with the current incident`,
    verified ? "confirmed by an engineer" : "not confirmed by an engineer",
    `${ageDays} days old`,
  ];
  if (record.corrections.length > 0) basis.push(`${record.corrections.length} engineer correction(s)`);

  let confidence: ConfidenceLabel;
  if (similarity >= 0.3 && verified && ageDays <= 180) confidence = "High Confidence";
  else if (similarity >= 0.15 || verified) confidence = "Medium Confidence";
  else confidence = "Low Confidence";

  return { confidence, confidenceBasis: basis.join(" · ") };
}

function score(incident: NewIncident, record: MemoryRecord) {
  const queryTerms = Array.from(new Set(tokenize(incidentQueryText(incident))));
  const recordTerms = new Set(tokenize(recordText(record)));
  const matchedTerms = queryTerms.filter((t) => recordTerms.has(t));
  let similarity = queryTerms.length ? matchedTerms.length / queryTerms.length : 0;
  if (record.service.toLowerCase() === incident.service.trim().toLowerCase() && incident.service.trim()) {
    similarity = Math.min(1, similarity + 0.15);
  }
  return { similarity, matchedTerms };
}

function readStore(): MemoryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MemoryRecord[]) : [];
  } catch {
    return [];
  }
}

function writeStore(records: MemoryRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export class LocalMemoryBank implements MemoryBank {
  readonly name = "engineering-incidents";
  readonly backend = "local-fallback" as const;

  async retain(record: MemoryRecord): Promise<void> {
    const records = readStore().filter((r) => r.incident_id !== record.incident_id);
    records.unshift(record);
    writeStore(records);
  }

  async recall(incident: NewIncident, limit = 3): Promise<RecalledMemory[]> {
    const records = readStore();
    return records
      .map((record) => {
        const { similarity, matchedTerms } = score(incident, record);
        const ageDays = daysSince(record.timestamp);
        return {
          record,
          similarity,
          matchedTerms,
          ageDays,
          freshness: freshnessFor(ageDays),
          ...confidenceFor(similarity, record, ageDays),
        };
      })
      .filter((m) => m.similarity >= 0.08)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async all(): Promise<MemoryRecord[]> {
    return readStore();
  }

  async clear(): Promise<void> {
    writeStore([]);
  }
}

export const memoryBank: MemoryBank = new LocalMemoryBank();

export function toMemoryRecord(
  incident: Incident,
  source: MemoryRecord["source"],
  opts: { verified?: boolean; corrections?: string[] } = {},
): MemoryRecord {
  return {
    ...incident,
    source,
    verified_at: opts.verified ? new Date().toISOString() : null,
    corrections: opts.corrections ?? [],
  };
}

/**
 * Detects memories that disagree about the root cause for the same service so
 * the agent can surface the conflict instead of merging it away.
 */
export function detectContradictions(memories: RecalledMemory[]): string[] {
  const conflicts: string[] = [];
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i];
      const b = memories[j];
      if (!a || !b) continue;
      if (a.record.service !== b.record.service) continue;
      const at = new Set(tokenize(a.record.root_cause));
      const bt = new Set(tokenize(b.record.root_cause));
      const shared = [...at].filter((t) => bt.has(t));
      if (shared.length === 0) {
        conflicts.push(
          `${a.record.incident_id} and ${b.record.incident_id} (both ${a.record.service}) recorded different root causes: "${a.record.root_cause}" vs "${b.record.root_cause}".`,
        );
      }
    }
  }
  return conflicts;
}
