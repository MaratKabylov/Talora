"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { activeCompanyCookieOptions, ACTIVE_COMPANY_COOKIE } from "@/lib/company/constants";
import { createClient } from "@/lib/supabase/server";

const firstCompanySchema = z.object({
  companyName: z.string().trim().min(2, "Укажите название компании.").max(160),
  fullName: z.string().trim().min(2, "Укажите ваше имя.").max(120),
});

const activeCompanySchema = z.object({
  companyId: z.string().uuid(),
  returnTo: z.string().optional(),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [type]: text });
  redirect(`${path}${separator}${params.toString()}`);
}

function safeReturnPath(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function createFirstCompanyAction(formData: FormData) {
  const parsed = firstCompanySchema.safeParse({
    companyName: formString(formData, "companyName"),
    fullName: formString(formData, "fullName"),
  });

  if (!parsed.success) {
    redirectWithFeedback("/onboarding", "error", parsed.error.issues[0].message);
  }

  await requireAuthContext();
  const supabase = await createClient();
  const { data: companyId, error } = await supabase.rpc("create_first_company", {
    company_name: parsed.data.companyName,
    profile_full_name: parsed.data.fullName,
  });

  if (error || typeof companyId !== "string") {
    redirectWithFeedback("/onboarding", "error", "Не удалось создать компанию.");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, companyId, activeCompanyCookieOptions);

  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

export async function selectActiveCompanyAction(formData: FormData) {
  const parsed = activeCompanySchema.safeParse({
    companyId: formString(formData, "companyId"),
    returnTo: formString(formData, "returnTo"),
  });

  if (!parsed.success) {
    redirect("/dashboard");
  }

  const context = await requireAuthContext();
  const company = context.companies.find((membership) => membership.id === parsed.data.companyId);

  if (!company) {
    redirectWithFeedback("/dashboard", "error", "Компания недоступна.");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, company.id, activeCompanyCookieOptions);

  revalidatePath("/dashboard", "layout");
  redirect(safeReturnPath(parsed.data.returnTo));
}

