import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { demoIncidents } from "@/data/incidents";
import { detectContradictions, memoryBank, toMemoryRecord } from "@/lib/memory";
import { investigateIncident } from "@/lib/investigate.functions";
import type { Investigation, NewIncident, RecalledMemory, Severity } from "@/lib/types";
import { MemoryPanel } from "@/components/memory-panel";
import { InvestigationPanel } from "@/components/investigation-panel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Engineering Incident Memory Agent" },
      {
        name: "description",
        content:
          "An AI incident investigator that remembers previous production incidents — including what worked, what failed, and what engineers corrected.",
      },
      { property: "og:title", content: "Engineering Incident Memory Agent" },
      {
        property: "og:description",
        content:
          "Investigate production incidents with an AI agent backed by long-term memory of past incidents, failed fixes and engineer corrections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const SEVERITIES: Severity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];

const EMPTY: NewIncident = {
  title: "",
  service: "",
  error_message: "",
  symptoms: "",
  severity: "SEV2",
};

const DEMO_INCIDENT_1 = demoIncidents.find((i) => i.incident_id === "INC-1042")!;

const DEMO_INCIDENT_2: NewIncident = {
  title: "Payment API experiencing intermittent failures",
  service: "payments-api",
  error_message: "OperationalError: could not connect to server: connection timed out (pool checkout 30s)",
  symptoms:
    "Payment requests are failing again with database timeout and connection errors. Error rate rising during peak traffic.",
  severity: "SEV1",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-caps">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-1 focus:ring-ring";

function Home() {
  const runInvestigation = useServerFn(investigateIncident);

  const [incident, setIncident] = useState<NewIncident>(EMPTY);
  const [memories, setMemories] = useState<RecalledMemory[]>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [memoryCount, setMemoryCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  // Resolution / correction capture
  const [rootCause, setRootCause] = useState("");
  const [resolution, setResolution] = useState("");
  const [failedAction, setFailedAction] = useState("");
  const [failedWhy, setFailedWhy] = useState("");
  const [lessons, setLessons] = useState("");
  const [correction, setCorrection] = useState("");

  const refreshCount = useCallback(async () => {
    setMemoryCount((await memoryBank.all()).length);
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const investigate = useCallback(
    async (target: NewIncident) => {
      setLoading(true);
      setStatus(null);
      try {
        const recalled = await memoryBank.recall(target, 3);
        const found = detectContradictions(recalled);
        setMemories(recalled);
        setConflicts(found);
        setHasRun(true);

        const result = await runInvestigation({
          data: {
            incident: target,
            conflicts: found,
            memories: recalled.map((m) => ({
              incident_id: m.record.incident_id,
              title: m.record.title,
              service: m.record.service,
              root_cause: m.record.root_cause,
              resolution: m.record.resolution,
              lessons_learned: m.record.lessons_learned,
              failed_attempts: m.record.failed_attempts,
              corrections: m.record.corrections,
              confidence: m.confidence,
              freshness: m.freshness,
              ageDays: m.ageDays,
              similarity: m.similarity,
            })),
          },
        });
        setInvestigation(result);
      } finally {
        setLoading(false);
      }
    },
    [runInvestigation],
  );

  const saveResolution = useCallback(async () => {
    if (!incident.title.trim()) {
      setStatus("Add an incident title before saving it to memory.");
      return;
    }
    await memoryBank.retain(
      toMemoryRecord(
        {
          incident_id: `INC-${Date.now().toString().slice(-6)}`,
          title: incident.title,
          service: incident.service || "unknown-service",
          severity: incident.severity,
          symptoms: incident.symptoms,
          error_message: incident.error_message,
          root_cause: rootCause || investigation?.likely_root_cause || "Not recorded",
          investigation_steps: investigation?.investigation_steps ?? [],
          failed_attempts: failedAction
            ? [{ action: failedAction, why_it_failed: failedWhy || "Not recorded" }]
            : [],
          resolution: resolution || "Not recorded",
          lessons_learned: lessons || "Not recorded",
          timestamp: new Date().toISOString(),
        },
        "engineer_saved",
        { verified: true, corrections: correction ? [correction] : [] },
      ),
    );
    await refreshCount();
    setStatus("✅ Memory has learned from this incident.");
  }, [incident, rootCause, resolution, failedAction, failedWhy, lessons, correction, investigation, refreshCount]);

  const saveCorrection = useCallback(async () => {
    if (!correction.trim()) {
      setStatus("Write the correction first.");
      return;
    }
    const target = memories[0]?.record;
    if (target) {
      await memoryBank.retain({
        ...target,
        corrections: [...target.corrections, correction],
        source: "engineer_correction",
        verified_at: new Date().toISOString(),
      });
      await refreshCount();
      setStatus(`✅ Correction stored against ${target.incident_id}.`);
    } else {
      setStatus("No recalled memory to correct — save this incident as a new memory instead.");
    }
    setCorrection("");
  }, [correction, memories, refreshCount]);

  const demoStep1 = useCallback(async () => {
    await memoryBank.clear();
    await refreshCount();
    setIncident(DEMO_INCIDENT_2);
    setInvestigation(null);
    setMemories([]);
    setConflicts([]);
    setHasRun(false);
    setStatus("Memory bank reset. Incident 2 loaded — investigate it with an empty memory bank.");
  }, [refreshCount]);

  const demoStep2 = useCallback(async () => {
    await memoryBank.retain(toMemoryRecord(DEMO_INCIDENT_1, "engineer_saved", { verified: true }));
    await refreshCount();
    setStatus(`✅ Incident 1 (${DEMO_INCIDENT_1.incident_id}) retained, including its failed restart attempt.`);
  }, [refreshCount]);

  const seedAll = useCallback(async () => {
    for (const inc of demoIncidents) {
      await memoryBank.retain(toMemoryRecord(inc, "seed"));
    }
    await refreshCount();
    setStatus(`Seeded the memory bank with ${demoIncidents.length} historical incidents.`);
  }, [refreshCount]);

  const resetMemory = useCallback(async () => {
    await memoryBank.clear();
    await refreshCount();
    setStatus("Memory bank cleared.");
  }, [refreshCount]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
      <header className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Engineering Incident Memory Agent
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              An AI incident investigator that learns from engineering history — what worked, what
              failed, and what engineers corrected.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-memory/40 bg-memory/15 px-3 py-1 font-mono text-[0.65rem] tracking-wide text-memory uppercase">
            ● Memory-powered investigation
          </span>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
        {/* Sidebar */}
        <aside className="space-y-4">
          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Memory status</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Memory bank</dt>
                <dd className="font-mono text-xs">{memoryBank.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Memories stored</dt>
                <dd className="font-mono text-xs text-memory">{memoryCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Backend</dt>
                <dd className="font-mono text-xs text-warning">local fallback</dd>
              </div>
            </dl>
            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
              Hindsight is not connected yet. Memory runs on a local store behind the same
              retain/recall interface — nothing here is presented as a Hindsight result.
            </p>
            <div className="mt-4 space-y-2">
              <button onClick={seedAll} className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium transition hover:bg-accent">
                Seed 8 historical incidents
              </button>
              <button onClick={resetMemory} className="w-full rounded-md border border-border px-3 py-2 text-xs font-medium transition hover:bg-accent">
                Reset memory bank
              </button>
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Demo scenario</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Two payment incidents, run in order, showing memory before and after.
            </p>
            <div className="mt-3 space-y-2">
              <button onClick={demoStep1} className="w-full rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:opacity-90">
                1 · Reset + load Incident 2
              </button>
              <button onClick={demoStep2} className="w-full rounded-md border border-memory/50 bg-memory/15 px-3 py-2 text-xs font-semibold text-memory transition hover:bg-memory/25">
                2 · Remember Incident 1
              </button>
              <button
                onClick={() => void investigate(DEMO_INCIDENT_2)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium transition hover:bg-accent"
              >
                3 · Investigate Incident 2 again
              </button>
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="text-sm font-semibold">Load a demo incident</h2>
            <div className="mt-3 space-y-1.5">
              {demoIncidents.map((d) => (
                <button
                  key={d.incident_id}
                  onClick={() =>
                    setIncident({
                      title: d.title,
                      service: d.service,
                      error_message: d.error_message,
                      symptoms: d.symptoms,
                      severity: d.severity,
                    })
                  }
                  className="w-full rounded-md border border-border px-2.5 py-1.5 text-left text-xs transition hover:bg-accent"
                >
                  <span className="font-mono text-memory">{d.incident_id}</span> {d.title}
                </button>
              ))}
            </div>
          </section>
        </aside>

        {/* Main column */}
        <main className="space-y-6">
          <section className="panel p-5">
            <h2 className="text-lg font-semibold">New incident</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Incident title">
                  <input
                    className={inputClass}
                    value={incident.title}
                    onChange={(e) => setIncident({ ...incident, title: e.target.value })}
                    placeholder="Payment API experiencing intermittent failures"
                  />
                </Field>
              </div>
              <Field label="Service">
                <input
                  className={inputClass}
                  value={incident.service}
                  onChange={(e) => setIncident({ ...incident, service: e.target.value })}
                  placeholder="payments-api"
                />
              </Field>
              <Field label="Severity">
                <select
                  className={inputClass}
                  value={incident.severity}
                  onChange={(e) => setIncident({ ...incident, severity: e.target.value as Severity })}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="sm:col-span-2">
                <Field label="Error message">
                  <textarea
                    rows={2}
                    className={`${inputClass} font-mono text-xs`}
                    value={incident.error_message}
                    onChange={(e) => setIncident({ ...incident, error_message: e.target.value })}
                    placeholder="OperationalError: remaining connection slots are reserved..."
                  />
                </Field>
              </div>
              <div className="sm:col-span-2">
                <Field label="Symptoms">
                  <textarea
                    rows={3}
                    className={inputClass}
                    value={incident.symptoms}
                    onChange={(e) => setIncident({ ...incident, symptoms: e.target.value })}
                    placeholder="What engineers are seeing right now"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void investigate(incident)}
                disabled={loading}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Investigating…" : "Investigate incident"}
              </button>
              <button
                onClick={() => {
                  setIncident(EMPTY);
                  setInvestigation(null);
                  setMemories([]);
                  setConflicts([]);
                  setHasRun(false);
                }}
                className="rounded-md border border-border px-4 py-2 text-sm transition hover:bg-accent"
              >
                Clear form
              </button>
              {status && <span className="text-xs text-muted-foreground">{status}</span>}
            </div>
          </section>

          <MemoryPanel memories={memories} conflicts={conflicts} hasRun={hasRun} />

          <InvestigationPanel investigation={investigation} loading={loading} />

          <section className="panel p-5">
            <h2 className="text-lg font-semibold">Memory learning</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              When the incident is resolved, store what worked — and what did not.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Actual root cause">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  placeholder="Connection pool exhaustion from leaked connections"
                />
              </Field>
              <Field label="Resolution that worked">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="Release connections in finally block, cap pool size"
                />
              </Field>
              <Field label="Attempt that did NOT work">
                <input
                  className={inputClass}
                  value={failedAction}
                  onChange={(e) => setFailedAction(e.target.value)}
                  placeholder="Restarted the payments-api pods"
                />
              </Field>
              <Field label="Why it did not work">
                <input
                  className={inputClass}
                  value={failedWhy}
                  onChange={(e) => setFailedWhy(e.target.value)}
                  placeholder="Errors returned after 25 minutes"
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Lessons learned">
                  <input
                    className={inputClass}
                    value={lessons}
                    onChange={(e) => setLessons(e.target.value)}
                    placeholder="A restart that helps briefly signals a resource leak"
                  />
                </Field>
              </div>
            </div>
            <button
              onClick={() => void saveResolution()}
              className="mt-4 rounded-md border border-success/50 bg-success/15 px-4 py-2 text-sm font-semibold text-success transition hover:bg-success/25"
            >
              💾 Remember resolution
            </button>

            <div className="mt-6 border-t border-border pt-4">
              <Field label="Correct the AI investigation">
                <textarea
                  rows={2}
                  className={inputClass}
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                  placeholder="Correction: the actual problem was connection pool exhaustion, not database overload."
                />
              </Field>
              <button
                onClick={() => void saveCorrection()}
                className="mt-3 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium transition hover:bg-accent"
              >
                Store correction in memory
              </button>
            </div>
          </section>

          <p className="pb-6 text-center text-xs text-muted-foreground">
            Historical memory is guidance, not proof of the current root cause.
          </p>
        </main>
      </div>
    </div>
  );
}
