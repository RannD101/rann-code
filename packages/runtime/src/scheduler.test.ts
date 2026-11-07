import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createScheduler,
  listJobs,
  listSchedulerRuns,
  openDatabase,
  type Db,
  type SchedulerRow
} from "@rann/storage";
import {
  SchedulerEngine,
  describeSchedule,
  nextRunFor,
  parseDuration,
  parseSchedule,
  planSchedulerTick
} from "./scheduler.js";

const opened: Db[] = [];

function setup(): Db {
  const dir = mkdtempSync(join(tmpdir(), "rann-sched-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

describe("parseDuration", () => {
  it("mengubah satuan ms, detik, menit, jam, dan hari", () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("menolak format yang tidak dikenal", () => {
    expect(parseDuration("5 menit")).toBeUndefined();
    expect(parseDuration("-1s")).toBeUndefined();
    expect(parseDuration("m")).toBeUndefined();
  });
});

describe("parseSchedule", () => {
  it("mengenali once, every, dan cron dengan atau tanpa prefix", () => {
    const once = parseSchedule("once:2026-11-08T01:00:00.000Z");
    expect(once.kind).toBe("once");
    expect(once.at).toBe(Date.parse("2026-11-08T01:00:00.000Z"));

    const every = parseSchedule("every:5m");
    expect(every).toEqual({ kind: "every", expression: "every:5m", intervalMs: 300_000 });

    const cron = parseSchedule("cron:0 7 * * *");
    expect(cron.kind).toBe("cron");
    expect(cron.cron).toBe("0 7 * * *");
    expect(parseSchedule("*/15 * * * *").kind).toBe("cron");
  });

  it("menolak jadwal tidak valid dengan pesan yang bisa ditindaklanjuti", () => {
    expect(() => parseSchedule("once:bukan-tanggal")).toThrowError(/once tidak valid/);
    expect(() => parseSchedule("every:500ms")).toThrowError(/interval tidak valid/);
    expect(() => parseSchedule("0 7 *")).toThrowError(/cron tidak valid/);
  });
});

describe("nextRunFor", () => {
  it("menghitung interval dan menghormati timezone cron", () => {
    const from = Date.parse("2026-11-07T10:00:00.000Z");
    expect(nextRunFor("every:30s", "Asia/Jakarta", from)).toBe(from + 30_000);
    expect(nextRunFor("cron:0 7 * * *", "Asia/Jakarta", from)).toBe(Date.parse("2026-11-08T00:00:00.000Z"));
    expect(nextRunFor("once:2026-11-09T00:00:00.000Z", "UTC", from)).toBe(Date.parse("2026-11-09T00:00:00.000Z"));
  });

  it("menolak timezone yang tidak dikenal", () => {
    expect(() => nextRunFor("every:5m", "Mars/Olympus")).toThrowError(/timezone tidak valid/);
  });

  it("memberi deskripsi yang bisa dibaca manusia", () => {
    expect(describeSchedule("every:2h")).toBe("setiap 2h");
    expect(describeSchedule("cron:0 7 * * *")).toBe("cron 0 7 * * *");
  });
});

describe("planSchedulerTick", () => {
  function row(overrides: Partial<SchedulerRow> = {}): SchedulerRow {
    return {
      id: "sch-1",
      name: "uji",
      schedule: "every:5m",
      command: "shell:echo ok",
      payload_json: "{}",
      enabled: 1,
      next_run_at: 1_000,
      last_run_at: null,
      timezone: "UTC",
      misfire_policy: "run_once",
      overlap_policy: "skip",
      catch_up: 0,
      max_attempts: 3,
      created_at: 1_000,
      updated_at: 1_000,
      ...overrides
    };
  }

  it("melewati jadwal yang terlewat bila catch_up mati", () => {
    const plan = planSchedulerTick(row({ catch_up: 0 }), 100_000);
    expect(plan.shouldRun).toBe(false);
    expect(plan.nextRunAt).toBeGreaterThan(100_000);
  });

  it("menjalankan sekali lalu menjadwalkan berikutnya bila catch_up hidup", () => {
    const plan = planSchedulerTick(row({ catch_up: 1 }), 100_000);
    expect(plan.shouldRun).toBe(true);
    expect(plan.scheduledFor).toBe(1_000);
    expect(plan.nextRunAt).toBe(400_000);
    expect(plan.enabled).toBe(true);
  });

  it("mematikan jadwal once setelah dijalankan", () => {
    const plan = planSchedulerTick(row({ schedule: "once:2026-11-07T10:00:00.000Z", catch_up: 1 }), 100_000);
    expect(plan.shouldRun).toBe(true);
    expect(plan.nextRunAt).toBeNull();
    expect(plan.enabled).toBe(false);
  });
});

describe("SchedulerEngine", () => {
  it("mengantre job dan mencatat run untuk jadwal yang due", async () => {
    const db = setup();
    const scheduler = createScheduler(db, {
      name: "echo",
      schedule: "every:5m",
      command: "shell:echo ok",
      nextRunAt: Date.now() - 1_000
    });
    const engine = new SchedulerEngine({ db, pollMs: 60_000 });
    engine.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    engine.stop();

    const jobs = listJobs(db, { queue: "scheduler" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("scheduler.run");
    expect(JSON.parse(jobs[0]?.payload_json ?? "{}")).toMatchObject({ schedulerId: scheduler.id, command: "shell:echo ok" });
    expect(listSchedulerRuns(db, scheduler.id)).toHaveLength(1);

    const second = new SchedulerEngine({ db, pollMs: 60_000 });
    second.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    second.stop();
    expect(listJobs(db, { queue: "scheduler" })).toHaveLength(1);
  });
});
