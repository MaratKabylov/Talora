"use server";

import { z } from "zod";
import { getAuthContext } from "@/lib/auth/context";
import { getPlatformContext } from "@/lib/admin/context";
import { canManageSystemTests } from "@/lib/admin/constants";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canManageTests } from "./constants";
import { loadBuilderImportSource } from "./builder-import-data";
import type { BuilderImportResult } from "./builder-import-contract";

const schema = z.object({
  templateId: z.uuid(), versionId: z.uuid(), sourceTemplateId: z.uuid(), sourceVersionId: z.uuid(),
});

async function load(input: unknown, system: boolean): Promise<BuilderImportResult> {
  try {
    return await measureServerOperation("builder.import_source_content", async () => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) return { ok: false, error: "Некорректный источник импорта." };
      if (system) {
        const context = await getPlatformContext();
        if (!context || !canManageSystemTests(context.role)) return { ok: false, error: "Нет прав для импорта." };
        return loadBuilderImportSource(createAdminClient(), { kind: "system" }, parsed.data);
      }
      const context = await getAuthContext();
      if (!context?.activeCompany || !canManageTests(context.activeCompany.role)) {
        return { ok: false, error: "Нет прав для импорта." };
      }
      return loadBuilderImportSource(await createClient(),
        { kind: "company", companyId: context.activeCompany.id }, parsed.data);
    });
  } catch {
    return { ok: false, error: "Не удалось загрузить источник. Проверьте соединение и повторите попытку." };
  }
}

export async function loadCompanyBuilderImportSourceAction(input: unknown): Promise<BuilderImportResult> {
  return load(input, false);
}

export async function loadSystemBuilderImportSourceAction(input: unknown): Promise<BuilderImportResult> {
  return load(input, true);
}
