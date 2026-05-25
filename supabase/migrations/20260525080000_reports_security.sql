-- Reports: expose generated report artifacts only inside the owning tenant.

drop policy if exists "members can read candidate reports" on public.candidate_reports;
create policy "members can read candidate reports"
on public.candidate_reports for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = candidate_reports.application_id
      and public.is_company_member(application.company_id)
  )
);
