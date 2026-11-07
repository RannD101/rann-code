import { Cron } from "croner";
import type { Db, SchedulerRow, SchedulerRunRow } from "@rann/storage";
import {
  dueSchedulers,
  enqueueJob,
  finishSchedulerRun,
  getScheduler,
  runningSchedulerRuns,
  startSchedulerRun,
  updateScheduler,
} from "@rann/storage";

export interface ScheduleSpec {
  kind: "once" | "every" | "cron";
  expression: string;
  intervalMs?: number;
  cron?: string;
  at?: number;
}

export interface SchedulerEngineOptions {
  db: Db;
  pollMs?: number;
  onError?: (error: unknown, scheduler?: SchedulerRow) => void;
}

const DURATION = /^(\d+)(ms|s|m|h|d)$/;

export function parseDuration(value: string): number | undefined {
  const match = DURATION.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] as "ms" | "s" | "m" | "h" | "d";
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return amount * factor;
}

export function parseSchedule(input: string): ScheduleSpec {
  const raw = input.trim();
  if (raw.startsWith("once:")) {
    const value = raw.slice(5).trim();
    const at = Date.parse(value);
    if (!Number.isFinite(at)) throw new Error(`jadwal once tidak valid: ${value}`);
    return { kind: "once", expression: raw, at };
  }
  if (raw.startsWith("every:")) {
    const value = raw.slice(6).trim();
    const intervalMs = parseDuration(value);
    if (!intervalMs || intervalMs < 1_000) throw new Error(`interval tidak valid: ${value} (contoh 30s, 5m, 2h)`);
    return { kind: "every", expression: raw, intervalMs };
  }
  const cron = raw.startsWith("cron:") ? raw.slice(5).trim() : raw;
  if (cron.split(/\s+/).length < 5) throw new Error(`cron tidak valid: ${cron} (butuh 5 field)`);
  return { kind: "cron", expression: raw, cron };
}

export function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`timezone tidak valid: ${timezone}`);
  }
}

export function nextRunFor(schedule: string, timezone: string, from = Date.now()): number | null {
  assertTimezone(timezone);
  const spec = parseSchedule(schedule);
  if (spec.kind === "once") return spec.at ?? null;
  if (spec.kind === "every") return from + (spec.intervalMs ?? 0);
  const cron = new Cron(spec.cron as string, { timezone });
  const next = cron.nextRun(new Date(from + 1));
  return next ? next.getTime() : null;
}

export function describeSchedule(schedule: string): string {
  const spec = parseSchedule(schedule);
  if (spec.kind === "once") return `sekali pada ${new Date(spec.at ?? 0).toISOString()}`;
  if (spec.kind === "every") return `setiap ${spec.expression.slice(6)}`;
  return `cron ${spec.cron}`;
}

/**
 * Advances a scheduler row and returns the run that must be executed, if any.
 * Kept separate from the polling loop so the catch-up policy is unit-testable.
 */
export function planSchedulerTick(row: SchedulerRow, at = Date.now()): {
  nextRunAt: number | null;
  enabled: boolean;
  shouldRun: boolean;
  scheduledFor: number | null;
} {
  const scheduledFor = row.next_run_at;
  if (scheduledFor === null) {
    return { nextRunAt: null, enabled: row.enabled === 1, shouldRun: false, scheduledFor: null };
  }
  const spec = parseSchedule(row.schedule);
  const missed = scheduledFor < at - 1_000;
  if (missed && row.catch_up !== 1) {
    const next = spec.kind === "once" ? null : nextRunFor(row.schedule, row.timezone, at);
    return { nextRunAt: next, enabled: spec.kind === "once" ? false : row.enabled === 1, shouldRun: false, scheduledFor };
  }
  const next = spec.kind === "once" ? null : nextRunFor(row.schedule, row.timezone, at);
  return {
    nextRunAt: next,
    enabled: spec.kind === "once" ? false : row.enabled === 1,
    shouldRun: true,
    scheduledFor,
  };
}

export class SchedulerEngine {
  private readonly db: Db;
  private readonly pollMs: number;
  private readonly onError?: SchedulerEngineOptions["onError"];
  private timer?: ReturnType<typeof setInterval>;
  private stopped = true;
  private ticking = false;

  constructor(options: SchedulerEngineOptions) {
    this.db = options.db;
    this.pollMs = Math.max(100, options.pollMs ?? 1_000);
    this.onError = options.onError;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(at = Date.now()): Promise<SchedulerRunRow[]> {
    if (this.ticking || this.stopped) return [];
    this.ticking = true;
    const started: SchedulerRunRow[] = [];
    try {
      for (const row of dueSchedulers(this.db, at)) {
        try {
          const plan = planSchedulerTick(row, at);
          const running = runningSchedulerRuns(this.db, row.id);
          if (plan.shouldRun && running.length > 0 && row.overlap_policy === "skip") {
            updateScheduler(this.db, row.id, { next_run_at: plan.nextRunAt, enabled: plan.enabled ? 1 : 0 });
            continue;
          }
          if (plan.shouldRun && running.length > 0 && row.overlap_policy === "replace") {
            for (const run of running) finishSchedulerRun(this.db, run.id, "cancelled", undefined, "diganti jadwal baru");
          }
          let run: SchedulerRunRow | undefined;
          if (plan.shouldRun) {
            run = startSchedulerRun(this.db, row, plan.scheduledFor);
            enqueueJob(this.db, {
              kind: "scheduler.run",
              queue: "scheduler",
              priority: 120,
              maxAttempts: row.max_attempts,
              payload: {
                schedulerId: row.id,
                schedulerName: row.name,
                runId: run.id,
                command: row.command,
                data: JSON.parse(row.payload_json) as unknown,
                timezone: row.timezone,
              },
            });
            started.push(run);
          }
          updateScheduler(this.db, row.id, { next_run_at: plan.nextRunAt, enabled: plan.enabled ? 1 : 0 });
        } catch (error) {
          this.onError?.(error, row);
        }
      }
    } finally {
      this.ticking = false;
    }
    return started;
  }
}

export function schedulerStatus(db: Db, idOrName: string): {
  scheduler: SchedulerRow;
  nextRunAt: number | null;
  running: SchedulerRunRow[];
} | undefined {
  const scheduler = getScheduler(db, idOrName);
  if (!scheduler) return undefined;
  return { scheduler, nextRunAt: scheduler.next_run_at, running: runningSchedulerRuns(db, scheduler.id) };
}
