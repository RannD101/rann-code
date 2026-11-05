import { rmSync } from "node:fs";
import { join } from "node:path";

const packages = ["shared", "storage", "runtime", "cli"];
for (const name of packages) {
  rmSync(join("packages", name, "dist"), { recursive: true, force: true });
}
rmSync(join("packages", "shared", "tsconfig.tsbuildinfo"), { force: true });
console.log("dist dibersihkan");
