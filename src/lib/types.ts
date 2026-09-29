export type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";

export interface FailedAttempt {
  action: string;
  why_it_failed: string;
}

export interface Incident {
  incident_id: string;
  title: string;
  service: string;
  severity: Severity;
  symptoms: string;
  error_message: string;
  root_cause: string;
  investigation_steps: string[];
  failed_attempts: FailedAttempt[];
  resolution: string;
  lessons_learned: string;
  timestamp: string; // ISO
}

/** What the engineer types in for a brand new, unresolved incident. */
export interface NewIncident {
  title: string;
  service: string;
  error_message: string;
  symptoms: string;
  severity: Severity;
}

/** A record as it lives in the long-term memory bank. */
export interface MemoryRecord extends Incident {
  /** Where the knowledge came from - matters for how much to trust it. */
  source: "seed" | "engineer_saved" | "engineer_correction";
  /** Set when an engineer explicitly confirmed/corrected the record. */
  verified_at: string | null;
  corrections: string[];
}

export type ConfidenceLabel = "High Confidence" | "Medium Confidence" | "Low Confidence";
export type FreshnessLabel = "Fresh" | "Aging" | "Stale";

export interface RecalledMemory {
  record: MemoryRecord;
  /** 0-1 lexical overlap between the new incident and this memory. */
  similarity: number;
  matchedTerms: string[];
  confidence: ConfidenceLabel;
  confidenceBasis: string;
  freshness: FreshnessLabel;
  ageDays: number;
}

export interface Investigation {
  summary: string;
  likely_root_cause: string;
  why_this_could_be_happening: string[];
  investigation_steps: string[];
  recommended_actions: string[];
  risk_impact: string;
  collect_next: string[];
  memory_influence: string;
  used_memory: boolean;
  mode: "llm" | "fallback";
  note?: string;
}
