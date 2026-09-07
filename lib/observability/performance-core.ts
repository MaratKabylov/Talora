export const CLIENT_PERFORMANCE_OPERATIONS = [
  "assessment.autosave",
  "assessment.claim",
  "assessment.complete",
  "assessment.event",
  "assessment.expire",
  "assessment.heartbeat",
  "assessment.section_navigation",
  "builder.autosave",
  "navigation.document",
] as const;

export const WEB_VITAL_NAMES = ["CLS", "FCP", "INP", "LCP", "TTFB"] as const;

export type ClientPerformanceOperation = (typeof CLIENT_PERFORMANCE_OPERATIONS)[number];
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];
export type PerformanceOutcome = "failure" | "success";

const CORRELATION_ID_PATTERN = /^req_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_SEGMENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_SEGMENT_PATTERN = /^[0-9a-f]{64}$/i;

export function correlationIdFrom(value: string | null | undefined) {
  return value && CORRELATION_ID_PATTERN.test(value) ? value : `req_${crypto.randomUUID()}`;
}

export function roundDuration(value: number) {
  return Math.max(0, Math.round(value * 100) / 100);
}

export function sanitizeRoutePath(pathname: string) {
  const safePath = pathname.split("?", 1)[0]?.slice(0, 512) || "/";
  const segments = safePath.split("/").map((segment) => {
    if (TOKEN_SEGMENT_PATTERN.test(segment)) return "[token]";
    if (UUID_SEGMENT_PATTERN.test(segment)) return "[id]";
    return segment.replace(/[^A-Za-z0-9._~!$&'()*+,;=:@%-]/g, "-").slice(0, 80);
  });

  return segments.join("/") || "/";
}

export function serverTimingValue(name: string, durationMs: number) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "operation";
  return `${safeName};dur=${roundDuration(durationMs)}`;
}
