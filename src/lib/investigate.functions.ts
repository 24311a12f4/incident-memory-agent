import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Investigation } from "./types";

const failedAttemptSchema = z.object({
  action: z.string(),
  why_it_failed: z.string(),
});

const memorySchema = z.object({
  incident_id: z.string(),
  title: z.string(),
  service: z.string(),
  root_cause: z.string(),
  resolution: z.string(),
  lessons_learned: z.string(),
  failed_attempts: z.array(failedAttemptSchema),
  corrections: z.array(z.string()),
  confidence: z.string(),
  freshness: z.string(),
  ageDays: z.number(),
  similarity: z.number(),
});

const inputSchema = z.object({
  incident: z.object({
    title: z.string(),
    service: z.string(),
    error_message: z.string(),
    symptoms: z.string(),
    severity: z.string(),
  }),
  memories: z.array(memorySchema),
  conflicts: z.array(z.string()),
});

type Input = z.infer<typeof inputSchema>;

const SYSTEM_PROMPT = `You are an incident investigation assistant for a software engineering team.

You receive ONE current incident and, optionally, PAST INCIDENT MEMORIES recalled from a long-term memory bank.

Hard rules:
- Keep CURRENT INCIDENT and PAST INCIDENT MEMORIES strictly separate.
- Never state that a past incident IS the current root cause. Past memory is guidance, not proof. Use phrasing such as "Previous incident memory suggests...", "A similar incident found...", "Past resolution was...".
- Clearly distinguish SUCCESSFUL PREVIOUS ACTIONS from FAILED PREVIOUS ACTIONS. If a past attempt failed, say so and say why, e.g. "A previous similar incident attempted a service restart, but the problem returned; the eventual resolution involved connection-pool handling."
- If conflicting memories are provided, say additional current evidence is required and do not pick a winner.
- If an engineer correction is present in a memory, prefer the corrected knowledge and mention it.
- Do not invent metrics, confidence values or facts that were not provided.

Reply with JSON only, matching exactly:
{
  "summary": string,
  "likely_root_cause": string,
  "why_this_could_be_happening": string[],
  "investigation_steps": string[],
  "recommended_actions": string[],
  "risk_impact": string,
  "collect_next": string[],
  "memory_influence": string
}
"memory_influence" explains how the past memories shaped this investigation, or states that no relevant memory was available.`;

function buildUserPrompt(input: Input): string {
  const lines: string[] = [];
  lines.push("=== CURRENT INCIDENT ===");
  lines.push(`Title: ${input.incident.title}`);
  lines.push(`Service: ${input.incident.service}`);
  lines.push(`Severity: ${input.incident.severity}`);
  lines.push(`Symptoms: ${input.incident.symptoms}`);
  lines.push(`Error message: ${input.incident.error_message}`);
  lines.push("");

  if (input.memories.length === 0) {
    lines.push("=== PAST INCIDENT MEMORIES ===");
    lines.push("None recalled from the memory bank for this incident.");
  } else {
    lines.push(`=== PAST INCIDENT MEMORIES (${input.memories.length} recalled) ===`);
    for (const m of input.memories) {
      lines.push(`--- ${m.incident_id}: ${m.title} (${m.service}) ---`);
      lines.push(`Memory confidence: ${m.confidence}; freshness: ${m.freshness} (${m.ageDays} days old)`);
      lines.push(`Past root cause: ${m.root_cause}`);
      lines.push(`SUCCESSFUL PREVIOUS ACTION (resolution): ${m.resolution}`);
      if (m.failed_attempts.length) {
        lines.push("FAILED PREVIOUS ACTIONS:");
        for (const f of m.failed_attempts) lines.push(`  - ${f.action} -> did NOT work: ${f.why_it_failed}`);
      } else {
        lines.push("FAILED PREVIOUS ACTIONS: none recorded");
      }
      if (m.corrections.length) {
        lines.push("ENGINEER CORRECTIONS:");
        for (const c of m.corrections) lines.push(`  - ${c}`);
      }
      lines.push(`Lessons learned: ${m.lessons_learned}`);
    }
  }

  if (input.conflicts.length) {
    lines.push("");
    lines.push("=== CONFLICTING HISTORICAL MEMORIES ===");
    for (const c of input.conflicts) lines.push(`- ${c}`);
  }

  return lines.join("\n");
}

function fallbackInvestigation(input: Input, note: string): Investigation {
  const m = input.memories[0];
  const steps = [
    `Confirm the blast radius of ${input.incident.service}: error rate, latency and affected endpoints over the last 2 hours.`,
    "Line up the start of the symptoms against deploys, config changes and dependency status.",
    `Search logs for the exact error text: ${input.incident.error_message || "(none provided)"}.`,
    "Check resource saturation (connections, memory, threads, queue depth) on the affected service.",
  ];
  if (m) steps.push(`Re-check the signal that explained ${m.incident_id}: ${m.root_cause}`);

  return {
    summary: `${input.incident.severity} on ${input.incident.service}: ${input.incident.title}. ${input.incident.symptoms}`,
    likely_root_cause: m
      ? `Not established from current evidence. Previous incident memory (${m.incident_id}) suggests looking first at: ${m.root_cause}`
      : "Not established yet — current evidence is insufficient and no relevant incident memory was recalled.",
    why_this_could_be_happening: m
      ? [
          `A similar incident (${m.incident_id}, ${m.service}) produced comparable symptoms.`,
          `Past resolution was: ${m.resolution}`,
          ...m.failed_attempts.map(
            (f) => `Past investigation attempted "${f.action}", but it did not resolve the problem: ${f.why_it_failed}`,
          ),
        ]
      : ["No past incident memory is available, so hypotheses must come from current evidence only."],
    investigation_steps: steps,
    recommended_actions: m
      ? [
          `Verify (do not assume) whether the mechanism behind ${m.incident_id} is present again.`,
          `Avoid repeating the previously failed attempt: ${m.failed_attempts[0]?.action ?? "none recorded"}.`,
          "Capture evidence before mitigating so the root cause stays observable.",
        ]
      : ["Capture evidence before mitigating.", "Page the service owner if impact is customer facing."],
    risk_impact: `Severity ${input.incident.severity}. Treat customer-facing failures on ${input.incident.service} as revenue or trust impacting until proven otherwise.`,
    collect_next: [
      "Exact timestamp of the first failure",
      "Recent deploy and config-change list",
      "Saturation metrics for the affected resource",
      "Upstream dependency status for the same window",
    ],
    memory_influence: m
      ? `Influenced by previous incident memory ${m.incident_id} (${m.confidence}, ${m.freshness}).`
      : "No relevant incident memory was recalled, so this investigation uses current evidence only.",
    used_memory: Boolean(m),
    mode: "fallback",
    note,
  };
}

export const investigateIncident = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }): Promise<Investigation> => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return fallbackInvestigation(data, "AI is not configured, so a rule-based demo investigation was generated.");
    }

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3.8-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt(data) },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        const detail =
          res.status === 429
            ? "The AI service is rate limited right now."
            : res.status === 402
              ? "AI credits are exhausted for this workspace."
              : `The AI service returned ${res.status}.`;
        return fallbackInvestigation(data, `${detail} A rule-based investigation was generated instead.`);
      }

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content;
      if (!content) return fallbackInvestigation(data, "The AI service returned an empty response.");

      const parsed = JSON.parse(content) as Partial<Investigation>;
      return {
        summary: parsed.summary ?? "",
        likely_root_cause: parsed.likely_root_cause ?? "",
        why_this_could_be_happening: parsed.why_this_could_be_happening ?? [],
        investigation_steps: parsed.investigation_steps ?? [],
        recommended_actions: parsed.recommended_actions ?? [],
        risk_impact: parsed.risk_impact ?? "",
        collect_next: parsed.collect_next ?? [],
        memory_influence: parsed.memory_influence ?? "",
        used_memory: data.memories.length > 0,
        mode: "llm",
      };
    } catch (err) {
      console.error("investigateIncident failed", err);
      return fallbackInvestigation(data, "The AI service could not be reached. A rule-based investigation was generated.");
    }
  });
