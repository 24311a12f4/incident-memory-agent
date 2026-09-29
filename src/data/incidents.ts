import type { Incident } from "@/lib/types";

/**
 * Demo / seed incidents only.
 * Long-term memory itself lives in the memory bank (src/lib/memory.ts).
 */
export const demoIncidents: Incident[] = [
  {
    incident_id: "INC-1042",
    title: "Payment API failures during checkout",
    service: "payments-api",
    severity: "SEV1",
    symptoms:
      "Checkout requests intermittently fail. Error rate climbs from 0.2% to 18% during traffic peaks. Latency p99 jumps above 12s before requests error out.",
    error_message:
      "psycopg2.OperationalError: FATAL: remaining connection slots are reserved for non-replication superuser connections",
    root_cause:
      "Database connection pool exhaustion. A code path opened connections inside a retry loop and never returned them to the pool, so connections leaked under load.",
    investigation_steps: [
      "Compared error-rate spike with deploy timeline",
      "Checked pg_stat_activity for idle-in-transaction connections",
      "Graphed pool checkout time vs active connections",
      "Traced the leaking code path to the refund retry helper",
    ],
    failed_attempts: [
      {
        action: "Restarted all payments-api pods",
        why_it_failed:
          "Errors disappeared for ~25 minutes while pools were empty, then returned as connections leaked again. Masked the symptom, not the cause.",
      },
      {
        action: "Raised Postgres max_connections from 200 to 400",
        why_it_failed:
          "Bought about an hour and increased database memory pressure. The leak rate was unbounded, so a bigger ceiling only delayed exhaustion.",
      },
    ],
    resolution:
      "Fixed the refund retry helper to release connections in a finally block, capped pool size per pod, and added alerting on pool utilisation above 80%.",
    lessons_learned:
      "A service restart that 'fixes' an issue for a few minutes is a strong signal of a resource leak, not a fix.",
    timestamp: "2026-07-14T09:20:00Z",
  },
  {
    incident_id: "INC-1057",
    title: "Authentication service timeouts on login",
    service: "auth-service",
    severity: "SEV2",
    symptoms:
      "Around 9% of logins time out after 30s. Mobile clients retry, amplifying load. Token refresh calls are unaffected.",
    error_message: "upstream request timeout (504) calling identity-provider /verify",
    root_cause:
      "The outbound HTTP client had no timeout configured, so slow upstream calls from the identity provider held worker threads until the gateway killed them.",
    investigation_steps: [
      "Checked identity-provider status page and saw elevated latency",
      "Measured worker-thread saturation in auth-service",
      "Confirmed HTTP client had default (infinite) timeout",
    ],
    failed_attempts: [
      {
        action: "Scaled auth-service from 6 to 18 replicas",
        why_it_failed:
          "More replicas simply held more blocked threads against the same slow upstream. Timeout rate stayed flat.",
      },
    ],
    resolution:
      "Set a 3s connect / 5s read timeout, added a circuit breaker around the identity provider, and served cached verification for short-lived tokens.",
    lessons_learned:
      "Every outbound call needs an explicit timeout. Scaling out does not help when threads are blocked on a slow dependency.",
    timestamp: "2026-06-02T15:05:00Z",
  },
  {
    incident_id: "INC-1063",
    title: "Redis cache cluster failover caused cascading errors",
    service: "catalog-service",
    severity: "SEV2",
    symptoms:
      "Product pages return 500s for ~7 minutes. Database CPU spikes to 96% during the same window.",
    error_message: "redis.exceptions.ConnectionError: Error 111 connecting to redis-primary:6379. Connection refused.",
    root_cause:
      "A Redis primary failover left clients pinned to the old node. With cache unavailable, all reads fell through to Postgres and overwhelmed it (thundering herd).",
    investigation_steps: [
      "Correlated Redis failover event with the 500 spike",
      "Confirmed clients were not re-resolving the primary endpoint",
      "Observed unbounded cache-miss fan-out to Postgres",
    ],
    failed_attempts: [
      {
        action: "Flushed the Redis cache to 'clear a bad state'",
        why_it_failed:
          "Removed every warm key and made the database stampede worse for several minutes.",
      },
    ],
    resolution:
      "Switched to a Sentinel-aware client, added request coalescing on cache misses, and set a short negative-cache TTL.",
    lessons_learned:
      "Cache outages must degrade gracefully. Never flush a cache during a database overload.",
    timestamp: "2026-05-11T22:41:00Z",
  },
  {
    incident_id: "INC-1071",
    title: "Memory leak forcing hourly service restarts",
    service: "notifications-worker",
    severity: "SEV3",
    symptoms:
      "Container memory grows steadily and the pod is OOMKilled roughly every 70 minutes. Notification delivery is delayed during restarts.",
    error_message: "Container notifications-worker was OOMKilled (exit code 137)",
    root_cause:
      "An in-process template cache keyed by user id grew without bound, retaining rendered templates for every recipient.",
    investigation_steps: [
      "Plotted RSS against pod age to confirm linear growth",
      "Captured a heap dump before OOM",
      "Found the unbounded dict in the template renderer",
    ],
    failed_attempts: [
      {
        action: "Doubled the pod memory limit from 512Mi to 1Gi",
        why_it_failed:
          "Extended time between restarts from 35 to 70 minutes. Linear growth means any limit is eventually reached.",
      },
      {
        action: "Added a nightly cron restart",
        why_it_failed:
          "Hid the leak from dashboards while delivery delays continued during working hours.",
      },
    ],
    resolution:
      "Replaced the cache with an LRU capped at 5,000 entries and added a memory-growth alert.",
    lessons_learned:
      "Raising a memory limit is a diagnostic, not a remedy, when growth is linear.",
    timestamp: "2026-04-19T11:00:00Z",
  },
  {
    incident_id: "INC-1080",
    title: "Partner integrations hitting API rate limits",
    service: "public-api-gateway",
    severity: "SEV3",
    symptoms:
      "Three partners report bulk 429 responses starting 08:00 UTC. Internal traffic is unaffected.",
    error_message: "429 Too Many Requests - quota 'partner_tier_2' exceeded (limit 600/min)",
    root_cause:
      "A rate-limit config change moved partners from per-key to per-organisation quotas, silently cutting effective limits for orgs with several keys.",
    investigation_steps: [
      "Diffed gateway config changes in the last 24h",
      "Reproduced quota accounting for an affected partner",
      "Confirmed per-org aggregation was newly applied",
    ],
    failed_attempts: [
      {
        action: "Asked partners to add client-side backoff",
        why_it_failed:
          "Backoff is good practice but the quota itself was wrong, so throttling persisted at lower throughput.",
      },
    ],
    resolution:
      "Restored per-key quotas for existing partners, introduced the per-org model behind a migration flag, and published quota headers.",
    lessons_learned:
      "Quota-model changes are breaking changes and need a migration path plus partner comms.",
    timestamp: "2026-03-08T08:15:00Z",
  },
  {
    incident_id: "INC-1088",
    title: "Kubernetes pod crash loop after config rollout",
    service: "search-indexer",
    severity: "SEV2",
    symptoms:
      "All indexer pods restart continuously. Search index falls behind by several hours.",
    error_message: "CrashLoopBackOff: Error: ENOENT: no such file or directory, open '/etc/config/index.yaml'",
    root_cause:
      "A ConfigMap was renamed in the rollout but the deployment still mounted the old name, so the config file was absent at boot.",
    investigation_steps: [
      "Read pod events and container logs from the first crash",
      "Compared the rendered manifest against the previous revision",
      "Confirmed the ConfigMap name mismatch",
    ],
    failed_attempts: [
      {
        action: "Deleted the pods to force a clean reschedule",
        why_it_failed:
          "New pods mounted the same missing ConfigMap and crashed identically.",
      },
    ],
    resolution:
      "Rolled back the deployment, then re-applied with the corrected ConfigMap reference and added a manifest lint check in CI.",
    lessons_learned:
      "Crash loops that survive a reschedule are configuration problems, not runtime flakiness.",
    timestamp: "2026-02-23T17:30:00Z",
  },
  {
    incident_id: "INC-1094",
    title: "Slow database queries degrading order history",
    service: "orders-service",
    severity: "SEV3",
    symptoms:
      "Order history page takes 8-14s for high-volume customers. Other endpoints are normal.",
    error_message: "statement timeout: canceling statement due to statement timeout (30000ms)",
    root_cause:
      "A new filter added a predicate on orders.status, and no composite index existed for (customer_id, status, created_at), producing large sequential scans.",
    investigation_steps: [
      "Pulled the slowest statements from pg_stat_statements",
      "Ran EXPLAIN ANALYZE on the order-history query",
      "Confirmed sequential scan over 40M rows",
    ],
    failed_attempts: [
      {
        action: "Increased the statement timeout to 60s",
        why_it_failed:
          "Queries completed instead of erroring, but page load stayed unacceptable and connections were held far longer.",
      },
    ],
    resolution:
      "Added the composite index concurrently, paginated the endpoint, and added a slow-query budget to code review.",
    lessons_learned:
      "Timeout tuning changes how failure looks without changing the query plan.",
    timestamp: "2026-01-30T13:10:00Z",
  },
  {
    incident_id: "INC-1101",
    title: "Third-party payment provider timeouts during peak sale",
    service: "payments-api",
    severity: "SEV1",
    symptoms:
      "Card authorisations hang for 30s then fail. Provider status page reports degraded performance. Duplicate charges reported by 14 customers.",
    error_message: "GatewayTimeout: POST https://provider.example/v2/authorize timed out after 30000ms",
    root_cause:
      "Upstream provider degradation combined with a non-idempotent retry in our client, which re-submitted authorisations that had actually succeeded.",
    investigation_steps: [
      "Confirmed provider-side degradation from their status feed",
      "Audited retry logic for idempotency keys",
      "Reconciled duplicate authorisations against provider records",
    ],
    failed_attempts: [
      {
        action: "Increased the client retry count from 2 to 5",
        why_it_failed:
          "Multiplied duplicate charges because retries carried no idempotency key.",
      },
    ],
    resolution:
      "Added idempotency keys to every authorisation, capped retries with jittered backoff, and built a failover path to the secondary provider.",
    lessons_learned:
      "Never retry a payment call without an idempotency key. Upstream slowness plus blind retries creates financial incidents.",
    timestamp: "2025-12-05T19:45:00Z",
  },
];
