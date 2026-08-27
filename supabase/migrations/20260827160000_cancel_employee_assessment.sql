create or replace function public.cancel_employee_assessment(
  target_company_id uuid,
  target_participant_id uuid
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
    raise exception 'User cannot cancel employee assessments for this company';
  end if;

  select participant.status
  into selected_status
  from public.employee_assessment_participants participant
  where participant.id = target_participant_id
    and participant.company_id = target_company_id
  for update;

  if not found then
    raise exception 'Employee assessment participant not found';
  end if;

  if selected_status not in ('invited', 'in_progress') then
    raise exception 'Employee assessment can no longer be cancelled';
  end if;

  update public.employee_assessment_invitations invitation
  set status = 'cancelled'
  where invitation.participant_id = target_participant_id
    and invitation.company_id = target_company_id
    and invitation.status in ('created', 'sent', 'opened', 'started');

  update public.employee_assessment_sessions session
  set status = 'cancelled'
  where session.participant_id = target_participant_id
    and session.status in ('not_started', 'in_progress');

  update public.employee_assessment_participants participant
  set
    status = 'cancelled',
    current_stage = 'cancelled'
  where participant.id = target_participant_id
    and participant.company_id = target_company_id;
end;
$$;

revoke all on function public.cancel_employee_assessment(uuid, uuid) from public, anon;
grant execute on function public.cancel_employee_assessment(uuid, uuid) to authenticated;
