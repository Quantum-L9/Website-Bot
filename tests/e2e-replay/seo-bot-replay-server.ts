// L9_META: layer=test_support, role=e2e_replay_seo_bot_server, status=active, version=1.0.0
//
// Loopback stand-in for SEO-Bot's build-intelligence API. It answers only the
// routes recorded under fixtures/replay/seo-bot/, requires the machine bearer
// the pipeline must send, and records every request so the test can assert
// the exact call sequence. Anything else is a 404 the pipeline fails on.

import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
  type IntelligenceArtifactType,
  type IntelligenceProducer,
  type PageContentContractArtifact,
  refForArtifact,
  sealIntelligenceArtifact,
} from "@quantum-l9/bot-interop";

interface StaticFixture {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

interface BoundFixture {
  method: string;
  path: string;
  status: number;
  /** Request field holding the sealed Website-Bot artifact this response binds to. */
  bind: "page_content_contract";
  seal: {
    artifact_type: IntelligenceArtifactType;
    client_id: string;
    build_id: string;
    producer: { repo: IntelligenceProducer; version: string };
    produced_at: string;
  };
  payload: Record<string, unknown>;
}

type Fixture = (StaticFixture | BoundFixture) & { name: string };

export interface ReplayedRequest {
  method: string;
  path: string;
  fixture?: string;
  authorized: boolean;
}

export interface SeoBotReplayServer {
  url: string;
  requests: ReplayedRequest[];
  close(): Promise<void>;
}

function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(dir, name), "utf-8")) }) as Fixture);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function respond(fixture: Fixture, rawBody: string): unknown {
  if (!("bind" in fixture)) return fixture.body;
  const request = JSON.parse(rawBody) as { page_content_contract: PageContentContractArtifact };
  const contractRef = refForArtifact(request.page_content_contract);
  return sealIntelligenceArtifact({
    ...fixture.seal,
    input_refs: [contractRef],
    payload: { ...fixture.payload, page_content_contract_ref: contractRef },
  });
}

export async function startSeoBotReplayServer(
  fixturesDir: string,
  apiKey: string,
): Promise<SeoBotReplayServer> {
  const fixtures = loadFixtures(fixturesDir);
  const requests: ReplayedRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const rawBody = await readBody(request);
      const path = request.url ?? "";
      const authorized = request.headers.authorization === `Bearer ${apiKey}`;
      const fixture = fixtures.find(
        (candidate) => candidate.method === request.method && candidate.path === path,
      );
      // /health is public on the real service; everything else is machine-authenticated.
      const needsAuth = path !== "/health";
      requests.push({ method: request.method ?? "", path, fixture: fixture?.name, authorized });
      if (!fixture) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: `no replay fixture for ${request.method} ${path}` }));
        return;
      }
      if (needsAuth && !authorized) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "machine credential required" }));
        return;
      }
      response.writeHead(fixture.status, { "content-type": "application/json" });
      response.end(JSON.stringify(respond(fixture, rawBody)));
    })().catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
