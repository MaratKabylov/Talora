import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { measureServerOperation } from "@/lib/observability/server-performance";

const receiptSchema = z.object({ versionId: z.string().uuid(), created: z.boolean() });
type CloneResult = { ok: true; versionId: string; created: boolean } | { ok: false; error: string };

function cloneError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (message.includes("TEST_CLONE_SOURCE_NOT_PUBLISHED")) {
    return "Копировать для редактирования можно только опубликованную версию.";
  }
  if (message.includes("TEST_CLONE_FORBIDDEN") || message.includes("TEST_CLONE_UNAVAILABLE")) {
    return "Тест недоступен для создания новой версии. Проверьте права и статус теста.";
  }
  if (message.includes("TEST_CLONE_INVALID_REFERENCE")) {
    return "В исходной версии обнаружена некорректная связь между вопросами или вариантами. Черновик не создан.";
  }
  return "Не удалось подтвердить создание черновика. Повторите попытку: существующий черновик откроется автоматически.";
}

export async function clonePublishedTestVersion(
  actor: { userId: string; companyId: string | null }, templateId: string, versionId: string,
): Promise<CloneResult> {
  try {
    // Authenticated server actions supply the actor; the RPC repeats role/tenant checks.
    const receipt = await measureServerOperation("builder.clone", async () => {
      const { data, error } = await createAdminClient().rpc("clone_published_test_version", {
        target_template_id: templateId, source_version_id: versionId,
        acting_user_id: actor.userId, target_company_id: actor.companyId,
      });
      if (error) throw error;
      return receiptSchema.parse(data);
    });
    return { ok: true, ...receipt };
  } catch (error) {
    return { ok: false, error: cloneError(error) };
  }
}
