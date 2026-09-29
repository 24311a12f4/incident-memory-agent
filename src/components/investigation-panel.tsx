import type { Investigation } from "@/lib/types";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-caps">{title}</p>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-muted-foreground">—</p>;
  return (
    <ol className="space-y-1.5">
      {items.map((item, i) => (
        <li key={item} className="flex gap-2">
          <span className="font-mono text-xs text-primary">{String(i + 1).padStart(2, "0")}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function InvestigationPanel({
  investigation,
  loading,
}: {
  investigation: Investigation | null;
  loading: boolean;
}) {
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">AI investigation</h2>
        {investigation && (
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[0.65rem] tracking-wide uppercase ${
              investigation.used_memory
                ? "border-memory/40 bg-memory/15 text-memory"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            {investigation.used_memory ? "Influenced by previous incident memory" : "No memory used"}
          </span>
        )}
      </div>

      {loading && (
        <p className="mt-4 animate-pulse text-sm text-muted-foreground">
          Recalling memories and reasoning about the incident…
        </p>
      )}

      {!loading && !investigation && (
        <p className="mt-3 text-sm text-muted-foreground">
          Fill in the incident above and run an investigation.
        </p>
      )}

      {!loading && investigation && (
        <div className="mt-4 space-y-4">
          {investigation.mode === "fallback" && (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              Demo mode: {investigation.note}
            </p>
          )}
          <Block title="Incident summary">{investigation.summary}</Block>
          <Block title="Likely root cause (current incident)">
            <p className="rounded-md border border-primary/30 bg-primary/10 p-3">
              {investigation.likely_root_cause}
            </p>
          </Block>
          <Block title="Why this could be happening">
            <List items={investigation.why_this_could_be_happening} />
          </Block>
          <Block title="Investigation steps">
            <List items={investigation.investigation_steps} />
          </Block>
          <Block title="Recommended actions">
            <List items={investigation.recommended_actions} />
          </Block>
          <Block title="Risk / impact">{investigation.risk_impact}</Block>
          <Block title="Collect this next">
            <List items={investigation.collect_next} />
          </Block>
          <Block title="How memory influenced this">
            <p className="text-muted-foreground">{investigation.memory_influence}</p>
          </Block>
        </div>
      )}
    </section>
  );
}
