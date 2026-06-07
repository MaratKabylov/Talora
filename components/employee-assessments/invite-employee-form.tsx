import { inviteEmployeeToAssessmentAction } from "@/lib/employee-assessments/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function defaultExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export function InviteEmployeeForm({ employeeAssessmentId }: { employeeAssessmentId: string }) {
  return (
    <form action={inviteEmployeeToAssessmentAction} className="space-y-5">
      <input name="employeeAssessmentId" type="hidden" value={employeeAssessmentId} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Имя сотрудника</Label>
          <Input id="fullName" name="fullName" placeholder="Айгерим Садыкова" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" placeholder="employee@example.com" required type="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Телефон</Label>
          <Input id="phone" name="phone" placeholder="+7 700 000 00 00" type="tel" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="department">Отдел</Label>
          <Input id="department" name="department" placeholder="Отдел продаж" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="roleTitle">Должность</Label>
          <Input id="roleTitle" name="roleTitle" placeholder="Менеджер по продажам" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expiresAt">Ссылка действует до</Label>
          <Input defaultValue={defaultExpirationDate()} id="expiresAt" name="expiresAt" type="date" />
        </div>
      </div>
      <Button type="submit">Добавить и создать приглашение</Button>
    </form>
  );
}
