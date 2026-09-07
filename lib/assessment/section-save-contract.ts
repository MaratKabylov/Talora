import { z } from "zod";

export const sectionSaveSchema = z.object({
  assessmentType: z.enum(["candidate", "employee"]), token: z.string().regex(/^[a-f0-9]{64}$/i),
  sessionId: z.string().uuid(), clientId: z.string().uuid(), deviceId: z.string().uuid(),
  sectionId: z.string().uuid(), direction: z.enum(["next", "previous"]),
  answers: z.array(z.object({
    questionId: z.string().uuid(), timeSpentSeconds: z.number().int().min(0).max(604_800).optional(),
    answer: z.object({
      answerText: z.string().max(4000).nullable().optional(),
      selectedOptionId: z.string().uuid().nullable().optional(), scaleValue: z.number().int().nullable().optional(),
      mostOptionId: z.string().uuid().nullable().optional(), leastOptionId: z.string().uuid().nullable().optional(),
      selectedOptionIds: z.array(z.string().uuid()).max(100).optional(),
      orderedOptionIds: z.array(z.string().uuid()).max(100).optional(),
      matches: z.array(z.object({ optionId: z.string().uuid(), targetId: z.string().uuid() })).max(100).optional(),
    }),
  })).max(1000),
});

export const sectionSaveResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active"), deadlineAt: z.string().datetime({ offset: true }).nullable(),
    savedAt: z.string().datetime({ offset: true }), sectionIndex: z.number().int().nonnegative(),
    nextSectionIndex: z.number().int().nonnegative(), needsRemediation: z.boolean() }),
  z.object({ status: z.literal("blocked"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("unavailable") }), z.object({ status: z.literal("terminal") }),
  z.object({ status: z.literal("expired") }),
]);
export type SectionSaveRequest = z.infer<typeof sectionSaveSchema>;
export type SectionSaveResponse = z.infer<typeof sectionSaveResponseSchema>;
