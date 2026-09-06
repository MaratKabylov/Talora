/**
 * Routes whose pages/actions use an HR or platform Auth session. This controls
 * cookie refresh only; authorization stays in server actions, readers and RLS.
 * Add new authenticated route roots here when they are introduced.
 */
const AUTH_SESSION_ROUTE_ROOTS = [
  "/dashboard",
  "/admin",
  "/login",
  "/onboarding",
  "/invite/company",
  "/auth",
] as const;

export function shouldRefreshAuthSession(pathname: string) {
  return AUTH_SESSION_ROUTE_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}
