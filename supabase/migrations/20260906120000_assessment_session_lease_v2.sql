-- PERF-003a: atomic claim / heartbeat / integrity event for both assessment scopes.
-- Answer saving and terminal completion stay on V1 until the next rollout step.
create or replace function public.control_assessment_session_lease_v2(
  p_scope text,
  p_token text,
  p_session_id uuid,
  p_client_id text,
  p_device_id text,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_table text;
  session_table text;
  owner_table text;
  owner_column text;
  event_table text;
  owner_row record;
  invitation_row record;
  session_row record;
  current_time_at timestamptz;
  effective_deadline timestamptz;
  duration_minutes integer;
  client_hash text;
  device_hash text;
  already_owned boolean;
  previous_lease_expired boolean;
  blocked boolean := false;
  event_id uuid;
  event_kind text;
  event_question_id uuid;
  event_client_time timestamptz;
  event_metadata jsonb := '{}'::jsonb;
begin
  if p_scope is null or p_scope not in ('candidate', 'employee')
     or p_operation is null or p_operation not in ('claim', 'heartbeat', 'event')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid session control operation' using errcode = '22023';
  end if;

  if p_token is null or p_token !~* '^[a-f0-9]{64}$' or p_session_id is null
     or p_client_id is null or p_client_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
     or p_device_id is null or p_device_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Identifiers come exclusively from this allowlist; all request values use USING.
  if p_scope = 'employee' then
    invitation_table := 'employee_assessment_invitations';
    session_table := 'employee_assessment_sessions';
    owner_table := 'employee_assessment_participants';
    owner_column := 'participant_id';
    event_table := 'employee_assessment_session_events';
  else
    invitation_table := 'invitations';
    session_table := 'test_sessions';
    owner_table := 'candidate_applications';
    owner_column := 'application_id';
    event_table := 'assessment_session_events';
  end if;

  -- Cancellation/finalization lock owner first. Event foreign keys also acquire
  -- an owner KEY SHARE lock, so take it BEFORE invitation/session locks to avoid
  -- a cycle with cancellation holding the owner and waiting on the invitation.
  execute format(
    'select owner.id, owner.company_id, invitation.id as invitation_id
       from public.%I invitation
       join public.%I owner on owner.id = invitation.%I
                          and owner.company_id = invitation.company_id
      where invitation.token = $1
      for key share of owner', invitation_table, owner_table, owner_column
  ) into owner_row using p_token;
  if owner_row.id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- Re-read after waiting on the owner. SHARE (not KEY SHARE) prevents invitation
  -- status/expiry changes, and these predicates reject ownership changes as well.
  execute format(
    'select invitation.id, invitation.company_id, invitation.%I as owner_id,
            invitation.status, invitation.expires_at
       from public.%I invitation
      where invitation.token = $1 and invitation.id = $2
        and invitation.%I = $3 and invitation.company_id = $4
      for share of invitation', owner_column, invitation_table, owner_column
  ) into invitation_row using p_token, owner_row.invitation_id, owner_row.id, owner_row.company_id;

  if invitation_row.id is null or invitation_row.status <> 'started'
     or invitation_row.expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'unavailable');
  end if;

  execute format(
    'select session.id, session.status, session.test_version_id, session.started_at,
            session.deadline_at, session.active_client_id_hash,
            session.active_device_id_hash, session.lease_expires_at
       from public.%I session
      where session.id = $1 and session.%I = $2
      for update of session',
    session_table, owner_column
  ) into session_row using p_session_id, invitation_row.owner_id;

  -- Evaluate deadlines AFTER acquiring locks; transaction now() can be stale
  -- after waiting behind another request.
  current_time_at := clock_timestamp();
  if session_row.id is null or invitation_row.expires_at <= current_time_at then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if session_row.status <> 'in_progress' then
    return jsonb_build_object('status', 'terminal');
  end if;

  effective_deadline := session_row.deadline_at;
  if effective_deadline is null and session_row.started_at is not null then
    select version.duration_minutes into duration_minutes
    from public.test_versions version where version.id = session_row.test_version_id;
    if duration_minutes is not null then
      effective_deadline := session_row.started_at + make_interval(mins => duration_minutes);
      execute format('update public.%I set deadline_at = $1 where id = $2', session_table)
        using effective_deadline, p_session_id;
    end if;
  end if;
  if effective_deadline <= current_time_at then
    -- No lease/event write. The server revalidates access and runs existing
    -- idempotent expiration + scoring, outside the frequent one-RPC path.
    return jsonb_build_object('status', 'expired');
  end if;

  -- Keep the exact V1 sha256(token + ':' + raw UUID string) format, including
  -- UUID letter case, so switching the feature flag never resets ownership.
  client_hash := encode(sha256(convert_to(p_token || ':' || p_client_id, 'UTF8')), 'hex');
  device_hash := encode(sha256(convert_to(p_token || ':' || p_device_id, 'UTF8')), 'hex');
  already_owned := coalesce(session_row.active_client_id_hash = client_hash
                       and session_row.active_device_id_hash = device_hash, false);
  previous_lease_expired := session_row.lease_expires_at is null
                        or session_row.lease_expires_at <= current_time_at;

  if p_operation = 'claim' then
    event_id := (p_payload ->> 'clientEventId')::uuid;
    if event_id is null then
      raise exception 'Client event ID is required' using errcode = '22023';
    end if;
    blocked := not already_owned and session_row.active_client_id_hash is not null
               and not previous_lease_expired;
    if blocked then
      event_kind := 'concurrent_session_blocked';
      event_metadata := jsonb_build_object('sameDevice',
        coalesce(session_row.active_device_id_hash = device_hash, false));
    elsif session_row.active_client_id_hash is not null
          and session_row.active_client_id_hash <> client_hash and previous_lease_expired then
      event_kind := 'session_recovered';
      event_metadata := jsonb_build_object('changedDevice',
        coalesce(session_row.active_device_id_hash <> device_hash, false));
    end if;
  elsif not already_owned then
    return jsonb_build_object('status', 'blocked', 'retryAfterSeconds', 90);
  elsif p_operation = 'event' then
    event_id := (p_payload ->> 'clientEventId')::uuid;
    event_kind := p_payload ->> 'eventType';
    if event_id is null or event_kind is null or event_kind not in
       ('focus_lost', 'focus_returned', 'clipboard_copy', 'clipboard_cut', 'clipboard_paste') then
      raise exception 'Invalid integrity event' using errcode = '22023';
    end if;
    event_question_id := (p_payload ->> 'questionId')::uuid;
    event_client_time := (p_payload ->> 'clientOccurredAt')::timestamptz;
    if event_question_id is not null and not exists (
      select 1 from public.questions question
      join public.test_sections section on section.id = question.section_id
      where question.id = event_question_id
        and section.test_version_id = session_row.test_version_id
    ) then
      raise exception 'Event question must belong to the session test version' using errcode = '22023';
    end if;
    if event_kind = 'focus_returned'
       and jsonb_typeof(p_payload #> '{metadata,durationMs}') = 'number' then
      event_metadata := jsonb_build_object('durationMs',
        least(greatest(round((p_payload #>> '{metadata,durationMs}')::numeric), 0), 86400000));
    end if;
  end if;

  if not blocked then
    execute format(
      'update public.%I set active_client_id_hash = $1, active_device_id_hash = $2,
              last_heartbeat_at = $3, lease_expires_at = $3 + interval ''90 seconds''
        where id = $4', session_table
    ) using client_hash, device_hash, current_time_at, p_session_id;
  end if;

  if event_kind is not null then
    execute format(
      'insert into public.%I
        (company_id, %I, session_id, question_id, client_event_id, event_type,
         client_occurred_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (session_id, client_event_id) do nothing', event_table, owner_column
    ) using invitation_row.company_id, invitation_row.owner_id, p_session_id,
      event_question_id, event_id, event_kind, event_client_time, event_metadata;
  end if;

  if blocked then
    return jsonb_build_object('status', 'blocked', 'retryAfterSeconds', 90);
  end if;
  return jsonb_build_object('status', 'active', 'deadlineAt', effective_deadline);
end;
$$;

revoke all on function public.control_assessment_session_lease_v2(text, text, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.control_assessment_session_lease_v2(text, text, uuid, text, text, text, jsonb)
  to service_role;
