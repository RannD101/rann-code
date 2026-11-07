import type { Db, JobRow } from "@rann/storage";
import {
  appendJobEvent,
  claimJob,
  completeJob,
  failJob,
  getJob,
  heartbeatJob,
  recoverStaleJobs,
} from "@rann/storage";

export interface JobContext {
  job: JobRow;
  signal: AbortSignal;
  log: (message: string) => void;
  heartbeat: () => void;
}

export type JobRunner = (context: JobContext) => Promise<unknown>;

export interface BackgroundQueueOptions {
  db: Db;
  workerId?: string;
  queues?: string[];
  concurrency?: number;
  pollMs?: number;
  leaseMs?: number;
  maxRuntimeMs?: number;
  runner: JobRunner;
  onEvent?: (type: string, job: JobRow | undefined, data?: Record<string, unknown>) => void;
}

export interface QueueSnapshot {
  running: number;
  concurrency: number;
  lastPollAt: number | null;
  lastError: string | null;
  workerId: string;
}

/**
 * Persistent worker queue. Claim is transactional in SQLite, so two daemons
 * pointed at the same database cannot run the same job.
 */
export class BackgroundQueue {
  private readonly db: Db;
  private readonly workerId: string;
  private readonly queues: string[];
  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly leaseMs: number;
  private readonly maxRuntimeMs: number;
  private readonly runner: JobRunner;
  private readonly onEvent?: BackgroundQueueOptions["onEvent"];
  private readonly active = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private stopped = true;
  private lastPollAt: number | null = null;
  private lastError: string | null = null;

  constructor(options: BackgroundQueueOptions) {
    this.db = options.db;
    this.workerId = options.workerId ?? `worker-${process.pid}`;
    this.queues = options.queues?.length ? options.queues : ["default", "scheduler"];
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.pollMs = Math.max(50, options.pollMs ?? 1_000);
    this.leaseMs = Math.max(1_000, options.leaseMs ?? 60_000);
    this.maxRuntimeMs = Math.max(1_000, options.maxRuntimeMs ?? 3_600_000);
    this.runner = options.runner;
    this.onEvent = options.onEvent;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const recovered = recoverStaleJobs(this.db);
    if (recovered.requeued || recovered.dead) {
      this.onEvent?.("recovered", undefined, { ...recovered });
    }
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref?.();
    void this.tick();
  }

  async stop(graceMs = 5_000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.active.values()) controller.abort();
    const deadline = Date.now() + graceMs;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  snapshot(): QueueSnapshot {
    return {
      running: this.active.size,
      concurrency: this.concurrency,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      workerId: this.workerId,
    };
  }

  /** Exposed for tests and for the daemon watchdog. */
  async tick(): Promise<number> {
    if (this.polling || this.stopped) return 0;
    this.polling = true;
    let started = 0;
    try {
      while (!this.stopped && this.active.size < this.concurrency) {
        const job = claimJob(this.db, {
          workerId: this.workerId,
          queues: this.queues,
          leaseMs: this.leaseMs,
        });
        if (!job) break;
        started += 1;
        void this.runJob(job);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.lastPollAt = Date.now();
      this.polling = false;
    }
    return started;
  }

  private async runJob(job: JobRow): Promise<void> {
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const heartbeat = setInterval(() => {
      if (!heartbeatJob(this.db, job.id, this.workerId, this.leaseMs)) controller.abort();
    }, Math.max(500, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();
    const deadline = setTimeout(() => controller.abort(), this.maxRuntimeMs);
    deadline.unref?.();
    this.onEvent?.("started", job);
    try {
      const result = await this.runner({
        job,
        signal: controller.signal,
        log: (message) => appendJobEvent(this.db, job.id, "log", { message: message.slice(0, 8_000) }),
        heartbeat: () => heartbeatJob(this.db, job.id, this.workerId, this.leaseMs),
      });
      if (controller.signal.aborted) throw new Error("E_JOB_ABORTED");
      completeJob(this.db, job.id, result, this.workerId);
      this.onEvent?.("done", getJob(this.db, job.id) ?? job, { result });
    } catch (error) {
      const message = controller.signal.aborted ? "job aborted or exceeded max runtime" : error;
      const status = failJob(this.db, job.id, message, this.workerId);
      appendJobEvent(this.db, job.id, "error", { message: String(message).slice(0, 4_000) });
      this.onEvent?.("failed", getJob(this.db, job.id) ?? job, { error: String(message), status });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      this.active.delete(job.id);
    }
  }
}
