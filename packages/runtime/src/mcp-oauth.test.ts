import { createServer, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchOAuthToken } from "./mcp.js";

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(handler: (url: string | undefined, body: string, response: ServerResponse) => void): Promise<string> {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => handler(request.url, body, response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("alamat tidak valid");
  servers.push({ close: () => new Promise<void>((resolve) => server.close(() => resolve())) });
  return `http://127.0.0.1:${address.port}`;
}

function json(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

describe("OAuth MCP device flow", () => {
  it("meminta kode perangkat lalu menunggu token", async () => {
    let polls = 0;
    const base = await serve((url, _body, response) => {
      if (url === "/device") {
        json(response, { device_code: "dev_1", user_code: "ABCD-EFGH", verification_uri: "https://contoh.test/aktivasi", interval: 1, expires_in: 60 });
        return;
      }
      polls += 1;
      if (polls === 1) json(response, { error: "authorization_pending" });
      else json(response, { access_token: "tok_1" });
    });
    const codes: Array<{ userCode: string; verificationUri: string }> = [];
    const token = await fetchOAuthToken(
      "uji",
      {
        token_url: `${base}/token`,
        device_authorization_url: `${base}/device`,
        client_id: "klien",
        scope: "mcp"
      },
      { sleep: async () => undefined, onDeviceCode: (input) => codes.push(input) }
    );
    expect(token).toBe("tok_1");
    expect(polls).toBe(2);
    expect(codes[0]).toEqual({ userCode: "ABCD-EFGH", verificationUri: "https://contoh.test/aktivasi", expiresIn: 60 });
  });

  it("menolak device flow yang tidak pernah disetujui", async () => {
    const base = await serve((url, _body, response) => {
      if (url === "/device") {
        json(response, { device_code: "dev_2", user_code: "X", verification_uri: "u", interval: 1, expires_in: 1 });
        return;
      }
      json(response, { error: "access_denied" });
    });
    await expect(
      fetchOAuthToken("uji", {
        token_url: `${base}/token`,
        device_authorization_url: `${base}/device`,
        client_id: "klien"
      }, { sleep: async () => undefined })
    ).rejects.toThrow(/access_denied/);
  });
});
