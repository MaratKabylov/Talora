-- Bulk candidate import for a single vacancy. Creates applications and invitation links
-- without overwriting an existing candidate profile or duplicating a vacancy application.

create or replace function public.bulk_invite_candidates_to_job(
  target_company_id uuid,
  target_job_id uuid,
  candidate_rows jsonb,
  invitation_expires_at timestamptz default null
)
returns table (
  row_number integer,
  candidate_email text,
  outcome text,
  detail text,
  created_candidate_id uuid,
  created_application_id uuid,
  created_invitation_id uuid,
  invitation_token text
)
language plpgsql
security invoker
set search_path = pg_catalog, extensions
as $$
declare
  input_row jsonb;
  normalized_email text;
  candidate_full_name text;
  candidate_phone text;
  candidate_city text;
  candidate_source text;
  selected_candidate_id uuid;
  selected_application_id uuid;
  generated_token text;
  effective_expires_at timestamptz := coalesce(invitation_expires_at, now() + interval '7 days');
  seen_emails text[] := array[]::text[];
begin
  if not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot invite candidates for this company';
  end if;

  if candidate_rows is null or jsonb_typeof(candidate_rows) <> 'array' then
    raise exception 'Candidate rows must be a JSON array';
  end if;

  if jsonb_array_length(candidate_rows) = 0 then
    raise exception 'Candidate rows cannot be empty';
  end if;

  if jsonb_array_length(candidate_rows) > 100 then
    raise exception 'Candidate import cannot exceed 100 rows';
  end if;

  if effective_expires_at <= now() then
    raise exception 'Invitation expiration must be in the future';
  end if;

  if not exists (
    select 1
    from public.jobs job
    join public.assessment_packages package on package.id = job.assessment_package_id
    where job.id = target_job_id
      and job.company_id = target_company_id
      and job.assessment_package_id is not null
      and job.status not in ('closed', 'archived')
      and (
        (
          package.is_system = false
          and package.company_id = target_company_id
        )
        or (
          package.is_system = true
          and public.company_can_access_system_package(target_company_id, package.id)
        )
      )
  ) then
    raise exception 'Job is unavailable for invitations or has no assessment package';
  end if;

  for input_row in
    select item.value
    from jsonb_array_elements(candidate_rows) as item(value)
  loop
    row_number := null;
    candidate_email := null;
    outcome := null;
    detail := null;
    created_candidate_id := null;
    created_application_id := null;
    created_invitation_id := null;
    invitation_token := null;
    selected_candidate_id := null;
    selected_application_id := null;

    begin
      row_number := nullif(input_row ->> 'rowNumber', '')::integer;
      normalized_email := lower(btrim(coalesce(input_row ->> 'email', '')));
      candidate_email := normalized_email;
      candidate_full_name := btrim(coalesce(input_row ->> 'fullName', ''));
      candidate_phone := nullif(btrim(input_row ->> 'phone'), '');
      candidate_city := nullif(btrim(input_row ->> 'city'), '');
      candidate_source := nullif(btrim(input_row ->> 'source'), '');

      if row_number is null or row_number < 2 then
        outcome := 'error';
        detail := 'invalid_row_number';
        return next;
        continue;
      end if;

      if char_length(candidate_full_name) < 2 or char_length(candidate_full_name) > 180 then
        outcome := 'error';
        detail := 'invalid_full_name';
        return next;
        continue;
      end if;

      if char_length(normalized_email) > 255
        or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      then
        outcome := 'error';
        detail := 'invalid_email';
        return next;
        continue;
      end if;

      if char_length(coalesce(candidate_phone, '')) > 40
        or char_length(coalesce(candidate_city, '')) > 120
        or char_length(coalesce(candidate_source, '')) > 120
      then
        outcome := 'error';
        detail := 'field_too_long';
        return next;
        continue;
      end if;

      if normalized_email = any(seen_emails) then
        outcome := 'skipped';
        detail := 'duplicate_in_file';
        return next;
        continue;
      end if;

      seen_emails := array_append(seen_emails, normalized_email);

      select candidate.id
      into selected_candidate_id
      from public.candidates candidate
      where candidate.company_id = target_company_id
        and lower(candidate.email) = normalized_email
      limit 1
      for update;

      if selected_candidate_id is null then
        insert into public.candidates (
          company_id,
          full_name,
          email,
          phone,
          city,
          source
        )
        values (
          target_company_id,
          candidate_full_name,
          normalized_email,
          candidate_phone,
          candidate_city,
          candidate_source
        )
        on conflict do nothing
        returning id into selected_candidate_id;

        if selected_candidate_id is null then
          select candidate.id
          into selected_candidate_id
          from public.candidates candidate
          where candidate.company_id = target_company_id
            and lower(candidate.email) = normalized_email
          limit 1
          for update;
        end if;
      end if;

      select application.id
      into selected_application_id
      from public.candidate_applications application
      where application.company_id = target_company_id
        and application.job_id = target_job_id
        and application.candidate_id = selected_candidate_id
      limit 1
      for update;

      if selected_application_id is not null then
        created_candidate_id := selected_candidate_id;
        created_application_id := selected_application_id;
        outcome := 'skipped';
        detail := 'already_in_job';
        return next;
        continue;
      end if;

      insert into public.candidate_applications (
        company_id,
        job_id,
        candidate_id,
        status,
        current_stage
      )
      values (
        target_company_id,
        target_job_id,
        selected_candidate_id,
        'invited',
        'invitation'
      )
      returning id into selected_application_id;

      generated_token := encode(gen_random_bytes(32), 'hex');

      insert into public.invitations (
        company_id,
        job_id,
        candidate_id,
        application_id,
        token,
        status,
        expires_at,
        sent_at
      )
      values (
        target_company_id,
        target_job_id,
        selected_candidate_id,
        selected_application_id,
        generated_token,
        'sent',
        effective_expires_at,
        now()
      )
      returning id into created_invitation_id;

      created_candidate_id := selected_candidate_id;
      created_application_id := selected_application_id;
      invitation_token := generated_token;
      outcome := 'imported';
      detail := 'invitation_created';
      return next;
    exception
      when unique_violation then
        outcome := 'skipped';
        detail := 'concurrent_duplicate';
        return next;
      when others then
        outcome := 'error';
        detail := 'unexpected_error';
        return next;
    end;
  end loop;
end;
$$;

revoke all on function public.bulk_invite_candidates_to_job(uuid, uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.bulk_invite_candidates_to_job(uuid, uuid, jsonb, timestamptz)
  to authenticated;
