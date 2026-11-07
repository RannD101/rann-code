import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimJob,
  completeJob,
  createScheduler,
  dueSchedulers,
  enqueueJob,
  failJob,
  finishSchedulerRun,
  getJob,
  getScheduler,
  listJobEvents,
  listSchedulerRuns,
  openDatabase,
  recoverStaleJobs,
  removeScheduler,
  retryJob,
  startSchedulerRun,
  updateScheduler,
  type Db
} from "./index.js";

const opened: Db[] = [];

function setup(): Db {
  const dir = mkdtempSync(join(tmpdir(), "rann-jobs-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("antrean background", () => {
  it("mengantre dengan idempotency key dan klaim transaksional", () => {
    const db = setup();
    const first = enqueueJob(db, { kind: "prompt", payload: { text: "halo" }, idempotencyKey: "idem-12345678" });
    const second = enqueueJob(db, { kind: "prompt", payload: { text: "halo" }, idempotencyKey: "idem-12345678" });
    expect(second.id).toBe(first.id);
    expect(first.status).toBe("queued");

    const claimed = claimJob(db, { workerId: "worker-a", now: Date.now(), leaseMs: 1_000 });
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    expect(claimJob(db, { workerId: "worker-b" })).toBeUndefined();
  });

  it("menyelesaikan job dan tidak menjalankannya ulang setelah restart", () => {
    const db = setup();
    const job = enqueueJob(db, { kind: "shell", payload: { text: "echo ok" } });
    claimJob(db, { workerId: "worker-a" });
    expect(completeJob(db, job.id, { stdout: "ok" }, "worker-a")).toBe(true);
    expect(getJob(db, job.id)?.status).toBe("done");
    expect(recoverStaleJobs(db)).toEqual({ requeued: 0, dead: 0 });
    expect(claimJob(db, { workerId: "worker-b" })).toBeUndefined();
    expect(listJobEvents(db, job.id).map((event) => event.type)).toContain("done");
  });

  it("mengulang job gagal dengan backoff lalu masuk dead letter", () => {
    const db = setup();
    const job = enqueueJob(db, { kind: "shell", payload: { text: "exit 1" }, maxAttempts: 2 });
    claimJob(db, { workerId: "worker-a" });
    expect(failJob(db, job.id, new Error("gagal pertama"), "worker-a")).toBe("queued");
    expect(getJob(db, job.id)?.status).toBe("queued");
    claimJob(db, { workerId: "worker-b", now: Date.now() + 5_000 });
    expect(failJob(db, job.id, new Error("gagal kedua"), "worker-b")).toBe("dead");
    expect(getJob(db, job.id)?.last_error).toContain("gagal kedua");
    expect(retryJob(db, job.id)).toBe(true);
    expect(getJob(db, job.id)?.status).toBe("queued");
  });

  it("mengembalikan job running yang lease-nya kedaluwarsa", () => {
    const db = setup();
    const job = enqueueJob(db, { kind: "prompt", payload: { text: "lama" }, maxAttempts: 2 });
    const base = Date.now();
    claimJob(db, { workerId: "worker-a", now: base, leaseMs: 1_000 });
    const recovered = recoverStaleJobs(db, { now: base + 5_000 });
    expect(recovered).toEqual({ requeued: 1, dead: 0 });
    expect(getJob(db, job.id)?.status).toBe("queued");
    claimJob(db, { workerId: "worker-b", now: base + 6_000 });
    failJob(db, job.id, new Error("gagal"), "worker-b");
    recoverStaleJobs(db, { now: 100_000 });
    expect(getJob(db, job.id)?.status).toBe("dead");
  });

  it("menandai dead letter bila lease habis setelah percobaan maksimum", () => {
    const db = setup();
    const job = enqueueJob(db, { kind: "prompt", payload: { text: "macet" }, maxAttempts: 1 });
    const base = Date.now();
    claimJob(db, { workerId: "worker-a", now: base, leaseMs: 1_000 });
    expect(recoverStaleJobs(db, { now: base + 5_000 })).toEqual({ requeued: 0, dead: 1 });
    expect(getJob(db, job.id)?.status).toBe("dead");
  });
});

describe("scheduler repositori", () => {
  it("menyimpan jadwal, due, update, dan menghapus", () => {
    const db = setup();
    const row = createScheduler(db, {
      name: "backup",
      schedule: "every:5m",
      command: "shell:echo backup",
      timezone: "Asia/Jakarta",
      nextRunAt: 1_000
    });
    expect(getScheduler(db, "backup")?.id).toBe(row.id);
    expect(dueSchedulers(db, 2_000)).toHaveLength(1);
    expect(dueSchedulers(db, 500)).toHaveLength(0);

    const updated = updateScheduler(db, row.id, { enabled: 0, next_run_at: null });
    expect(updated?.enabled).toBe(0);
    expect(dueSchedulers(db, 5_000)).toHaveLength(0);
    expect(removeScheduler(db, row.name)).toBe(true);
    expect(getScheduler(db, row.id)).toBeUndefined();
  });

  it("mencatat riwayat eksekusi dengan durasi dan output", () => {
    const db = setup();
    const row = createScheduler(db, {
      name: "laporan",
      schedule: "cron:0 7 * * *",
      command: "prompt:buat laporan harian",
      nextRunAt: 1_000
    });
    const run = startSchedulerRun(db, row, 1_000);
    expect(run.status).toBe("running");
    finishSchedulerRun(db, run.id, "done", "laporan selesai");
    const history = listSchedulerRuns(db, row.id);
    expect(history[0]?.status).toBe("done");
    expect(history[0]?.output).toBe("laporan selesai");
    expect(history[0]?.duration_ms).toBeGreaterThanOrEqual(0);
    expect(getScheduler(db, row.id)?.last_run_at).not.toBeNull();
  });
});
