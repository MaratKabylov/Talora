import { z } from "zod";
import { builderDocumentSchema, documentOptionSchema, documentQuestionSchema } from "./builder-document-schema";

const uuid = z.string().uuid().refine(v => v === v.toLowerCase(), "Ожидается стандартный UUID.");
export const builderRevisionSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/)
  .refine(v => /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= BigInt("9223372036854775807"));
const orderIndex = z.number().int().min(1).max(30000);
const section = builderDocumentSchema.shape.sections.element;
export const builderPublishRequestSchema = z.object({ templateId: uuid, versionId: uuid,
  expectedRevision: builderRevisionSchema, requestId: uuid }).strict();
export const builderSaveRequestSchema = builderPublishRequestSchema.extend({ delta: z.object({
  version: builderDocumentSchema.shape.version.strict().nullable(),
  sections: z.array(z.object(section.shape).omit({ questions: true }).extend({ id: uuid, orderIndex }).strict()).max(100),
  questions: z.array(z.object(documentQuestionSchema.shape).omit({ options: true })
    .extend({ id: uuid, sectionId: uuid, orderIndex }).strict()).max(30000),
  options: z.array(documentOptionSchema.extend({ id: uuid, questionId: uuid, orderIndex }).strict()).max(3000000),
  deletedSections: z.array(uuid).max(100), deletedQuestions: z.array(uuid).max(30000), deletedOptions: z.array(uuid).max(3000000),
}).strict() }).strict();
