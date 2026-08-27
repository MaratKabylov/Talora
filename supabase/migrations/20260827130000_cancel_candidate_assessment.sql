alter table public.candidate_applications
  drop constraint if exists candidate_applications_status_check;

alter table public.candidate_applications
  add constraint candidate_applications_status_check
  check (
    status in (
      'invited',
      'in_progress',
      'completed',
      'shortlisted',
      'rejected',
      'hired',
      'withdrawn',
      'cancelled'
    )
  );

create or replace function public.cancel_candidate_assessment(
  target_company_id uuid,
  target_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  selected_status text;
begin
  if auth.uid() is null or not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot cancel candidate assessments for this company';
  end if;

  select application.status
  into selected_status
  from public.candidate_applications application
  where application.id = target_application_id
    and application.company_id = target_company_id
  for update;

  if not found then
    raise exception 'Candidate application not found';
  end if;

  if selected_status not in ('invited', 'in_progress') then
    raise exception 'Candidate assessment can no longer be cancelled';
  end if;

  update public.invitations invitation
  set status = 'cancelled'
  where invitation.application_id = target_application_id
    and invitation.company_id = target_company_id
    and invitation.status in ('created', 'sent', 'opened', 'started');

  update public.test_sessions session
  set
    status = 'cancelled',
    active_client_id_hash = null,
    active_device_id_hash = null,
    lease_expires_at = null,
    last_heartbeat_at = null
  where session.application_id = target_application_id
    and session.status in ('not_started', 'in_progress');

  update public.candidate_applications application
  set
    status = 'cancelled',
    current_stage = 'cancelled'
  where application.id = target_application_id
    and application.company_id = target_company_id;
end;
$$;

revoke all on function public.cancel_candidate_assessment(uuid, uuid) from public, anon;
grant execute on function public.cancel_candidate_assessment(uuid, uuid) to authenticated;
