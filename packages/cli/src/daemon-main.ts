#!/usr/bin/env node
import { startDaemon } from "@rann/runtime";
import { toRannError } from "@rann/shared";
import { packageVersion } from "./daemon.js";

startDaemon({ version: packageVersion() })
  .then(({ layout }) => {
    process.stdout.write(JSON.stringify({ ready: true, pid: process.pid, socket: layout.socketPath }) + "\n");
  })
  .catch((error: unknown) => {
    const err = toRannError(error);
    process.stderr.write(`${err.code}: ${err.message}\n`);
    process.exit(err.exitCode);
  });
