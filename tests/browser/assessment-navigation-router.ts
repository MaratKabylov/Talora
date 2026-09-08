// Synthetic router transport. Real App Router/RSC behavior requires staging E2E.
export const routerTransitions: string[] = [];
const router = { replace(path: string) { routerTransitions.push(path); window.history.replaceState(null, "", path); } };
export function useRouter() { return router; }
