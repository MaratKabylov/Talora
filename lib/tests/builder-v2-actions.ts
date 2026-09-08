"use server";
import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth/context";
import { requirePlatformContext } from "@/lib/admin/context";
import { canManageSystemTests } from "@/lib/admin/constants";
import { canManageTests } from "./constants";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { saveBuilderV2, publishBuilderV2 } from "./builder-v2-service";
import type { BuilderPublishRequest, BuilderSaveRequest, BuilderV2Result } from "./builder-delta";

const denied = (): BuilderV2Result => ({ ok: false, code: "unavailable", error: "У вашей роли нет права редактировать этот тест." });
export async function saveCompanyBuilderV2Action(input: BuilderSaveRequest): Promise<BuilderV2Result> {
  const context = await requireCompanyContext();
  if (!canManageTests(context.activeCompany.role)) return denied();
  return measureServerOperation("builder.save", () => saveBuilderV2({ userId: context.user.id, companyId: context.activeCompany.id }, input));
}
export async function saveSystemBuilderV2Action(input: BuilderSaveRequest): Promise<BuilderV2Result> {
  const context = await requirePlatformContext();
  if (!canManageSystemTests(context.role)) return denied();
  return measureServerOperation("builder.save", () => saveBuilderV2({ userId: context.user.id, companyId: null }, input));
}
export async function publishCompanyBuilderV2Action(input: BuilderPublishRequest): Promise<BuilderV2Result> {
  const context = await requireCompanyContext();
  if (!canManageTests(context.activeCompany.role)) return denied();
  const result = await publishBuilderV2({ userId: context.user.id, companyId: context.activeCompany.id }, input);
  if (result.ok) { revalidatePath(`/dashboard/tests/${input.templateId}`); revalidatePath("/dashboard/tests"); }
  return result;
}
export async function publishSystemBuilderV2Action(input: BuilderPublishRequest): Promise<BuilderV2Result> {
  const context = await requirePlatformContext();
  if (!canManageSystemTests(context.role)) return denied();
  const result = await publishBuilderV2({ userId: context.user.id, companyId: null }, input);
  if (result.ok) { revalidatePath(`/admin/tests/${input.templateId}`); revalidatePath("/admin/tests"); revalidatePath("/dashboard/tests"); }
  return result;
}
