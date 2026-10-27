// Source-only configuration checks: no Compose expansion, secrets or provider access.
import { test, expect } from "@jest/globals";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = name => readFileSync(path.join(root, name), "utf8");
const compose = read("docker-compose.yml");
const voice = compose.split("\n  voice:\n")[1].split("\nvolumes:\n")[0];

test.each([
  ["LIVE_ENABLED", "INTAKE_V2_ENABLED", "false"],
  ["LIVE_API_KEY", "VOICE_GEMINI_API_KEY", ""],
  ["LIVE_MODEL", "VOICE_LIVE_MODEL", ""],
  ["LIVE_BOOTSTRAP_SECRET", "VOICE_LIVE_BOOTSTRAP_SECRET", ""],
  ["LIVE_FREE_TIER_ATTESTED", "VOICE_LIVE_FREE_TIER_ATTESTED", "false"],
])("Compose maps %s only from its dedicated runtime setting", (target, source, fallback) => {
  expect(voice).toContain(`      ${target}: \u0024{${source}:-${fallback}}`);
});

test("server admission config and bounded one-worker voice deployment remain explicit", () => {
  expect(compose).toContain("      VOICE_LIVE_INTERNAL_URL: http://voice:8000");
  expect(voice).toContain("      LIVE_CAPABILITY_TTL_SECONDS: 300");
  expect(voice).toContain("      LIVE_MAX_SESSIONS: 1");
  expect(voice).toContain("    stop_grace_period: 50s");
  expect(voice).not.toMatch(/recordings|VOICE_WEBHOOK_SECRET|replicas:|--workers/);
  const example = read(".env.example");
  expect(example).toContain("INTAKE_V2_ENABLED=false");
  expect(example).toContain("VOICE_LIVE_MODEL=\n");
  expect(example).toContain("VOICE_LIVE_FREE_TIER_ATTESTED=false");
});

test("frontend build inputs contain no voice credentials or direct Python URL", () => {
  for (const name of ["frontend/Dockerfile", "frontend/.env.example", ".github/workflows/deploy.yml"]) {
    const contents = read(name);
    expect(contents).not.toMatch(/REACT_APP_VOICE_SERVICE_URL|VOICE_GEMINI_API_KEY|VOICE_LIVE_BOOTSTRAP_SECRET|LIVE_API_KEY/);
  }
  for (const name of ["frontend/.dockerignore", "backend/.dockerignore"]) expect(read(name)).toMatch(/^\.env\*/m);
  const frontend = compose.split("\n  frontend:\n")[1].split("\n  weaviate:\n")[0];
  expect(frontend).not.toMatch(/VOICE_|LIVE_API_KEY|LIVE_BOOTSTRAP_SECRET/);
});

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const name = path.join(dir, item.name);
    return item.isDirectory() ? sources(name) : /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [name] : [];
  });
}
test("only the reviewed Live browser path remains; no retired calls or barrel exports", () => {
  for (const name of sources(path.join(root, "frontend/src"))) {
    expect(readFileSync(name, "utf8")).not.toMatch(/\/api\/v1\/sessions|\/api\/v1\/ws\/|VOICE_SERVICE_URL/);
  }
  expect(existsSync(path.join(root, "frontend/src/components/VoiceInterview/VoiceInterviewPanel.tsx"))).toBe(false);
  expect(existsSync(path.join(root, "frontend/src/components/VoiceInterview/index.ts"))).toBe(false);
  expect(read("frontend/src/components/ClientDashboard/Sections/StartCaseSection.tsx")).toContain('from "../../VoiceInterview/ReviewedIntakePanel"');
});
