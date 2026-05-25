"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ACTIVE_COMPANY_COOKIE } from "@/lib/company/constants";
import { requireAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().trim().email("Введите корректный email."),
  password: z.string().min(8, "Пароль должен содержать минимум 8 символов."),
});

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(2, "Укажите имя.").max(120, "Имя слишком длинное."),
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Укажите имя.").max(120, "Имя слишком длинное."),
  phone: z.string().trim().max(40, "Номер телефона слишком длинный.").optional(),
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

function getEmailRedirectTo() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return appUrl ? new URL("/auth/confirm?next=/onboarding", appUrl).toString() : undefined;
}

export async function signInAction(formData: FormData) {
  const parsed = credentialsSchema.safeParse({
    email: formString(formData, "email"),
    password: formString(formData, "password"),
  });

  if (!parsed.success) {
    redirectWithFeedback("/login", "error", parsed.error.issues[0].message);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    redirectWithFeedback("/login", "error", "Не удалось войти. Проверьте email и пароль.");
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUpAction(formData: FormData) {
  const parsed = signUpSchema.safeParse({
    email: formString(formData, "email"),
    fullName: formString(formData, "fullName"),
    password: formString(formData, "password"),
  });

  if (!parsed.success) {
    redirectWithFeedback("/login?mode=signup", "error", parsed.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: getEmailRedirectTo(),
    },
  });

  if (error) {
    redirectWithFeedback("/login?mode=signup", "error", "Не удалось создать аккаунт.");
  }

  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/onboarding");
  }

  redirectWithFeedback(
    "/login",
    "message",
    "Аккаунт создан. Подтвердите email, затем войдите в систему.",
  );
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_COMPANY_COOKIE);

  revalidatePath("/", "layout");
  redirect("/login");
}

export async function updateProfileAction(formData: FormData) {
  const parsed = profileSchema.safeParse({
    fullName: formString(formData, "fullName"),
    phone: formString(formData, "phone"),
  });

  if (!parsed.success) {
    redirectWithFeedback("/dashboard/profile", "error", parsed.error.issues[0].message);
  }

  const context = await requireAuthContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: parsed.data.fullName,
      phone: parsed.data.phone || null,
    })
    .eq("id", context.user.id);

  if (error) {
    redirectWithFeedback("/dashboard/profile", "error", "Не удалось сохранить профиль.");
  }

  revalidatePath("/dashboard", "layout");
  redirectWithFeedback("/dashboard/profile", "message", "Профиль обновлен.");
}
