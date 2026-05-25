"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { canManageCandidates } from "@/lib/candidates/constants";
import { createClient } from "@/lib/supabase/server";

const shortlistSchema = z.object({
  applicationId: z.string().uuid(),
  jobId: z.string().uuid(),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getComparisonPath(jobId: string) {
  return `/dashboard/jobs/${jobId}/compare`;
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const params = new URLSearchParams({ [type]: text });
  redirect(`${path}?${params.toString()}`);
}

export async function addApplicationToShortlistAction(formData: FormData) {
  const parsed = shortlistSchema.safeParse({
    applicationId: formString(formData, "applicationId"),
    jobId: formString(formData, "jobId"),
  });

  if (!parsed.success) {
    redirect("/dashboard/jobs");
  }

  const path = getComparisonPath(parsed.data.jobId);
  const context = await requireCompanyContext();

  if (!canManageCandidates(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять шорт-лист.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_application_to_shortlist", {
    target_application_id: parsed.data.applicationId,
    target_company_id: context.activeCompany.id,
    target_job_id: parsed.data.jobId,
  });

  if (error) {
    redirectWithFeedback(path, "error", "В шорт-лист можно добавить завершившего оценку кандидата.");
  }

  revalidatePath(path);
  revalidatePath(`/dashboard/jobs/${parsed.data.jobId}`);
  revalidatePath("/dashboard/candidates");
  redirectWithFeedback(path, "message", "Кандидат добавлен в шорт-лист.");
}
