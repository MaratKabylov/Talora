import { EmptyState } from "@/components/empty-state";
import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createSystemCityAction, updateSystemCityAction } from "@/lib/admin/actions";
import { canOperateCompanies } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { listSystemCities } from "@/lib/admin/data";

type SearchParams = Promise<{ error?: string; message?: string }>;

function relationCount(value: Array<{ count: number }>) {
  return value[0]?.count ?? 0;
}

export default async function AdminCitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const [feedback, context, cities] = await Promise.all([
    searchParams,
    requirePlatformContext(),
    listSystemCities(),
  ]);
  const mayOperate = canOperateCompanies(context.role);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Системный справочник</p>
        <h1 className="text-3xl font-semibold tracking-tight">Города Казахстана</h1>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      {mayOperate ? (
        <Card>
          <CardHeader>
            <CardTitle>Добавить город</CardTitle>
            <CardDescription>Города из справочника доступны для выбора в профиле организации.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={createSystemCityAction} className="flex max-w-lg items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="newCityName">Название</Label>
                <Input id="newCityName" name="name" placeholder="Алматы" required />
              </div>
              <Button type="submit">Добавить</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Список городов</CardTitle>
          <CardDescription>Всего записей: {cities.length}. Отключенные города остаются в профилях существующих организаций.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {cities.length === 0 ? (
            <EmptyState description="Добавьте первый город, чтобы организации могли выбрать его в профиле." title="Справочник пуст" />
          ) : (
            <div className="space-y-3">
              {cities.map((city) =>
                mayOperate ? (
                  <form
                    action={updateSystemCityAction}
                    className="grid items-end gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_10rem_8rem_auto]"
                    key={city.id}
                  >
                    <input name="cityId" type="hidden" value={city.id} />
                    <div className="space-y-2">
                      <Label htmlFor={`city-name-${city.id}`}>Название</Label>
                      <Input defaultValue={city.name} id={`city-name-${city.id}`} name="name" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`city-status-${city.id}`}>Статус</Label>
                      <Select defaultValue={String(city.is_active)} id={`city-status-${city.id}`} name="isActive">
                        <option value="true">Активен</option>
                        <option value="false">Отключен</option>
                      </Select>
                    </div>
                    <p className="pb-2 text-sm text-muted-foreground">
                      Компаний: {relationCount(city.companies)}
                    </p>
                    <Button type="submit" variant="outline">Сохранить</Button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between rounded-lg border p-4 text-sm" key={city.id}>
                    <span className="font-medium">{city.name}</span>
                    <span className="text-muted-foreground">
                      {city.is_active ? "Активен" : "Отключен"} / компаний: {relationCount(city.companies)}
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
