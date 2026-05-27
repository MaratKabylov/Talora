import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/auth/actions";
import { requireCompanyContext } from "@/lib/auth/context";
import { updateCompanyProfileAction } from "@/lib/company/actions";
import { createClient } from "@/lib/supabase/server";

type ProfileSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

type OrganizationRecord = {
  bin_or_iin: string | null;
  city_id: string | null;
  industry: string | null;
  logo_url: string | null;
  name: string;
  system_cities: { name: string } | { name: string }[] | null;
};

type SystemCityRecord = {
  id: string;
  is_active: boolean;
  name: string;
};

function first<T>(relation: T | T[] | null) {
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

function OrganizationField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value || "Не указано"}</dd>
    </div>
  );
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: ProfileSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const supabase = await createClient();
  const [
    { data: organization, error: organizationError },
    { data: canEditOrganization, error: organizationPermissionError },
    { data: cities, error: citiesError },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("name, bin_or_iin, industry, city_id, logo_url, system_cities(name)")
      .eq("id", context.activeCompany.id)
      .maybeSingle(),
    supabase.rpc("is_company_admin", { target_company_id: context.activeCompany.id }),
    supabase.from("system_cities").select("id, name, is_active").order("name"),
  ]);

  if (organizationError || organizationPermissionError || citiesError || !organization) {
    throw new Error("Unable to load organization profile.");
  }

  const company = organization as OrganizationRecord;
  const cityName = first(company.system_cities)?.name ?? null;
  const selectableCities = ((cities ?? []) as SystemCityRecord[]).filter(
    (city) => city.is_active || city.id === company.city_id,
  );
  const isOrganizationEditor = canEditOrganization === true;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Аккаунт</p>
        <h1 className="text-3xl font-semibold tracking-tight">Профиль</h1>
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      <Card>
        <CardHeader>
          <CardTitle>Контактные данные</CardTitle>
          <CardDescription>
            Email управляется через Supabase Auth; имя и телефон можно обновить здесь.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form action={updateProfileAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                disabled
                id="email"
                value={context.profile?.email ?? context.user.email ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Имя</Label>
              <Input
                defaultValue={context.profile?.fullName ?? ""}
                id="fullName"
                name="fullName"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Телефон</Label>
              <Input
                defaultValue={context.profile?.phone ?? ""}
                id="phone"
                name="phone"
                type="tel"
              />
            </div>
            <Button type="submit">Сохранить профиль</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Организация</CardTitle>
          <CardDescription>
            Данные компании используются в workspace и будут показываться кандидатам в тестах.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isOrganizationEditor ? (
            <form action={updateCompanyProfileAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="organizationName">Название организации</Label>
                <Input
                  defaultValue={company.name}
                  id="organizationName"
                  name="name"
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="binOrIin">БИН / ИИН</Label>
                  <Input
                    defaultValue={company.bin_or_iin ?? ""}
                    id="binOrIin"
                    name="binOrIin"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industry">Отрасль</Label>
                  <Input
                    defaultValue={company.industry ?? ""}
                    id="industry"
                    name="industry"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cityName">Город</Label>
                  <Input
                    autoComplete="off"
                    defaultValue={cityName ?? ""}
                    id="cityName"
                    list="organization-city-options"
                    name="cityName"
                    placeholder="Начните вводить город"
                  />
                  <datalist id="organization-city-options">
                    {selectableCities.map((city) => (
                      <option key={city.id} value={city.name} />
                    ))}
                  </datalist>
                  <p className="text-sm text-muted-foreground">
                    Начните вводить название и выберите город из списка.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <Label htmlFor="logoFile">Логотип</Label>
                {company.logo_url ? (
                  <div className="flex items-center gap-4 rounded-md border p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- logo host is configured per Supabase project. */}
                    <img
                      alt={`Логотип ${company.name}`}
                      className="h-14 max-w-36 rounded object-contain"
                      src={company.logo_url}
                    />
                    <p className="text-sm text-muted-foreground">
                      Выберите новый файл, чтобы заменить текущий логотип.
                    </p>
                  </div>
                ) : null}
                <Input
                  accept="image/png,image/jpeg,image/webp"
                  id="logoFile"
                  name="logoFile"
                  type="file"
                />
                <p className="text-sm text-muted-foreground">
                  PNG, JPEG или WebP, не более 2 МБ.
                </p>
              </div>
              <Button type="submit">Сохранить организацию</Button>
            </form>
          ) : (
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <OrganizationField label="Название организации" value={company.name} />
                <OrganizationField label="БИН / ИИН" value={company.bin_or_iin} />
                <OrganizationField label="Отрасль" value={company.industry} />
                <OrganizationField label="Город" value={cityName} />
              </dl>
              {company.logo_url ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Логотип</p>
                  {/* eslint-disable-next-line @next/next/no-img-element -- logo host is configured per Supabase project. */}
                  <img
                    alt={`Логотип ${company.name}`}
                    className="h-16 max-w-40 rounded object-contain"
                    src={company.logo_url}
                  />
                </div>
              ) : (
                <OrganizationField label="Логотип" value={null} />
              )}
              <p className="text-sm text-muted-foreground">
                Редактирование доступно владельцу и администраторам организации.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
