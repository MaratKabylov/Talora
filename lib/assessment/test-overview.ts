import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { normalizePresentationSettings } from "@/lib/tests/presentation-settings";
import type { AssessmentAvailability } from "./data";
import type { EmployeeAssessmentAvailability } from "@/lib/employee-assessments/public-data";

const unavailableSchema = z.object({
  availability: z.enum(["invalid", "expired", "cancelled", "completed", "needs_consent"]),
});
const activeSchema = z.object({
  availability: z.literal("active"),
  companyName: z.string(),
  contextTitle: z.string(),
  sessionCount: z.number().int().positive(),
  completedSessionCount: z.number().int().nonnegative(),
  nextSessionId: z.string().uuid().nullable(),
  session: z.object({
    id: z.string().uuid(),
    status: z.enum(["not_started", "in_progress", "completed", "expired", "cancelled"]),
    deadlineAt: z.string().nullable(),
    test: z.object({
      title: z.string(),
      description: z.string().nullable(),
      instructions: z.string().nullable(),
      presentationSettings: z.unknown().transform(normalizePresentationSettings),
    }),
  }),
});
const overviewSchema = z.union([unavailableSchema, activeSchema]);
export type AssessmentTestOverview = z.infer<typeof overviewSchema>;
type LegacyOverview = AssessmentAvailability | EmployeeAssessmentAvailability;
type OverviewRequest = { assessmentType: "candidate" | "employee"; token: string; sessionId: string };

// Whitelist even legacy objects: no participant profile, package or other test content.
export function projectLegacyTestOverview(overview: LegacyOverview, sessionId: string): AssessmentTestOverview {
  if (overview.availability !== "active") return { availability: overview.availability };
  if (!overview.consentGivenAt) return { availability: "needs_consent" };
  const session = overview.sessions.find(entry => entry.id === sessionId);
  if (!session) return { availability: "invalid" };
  return {
    availability: "active",
    companyName: overview.companyName,
    contextTitle: "job" in overview ? overview.job.title : overview.assessment.title,
    sessionCount: overview.sessions.length,
    completedSessionCount: overview.sessions.filter(entry => entry.status === "completed").length,
    nextSessionId: overview.sessions.find(entry => entry.status === "in_progress")?.id ?? null,
    session: {
      id: session.id, status: session.status, deadlineAt: session.deadlineAt,
      test: {
        title: session.test.title, description: session.test.description, instructions: session.test.instructions,
        presentationSettings: normalizePresentationSettings(session.test.presentationSettings),
      },
    },
  };
}

export async function getAssessmentTestOverview(request: OverviewRequest, legacyRead: () => Promise<LegacyOverview>): Promise<AssessmentTestOverview> {
  if (process.env.ASSESSMENT_OVERVIEW_V2 !== "true") {
    return projectLegacyTestOverview(await legacyRead(), request.sessionId);
  }
  if (!/^[a-f0-9]{64}$/i.test(request.token) || !z.string().uuid().safeParse(request.sessionId).success) {
    return { availability: "invalid" };
  }
  return measureServerOperation("assessment.load_test_overview", async () => {
    const { data, error } = await createAdminClient().rpc("read_assessment_test_overview_v2", {
      p_scope: request.assessmentType, p_token: request.token, p_session_id: request.sessionId,
    });
    if (error) throw new Error("Unable to load the assessment test overview.");
    const parsed = overviewSchema.safeParse(data);
    if (!parsed.success) throw new Error("Unexpected assessment test overview response.");
    const overview = parsed.data;
    if (overview.availability !== "active") return overview;
    if (overview.session.id !== request.sessionId.toLowerCase() || overview.completedSessionCount > overview.sessionCount) {
      throw new Error("Inconsistent assessment test overview response.");
    }
    return { ...overview, session: { ...overview.session, test: { ...overview.session.test,
      description: sanitizeRichTextValue(overview.session.test.description),
      instructions: sanitizeRichTextValue(overview.session.test.instructions),
    } } };
  });
}
