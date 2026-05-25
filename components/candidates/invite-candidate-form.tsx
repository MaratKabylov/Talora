import { inviteCandidateAction } from "@/lib/candidates/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function defaultExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export function InviteCandidateForm({ jobId }: { jobId: string }) {
  return (
    <form action={inviteCandidateAction} className="space-y-5">
      <input name="jobId" type="hidden" value={jobId} />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="fullName">Имя кандидата</Label>
          <Input id="fullName" name="fullName" placeholder="Айгерим Садыкова" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" placeholder="candidate@example.com" required type="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Телефон</Label>
          <Input id="phone" name="phone" placeholder="+7 700 000 00 00" type="tel" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">Город</Label>
          <Input id="city" name="city" placeholder="Алматы" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="source">Источник</Label>
          <Input id="source" name="source" placeholder="LinkedIn, рекомендация" />
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
