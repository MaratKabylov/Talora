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
  city: string | null;
  industry: string | null;
  logo_url: string | null;
  name: string;
};

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
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("name, bin_or_iin, industry, city, logo_url")
      .eq("id", context.activeCompany.id)
      .maybeSingle(),
    supabase.rpc("is_company_admin", { target_company_id: context.activeCompany.id }),
  ]);

  if (organizationError || organizationPermissionError || !organization) {
    throw new Error("Unable to load organization profile.");
  }

  const company = organization as OrganizationRecord;
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
            Данные компании используются в workspace и в приглашениях кандидатов.
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
                  <Label htmlFor="city">Город</Label>
                  <Input defaultValue={company.city ?? ""} id="city" name="city" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="logoUrl">Ссылка на логотип</Label>
                  <Input
                    defaultValue={company.logo_url ?? ""}
                    id="logoUrl"
                    name="logoUrl"
                    placeholder="https://..."
                    type="url"
                  />
                </div>
              </div>
              <Button type="submit">Сохранить организацию</Button>
            </form>
          ) : (
            <div className="space-y-5">
              <dl className="grid gap-4 sm:grid-cols-2">
                <OrganizationField label="Название организации" value={company.name} />
                <OrganizationField label="БИН / ИИН" value={company.bin_or_iin} />
                <OrganizationField label="Отрасль" value={company.industry} />
                <OrganizationField label="Город" value={company.city} />
                <OrganizationField label="Ссылка на логотип" value={company.logo_url} />
              </dl>
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
