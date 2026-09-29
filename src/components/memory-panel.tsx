import type { RecalledMemory } from "@/lib/types";

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "memory" | "warning" | "success" | "destructive";
}) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-muted-foreground border-border",
    memory: "bg-memory/15 text-memory border-memory/40",
    warning: "bg-warning/15 text-warning border-warning/40",
    success: "bg-success/15 text-success border-success/40",
    destructive: "bg-destructive/15 text-destructive border-destructive/40",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.65rem] tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function confidenceTone(label: string) {
  if (label.startsWith("High")) return "success" as const;
  if (label.startsWith("Medium")) return "warning" as const;
  return "muted" as const;
}

export function MemoryPanel({
  memories,
  conflicts,
  hasRun,
}: {
  memories: RecalledMemory[];
  conflicts: string[];
  hasRun: boolean;
}) {
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">🧠 Memory recall</h2>
        <Chip tone={memories.length ? "memory" : "muted"}>
          Memories retrieved: {memories.length}
        </Chip>
      </div>

      {!hasRun && (
        <p className="mt-3 text-sm text-muted-foreground">
          Run an investigation to query the incident memory bank.
        </p>
      )}

      {hasRun && memories.length === 0 && (
        <p className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <span className="font-mono text-xs tracking-wide uppercase">Before memory:</span>{" "}
          No relevant incident memory. This investigation runs on current evidence only.
        </p>
      )}

      {conflicts.length > 0 && (
        <div className="mt-4 rounded-md border border-warning/50 bg-warning/10 p-3">
          <p className="text-sm font-semibold text-warning">⚠️ Conflicting historical memories</p>
          <ul className="mt-2 space-y-1 text-sm text-foreground/90">
            {conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            The agent will not merge these. Additional current evidence is required.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {memories.map((m) => (
          <details key={m.record.incident_id} className="group rounded-md border border-border bg-card" open>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-sm">
              <span className="font-mono text-xs text-memory">{m.record.incident_id}</span>
              <span className="font-medium">{m.record.title}</span>
              <span className="ml-auto flex flex-wrap gap-1.5">
                <Chip tone={confidenceTone(m.confidence)}>{m.confidence}</Chip>
                <Chip tone={m.freshness === "Fresh" ? "success" : m.freshness === "Aging" ? "warning" : "muted"}>
                  {m.freshness} · {m.ageDays}d
                </Chip>
              </span>
            </summary>

            <div className="space-y-3 border-t border-border p-3 text-sm">
              <div>
                <p className="label-caps">Service</p>
                <p className="font-mono text-xs">{m.record.service}</p>
              </div>
              <div>
                <p className="label-caps">Previous root cause</p>
                <p>{m.record.root_cause}</p>
              </div>
              <div>
                <p className="label-caps">Previous resolution (worked)</p>
                <p className="text-success">{m.record.resolution}</p>
              </div>
              <div>
                <p className="label-caps">Failed previous attempts</p>
                {m.record.failed_attempts.length === 0 ? (
                  <p className="text-muted-foreground">None recorded.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {m.record.failed_attempts.map((f) => (
                      <li key={f.action} className="rounded border border-destructive/30 bg-destructive/10 p-2">
                        <span className="font-medium text-destructive">✗ {f.action}</span>
                        <span className="block text-foreground/85">{f.why_it_failed}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {m.record.corrections.length > 0 && (
                <div>
                  <p className="label-caps">Engineer corrections</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {m.record.corrections.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="label-caps">Why it is relevant</p>
                <p className="text-muted-foreground">
                  {Math.round(m.similarity * 100)}% term overlap
                  {m.matchedTerms.length > 0 && <>: {m.matchedTerms.slice(0, 8).join(", ")}</>}
                </p>
              </div>
              <div>
                <p className="label-caps">Memory basis</p>
                <p className="text-xs text-muted-foreground">{m.confidenceBasis}</p>
                <p className="text-xs text-muted-foreground">
                  Stored as: {m.record.source.replace("_", " ")}
                  {m.record.verified_at ? " · engineer verified" : " · not verified"}
                </p>
              </div>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
