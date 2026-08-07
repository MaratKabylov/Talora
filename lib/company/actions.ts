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

const COMPANY_LOGOS_BUCKET = "company-logos";
const COMPANY_LOGO_MAX_SIZE = 2 * 1024 * 1024;
const COMPANY_LOGO_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  cityName: optionalText(120),
  industry: optionalText(120),
  name: z.string().trim().min(2, "Укажите название компании.").max(160, "Название слишком длинное."),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function formFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

function normalizeCityName(value: string) {
  return value.trim().toLocaleLowerCase("ru-RU");
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
    const origin = "https://talvia.local";
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
    cityName: formString(formData, "cityName"),
    industry: formString(formData, "industry"),
    name: formString(formData, "name"),
  });

  if (!parsed.success) {
    redirectWithFeedback(path, "error", parsed.error.issues[0].message);
  }

  const logoFile = formFile(formData, "logoFile");
  if (logoFile && !COMPANY_LOGO_MIME_TYPES.has(logoFile.type)) {
    redirectWithFeedback(path, "error", "Загрузите логотип в формате PNG, JPEG или WebP.");
  }

  if (logoFile && logoFile.size > COMPANY_LOGO_MAX_SIZE) {
    redirectWithFeedback(path, "error", "Размер логотипа не должен превышать 2 МБ.");
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

  let cityId: string | null = null;
  if (parsed.data.cityName) {
    const [{ data: cities, error: cityError }, { data: currentCompany, error: companyError }] =
      await Promise.all([
        supabase
          .from("system_cities")
          .select("id, name, is_active"),
        supabase
          .from("companies")
          .select("city_id")
          .eq("id", context.activeCompany.id)
          .maybeSingle(),
      ]);
    const selectedCity = cities?.find(
      (city) => normalizeCityName(city.name) === normalizeCityName(parsed.data.cityName!),
    );

    if (
      cityError ||
      companyError ||
      !selectedCity ||
      (!selectedCity.is_active && currentCompany?.city_id !== selectedCity.id)
    ) {
      redirectWithFeedback(path, "error", "Выберите доступный город из справочника.");
    }

    cityId = selectedCity.id;
  }

  let logoUrl: string | undefined;
  if (logoFile) {
    const logoPath = `${context.activeCompany.id}/logo`;
    const { error: uploadError } = await supabase.storage
      .from(COMPANY_LOGOS_BUCKET)
      .upload(logoPath, logoFile, {
        cacheControl: "0",
        contentType: logoFile.type,
        upsert: true,
      });

    if (uploadError) {
      redirectWithFeedback(path, "error", "Не удалось загрузить логотип организации.");
    }

    logoUrl = supabase.storage.from(COMPANY_LOGOS_BUCKET).getPublicUrl(logoPath).data.publicUrl;
  }

  const organizationChanges: {
    bin_or_iin: string | null;
    city_id: string | null;
    industry: string | null;
    logo_url?: string;
    name: string;
  } = {
    bin_or_iin: parsed.data.binOrIin,
    city_id: cityId,
    industry: parsed.data.industry,
    name: parsed.data.name,
  };

  if (logoUrl) {
    organizationChanges.logo_url = logoUrl;
  }

  const { data: updatedCompany, error } = await supabase
    .from("companies")
    .update(organizationChanges)
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
