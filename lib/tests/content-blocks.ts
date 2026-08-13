import { z } from "zod";

export const testContentBlockSchema = z.object({
  description: z.string().max(20000).nullable(),
  id: z.string().uuid(),
  orderIndex: z.number().int().min(0).max(100),
  positionIndex: z.number().int().min(0).max(300),
  title: z.string().trim().min(1).max(180),
});

export type TestContentBlock = z.infer<typeof testContentBlockSchema>;

const sectionSettingsSchema = z
  .object({
    contentBlocks: z.array(testContentBlockSchema).max(100).optional(),
  })
  .passthrough();

export function getTestContentBlocks(settings: unknown): TestContentBlock[] {
  const parsed = sectionSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return [];
  }

  return (parsed.data.contentBlocks ?? []).sort(
    (left, right) =>
      left.positionIndex - right.positionIndex || left.orderIndex - right.orderIndex,
  );
}

export function withTestContentBlocks(
  settings: unknown,
  contentBlocks: TestContentBlock[],
): Record<string, unknown> {
  const current =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};

  return { ...current, contentBlocks };
}
