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

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z.string().max(maximum, "Значение слишком длинное.").nullable(),
  );

const companyProfileSchema = z.object({
  binOrIin: optionalText(32),
  city: optionalText(120),
  industry: optionalText(120),
  logoUrl: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z
      .string()
      .max(2048, "Ссылка на логотип слишком длинная.")
      .url("Введите корректную ссылку на логотип.")
      .refine((url) => ["http:", "https:"].includes(new URL(url).protocol), {
        message: "Ссылка на логотип должна начинаться с http:// или https://.",
      })
      .nullable(),
  ),
  name: z.string().trim().min(2, "Укажите название компании.").max(160, "Название слишком длинное."),
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
  if (!value || value.includes("\\") || value.includes("\r") || value.includes("\n")) {
    return "/dashboard";
  }

  try {
    const origin = "https://talora.local";
    const destination = new URL(value, origin);
    const isDashboardPath =
      destination.pathname === "/dashboard" || destination.pathname.startsWith("/dashboard/");

    return destination.origin === origin && isDashboardPath
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/dashboard";
  } catch {
    return "/dashboard";
  }
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

export async function updateCompanyProfileAction(formData: FormData) {
  const path = "/dashboard/profile";
  const parsed = companyProfileSchema.safeParse({
    binOrIin: formString(formData, "binOrIin"),
    city: formString(formData, "city"),
    industry: formString(formData, "industry"),
    logoUrl: formString(formData, "logoUrl"),
    name: formString(formData, "name"),
  });

  if (!parsed.success) {
    redirectWithFeedback(path, "error", parsed.error.issues[0].message);
  }

  const context = await requireAuthContext();
  if (!context.activeCompany) {
    redirect("/onboarding");
  }

  const supabase = await createClient();
  const { data: canEditOrganization, error: permissionError } = await supabase.rpc(
    "is_company_admin",
    {
      target_company_id: context.activeCompany.id,
    },
  );

  if (permissionError || canEditOrganization !== true) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять данные организации.");
  }

  const { data: updatedCompany, error } = await supabase
    .from("companies")
    .update({
      bin_or_iin: parsed.data.binOrIin,
      city: parsed.data.city,
      industry: parsed.data.industry,
      logo_url: parsed.data.logoUrl,
      name: parsed.data.name,
    })
    .eq("id", context.activeCompany.id)
    .select("id")
    .maybeSingle();

  if (error || !updatedCompany) {
    redirectWithFeedback(path, "error", "Не удалось сохранить данные организации.");
  }

  revalidatePath("/dashboard", "layout");
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Данные организации обновлены.");
}
