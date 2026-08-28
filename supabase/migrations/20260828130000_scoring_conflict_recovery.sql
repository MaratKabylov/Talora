-- Turn an expected optimistic-lock race into a structured result instead of a
-- PostgreSQL ERROR. The original persistence function remains the final guard.

create or replace function public.try_persist_scoring_snapshot(
  p_scope text,
  p_parent_id uuid,
  p_expected_revision integer,
  p_snapshot jsonb,
  p_audit jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision integer;
  persisted jsonb;
begin
  if p_scope = 'candidate' then
    select application.scoring_revision
    into current_revision
    from public.candidate_applications application
    where application.id = p_parent_id
    for update;
  elsif p_scope = 'employee' then
    select participant.scoring_revision
    into current_revision
    from public.employee_assessment_participants participant
    where participant.id = p_parent_id
    for update;
  else
    raise exception 'Invalid scoring persistence scope';
  end if;

  if not found then
    raise exception 'Scoring persistence parent was not found';
  end if;

  if current_revision <> p_expected_revision then
    return jsonb_build_object(
      'audit_id', null,
      'conflict', true,
      'expected_revision', p_expected_revision,
      'revision', current_revision
    );
  end if;

  persisted := public.persist_scoring_snapshot(
    p_scope,
    p_parent_id,
    p_expected_revision,
    p_snapshot,
    p_audit
  );

  return persisted || jsonb_build_object('conflict', false);
end;
$$;

revoke all on function public.try_persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.try_persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  to service_role;
