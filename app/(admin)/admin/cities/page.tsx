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
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Город</th>
                    <th className="w-44 px-4 py-3 font-medium">Статус</th>
                    <th className="w-32 px-4 py-3 font-medium">Компании</th>
                    {mayOperate ? (
                      <th className="w-36 px-4 py-3 text-right font-medium">Действия</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {cities.map((city) => (
                    <tr className="border-t" key={city.id}>
                      {mayOperate ? (
                        <>
                          <td className="px-4 py-2">
                            <Input
                              className="h-9"
                              defaultValue={city.name}
                              form={`city-form-${city.id}`}
                              id={`city-name-${city.id}`}
                              name="name"
                              required
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Select
                              className="h-9"
                              defaultValue={String(city.is_active)}
                              form={`city-form-${city.id}`}
                              id={`city-status-${city.id}`}
                              name="isActive"
                            >
                              <option value="true">Активен</option>
                              <option value="false">Отключен</option>
                            </Select>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 font-medium">{city.name}</td>
                          <td className="px-4 py-3">
                            {city.is_active ? "Активен" : "Отключен"}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3">{relationCount(city.companies)}</td>
                      {mayOperate ? (
                        <td className="px-4 py-2 text-right">
                          <form action={updateSystemCityAction} id={`city-form-${city.id}`}>
                            <input name="cityId" type="hidden" value={city.id} />
                            <Button size="sm" type="submit" variant="outline">
                              Сохранить
                            </Button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
