import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import type { CookieMethodsServer } from "@supabase/ssr";

import * as performanceCore from "../lib/observability/performance-core.ts";
import * as routePolicy from "../lib/supabase/proxy-routes.ts";

const require = createRequire(import.meta.url);
require("next/dist/server/node-environment-baseline");
const nextServer: typeof import("next/server") = require("next/server");
const { unstable_doesMiddlewareMatch: doesProxyMatch }: typeof import("next/experimental/testing/server") =
  require("next/experimental/testing/server");

// Execute the real proxy and cookie adapter with real NextRequest/NextResponse.
// Only the Supabase transport is stubbed; no env files or remote services are used.
function loadModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const { outputText } = transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } },
  );
  const exports = {};
  compileFunction(outputText, ["exports", "require", "process"])(
    exports,
    (specifier: string) => {
      assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected import: ${specifier}`);
      return dependencies[specifier];
    },
    {
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://auth.test.invalid",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-key",
        PERFORMANCE_TELEMETRY_ENABLED: "true",
      },
    },
  );
  return exports as T;
}

function proxyHarness({ refresh = false, failAuth = false } = {}) {
  const calls = { claims: 0, clients: 0 };
  const authProxy = loadModule<typeof import("../lib/supabase/proxy.ts")>(
    "../lib/supabase/proxy.ts",
    {
      "next/server": nextServer,
      "@/lib/observability/performance-core": performanceCore,
      "@supabase/ssr": {
        createServerClient: (_url: string, _key: string, options: { cookies: CookieMethodsServer }) => {
          calls.clients += 1;
          return {
            auth: {
              async getClaims() {
                calls.claims += 1;
                if (failAuth) throw new Error("Auth transport must not run on public routes.");
                if (refresh) {
                  const cookies = await options.cookies.getAll();
                  assert.ok(cookies?.some((cookie) => cookie.value === "expired-session"));
                  await options.cookies.setAll?.(
                    [
                      { name: "sb-test-auth-token.0", value: "refreshed-session", options: { path: "/", sameSite: "lax", secure: true } },
                      { name: "sb-test-auth-token.1", value: "", options: { path: "/", maxAge: 0 } },
                    ],
                    { "Cache-Control": "private, no-store" },
                  );
                }
                return { data: { claims: null }, error: null };
              },
            },
          };
        },
      },
    },
  );
  const entry = loadModule<typeof import("../proxy.ts")>("../proxy.ts", {
    "next/server": nextServer,
    "@/lib/observability/performance-core": performanceCore,
    "@/lib/supabase/proxy": authProxy,
    "@/lib/supabase/proxy-routes": routePolicy,
  });
  return { ...entry, calls };
}

const publicRoutes = [
  "/",
  "/assessment",
  "/assessment/test-token",
  "/assessment/test-token/profile",
  "/assessment/test-token/test/session?section=2",
  "/assessment/test-token/complete",
  "/employee-assessment",
  "/employee-assessment/test-token",
  "/employee-assessment/test-token/profile",
  "/employee-assessment/test-token/test/session?section=2",
  "/employee-assessment/test-token/complete",
  "/api/assessment/session-control",
  "/api/assessment/session-control/",
  "/api/telemetry/performance",
  "/api/tests/import-schema?version=v2",
  "/api/candidates/import-template",
];

const authRoutes = [
  "/dashboard",
  "/dashboard/",
  "/dashboard/jobs/job-id/compare",
  "/admin",
  "/admin/tests/test-id/builder",
  "/admin/login",
  "/admin/register",
  "/admin/accept-invitation",
  "/admin/access-pending",
  "/login?mode=signup",
  "/onboarding",
  "/invite/company?organizationId=test-company",
  "/auth/confirm?type=invite",
];

test("public pages and API skip Auth even with stale HR cookies and an unavailable Auth service", async () => {
  const harness = proxyHarness({ failAuth: true });
  for (const route of publicRoutes) {
    for (const cookie of ["", "sb-test-auth-token.0=expired-session"]) {
      for (const method of ["GET", "POST"]) {
        const request = new nextServer.NextRequest(`https://talvia.test${route}`, {
          headers: { cookie },
          method,
        });
        const response = await harness.proxy(request);
        const requestId = response.headers.get("x-request-id");
        assert.equal(response.status, 200, route);
        assert.equal(response.headers.get("x-middleware-next"), "1", route);
        assert.match(requestId!, /^req_[0-9a-f-]{36}$/, route);
        assert.equal(response.headers.get("x-middleware-request-x-request-id"), requestId, route);
        assert.equal(response.headers.get("x-middleware-request-cookie"), cookie, route);
        assert.equal(response.headers.get("set-cookie"), null, route);
        assert.equal(response.headers.get("server-timing"), null, route);
      }
    }
  }
  assert.deepEqual(harness.calls, { claims: 0, clients: 0 });
});

test("HR, admin and invitation routes retain Auth refresh and forward refreshed cookies", async () => {
  const harness = proxyHarness({ refresh: true });
  const requestId = "req_0198f2ce-0b34-7abc-8def-1234567890ab";
  for (const route of authRoutes) {
    for (const method of ["GET", "POST"]) {
      const request = new nextServer.NextRequest(`https://talvia.test${route}`, {
        headers: {
          cookie: "sb-test-auth-token.0=expired-session; sb-test-auth-token.1=old-chunk; preference=keep",
          "x-request-id": requestId,
        },
        method,
      });
      const response = await harness.proxy(request);
      assert.equal(response.cookies.get("sb-test-auth-token.0")?.value, "refreshed-session", route);
      assert.equal(response.cookies.get("sb-test-auth-token.0")?.secure, true, route);
      assert.equal(response.cookies.get("sb-test-auth-token.1")?.maxAge, 0, route);
      const forwardedCookies = response.headers.get("x-middleware-request-cookie")!;
      assert.match(forwardedCookies, /sb-test-auth-token.0=refreshed-session/, route);
      assert.match(forwardedCookies, /preference=keep/, route);
      assert.doesNotMatch(forwardedCookies, /expired-session|old-chunk/, route);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store", route);
      assert.equal(response.headers.get("x-request-id"), requestId, route);
      assert.equal(response.headers.get("x-middleware-request-x-request-id"), requestId, route);
      assert.match(response.headers.get("server-timing")!, /^auth;dur=/, route);
    }
  }
  assert.deepEqual(harness.calls, { claims: authRoutes.length * 2, clients: authRoutes.length * 2 });
});

test("Auth refresh scope uses complete path segments", () => {
  for (const route of ["/dashboard-public", "/administrator", "/login-help", "/onboarding-info", "/invite/company-info", "/author"]) {
    assert.equal(routePolicy.shouldRefreshAuthSession(route), false, route);
  }
});

test("Next matcher retains correlation on application routes and skips static assets", () => {
  const { config } = proxyHarness();
  for (const url of [...publicRoutes, ...authRoutes]) {
    assert.equal(doesProxyMatch({ config, url }), true, url);
  }
  for (const url of ["/_next/static/chunks/app.js", "/_next/image?url=logo.png&w=64&q=75", "/favicon.ico", "/logo.svg", "/photo.webp"]) {
    assert.equal(doesProxyMatch({ config, url }), false, url);
  }
});
