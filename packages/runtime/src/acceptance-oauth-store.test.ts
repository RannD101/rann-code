import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SecretStore } from "@rann/storage";
import { McpManager, type McpServerConfig } from "./mcp.js";

describe("OAuth MCP", () => {
  it("AC-093 token device flow disimpan di secret store", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/device") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ device_code: "dev", user_code: "ABCD", verification_uri: "https://contoh.test/aktivasi", interval: 0, expires_in: 30 }));
        return;
      }
      if (request.url === "/token") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ access_token: "tok_rahasia" }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (typeof address === "string" || address === null) throw new Error("port tidak valid");
    const base = `http://127.0.0.1:${address.port}`;
    const secrets = new SecretStore({ dir: mkdtempSync(join(tmpdir(), "rann-oauth-vault-")), keychain: false });
    const config: McpServerConfig = {
      url: `${base}/mcp`,
      headers: {},
      enabled: true,
      timeout_ms: 1_000,
      permission: "read",
      transport: "http",
      oauth: {
        token_url: `${base}/token`,
        device_authorization_url: `${base}/device`,
        client_id: "klien"
      }
    };
    const manager = new McpManager({ srv: config }, "test", secrets);
    await expect((manager as unknown as { startHttp: (name: string, config: McpServerConfig, transport: "http") => Promise<unknown> }).startHttp("srv", config, "http")).rejects.toBeTruthy();
    expect(secrets.get("mcp-srv")).toBe("tok_rahasia");
    await manager.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }, 30_000);
});
