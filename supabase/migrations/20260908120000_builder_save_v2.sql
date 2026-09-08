-- PERF-008.1: storage protocol only. No application caller is enabled yet.
-- Apply on staging before wiring V2 server actions. Never execute tests/fixtures in Supabase.
alter table public.test_versions
  add column if not exists builder_revision bigint not null default 0
  check (builder_revision >= 0);

-- Private write fence + last ACK. No document text or other content is retained.
-- Enrolling a version deliberately rejects legacy writes, including legacy publish.
create table public.builder_save_state (
  version_id uuid primary key references public.test_versions(id) on delete cascade,
  write_transaction bigint,
  last_request_id uuid,
  last_actor_id uuid,
  last_expected_revision bigint,
  last_payload_hash text,
  last_revision bigint,
  saved_at timestamptz
);
alter table public.builder_save_state enable row level security;
revoke all on public.builder_save_state from public, anon, authenticated;
grant select, insert, update, delete on public.builder_save_state to service_role;

create function public.guard_builder_version_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  batch_xid bigint;
  enrolled boolean;
begin
  if tg_op = 'INSERT' then
    new.builder_revision := 0;
    return new;
  end if;
  select state.write_transaction into batch_xid
  from public.builder_save_state state where state.version_id = old.id;
  enrolled := found;
  if old.status = 'draft' and enrolled
    and batch_xid is distinct from txid_current() then
    raise exception 'Builder V2 requires a revision-checked batch' using errcode = '40001';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.id is distinct from old.id or new.test_template_id is distinct from old.test_template_id then
    raise exception 'Cannot change test version identity or template' using errcode = '22023';
  end if;
  if old.status = 'draft' then
    -- One bump per legacy version write, or the explicit final bump in a V2 batch.
    new.builder_revision := old.builder_revision + 1;
  else
    -- Keep existing publication/revert/archive trigger comparisons unchanged.
    new.builder_revision := old.builder_revision;
  end if;
  return new;
end;
$$;
create trigger aa_guard_builder_version_revision
before insert or update or delete on public.test_versions
for each row execute function public.guard_builder_version_revision();

create function public.touch_builder_content_revision(target_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  version_status text;
  publication_time timestamptz;
  batch_xid bigint;
begin
  -- Serialize ALL content writers with save/publish, not just RPC callers.
  select version.status, version.published_at into version_status, publication_time
  from public.test_versions version where version.id = target_version_id for update;
  if not found then return; end if; -- parent already removed by a cascading delete
  if version_status <> 'draft' or publication_time is not null then
    raise exception 'Only draft test content can be edited' using errcode = '55000';
  end if;
  select state.write_transaction into batch_xid
  from public.builder_save_state state where state.version_id = target_version_id;
  if found then
    if batch_xid is distinct from txid_current() then
      raise exception 'Builder V2 requires a revision-checked batch' using errcode = '40001';
    end if;
    return; -- the RPC bumps once, after all changes succeed
  end if;
  update public.test_versions set builder_revision = builder_revision + 1
  where id = target_version_id;
end;
$$;

create function public.guard_builder_content_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_version_id uuid;
  new_version_id uuid;
begin
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'Cannot change builder entity identity' using errcode = '22023';
  end if;
  if tg_table_name = 'test_sections' then
    if tg_op <> 'INSERT' then old_version_id := old.test_version_id; end if;
    if tg_op <> 'DELETE' then new_version_id := new.test_version_id; end if;
  elsif tg_table_name = 'questions' then
    if tg_op <> 'INSERT' then
      select test_version_id into old_version_id from public.test_sections where id = old.section_id;
    end if;
    if tg_op <> 'DELETE' then
      select test_version_id into new_version_id from public.test_sections where id = new.section_id;
    end if;
  else
    if tg_op <> 'INSERT' then
      select s.test_version_id into old_version_id from public.questions q
      join public.test_sections s on s.id = q.section_id where q.id = old.question_id;
    end if;
    if tg_op <> 'DELETE' then
      select s.test_version_id into new_version_id from public.questions q
      join public.test_sections s on s.id = q.section_id where q.id = new.question_id;
    end if;
  end if;
  if old_version_id is not null and new_version_id is not null
    and old_version_id <> new_version_id then
    raise exception 'Cannot move content between test versions' using errcode = '22023';
  end if;
  perform public.touch_builder_content_revision(coalesce(old_version_id, new_version_id));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger aa_guard_builder_content_revision before insert or update or delete on public.test_sections
for each row execute function public.guard_builder_content_revision();
create trigger aa_guard_builder_content_revision before insert or update or delete on public.questions
for each row execute function public.guard_builder_content_revision();
create trigger aa_guard_builder_content_revision before insert or update or delete on public.answer_options
for each row execute function public.guard_builder_content_revision();

-- Internal, whitelisted storage contract, NOT an untrusted browser DTO. The future
-- server action must validate the assembled document and sanitize rich text first.
create function public.save_builder_delta_v2(
  target_template_id uuid, target_version_id uuid, acting_user_id uuid,
  target_company_id uuid, expected_revision bigint, request_id uuid, delta jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  template public.test_templates%rowtype;
  version public.test_versions%rowtype;
  receipt public.builder_save_state%rowtype;
  entity_group text;
  entry jsonb;
  allowed_keys text[];
  payload_hash text;
  acknowledged_at timestamptz;
  result_revision bigint;
  affected_rows integer;
begin
  if target_template_id is null or target_version_id is null or acting_user_id is null
    or expected_revision is null or expected_revision < 0 or request_id is null then
    raise exception 'Invalid builder save identity' using errcode = '22023';
  end if;
  select * into template from public.test_templates where id = target_template_id for share;
  if not found or template.status <> 'active' then
    raise exception 'Builder target unavailable' using errcode = '42501';
  end if;
  if target_company_id is null then
    if not template.is_system or template.company_id is not null then
      raise exception 'Builder scope mismatch' using errcode = '42501';
    end if;
    perform 1 from public.platform_users where user_id = acting_user_id and status = 'active'
      and role in ('platform_owner', 'platform_admin') for share;
    if not found then raise exception 'Cannot manage system tests' using errcode = '42501'; end if;
  else
    if template.is_system or template.company_id is distinct from target_company_id then
      raise exception 'Builder scope mismatch' using errcode = '42501';
    end if;
    perform 1 from public.companies where id = target_company_id and status = 'active' for share;
    if not found then raise exception 'Company unavailable' using errcode = '42501'; end if;
    perform 1 from public.company_users where company_id = target_company_id
      and user_id = acting_user_id and status = 'active'
      and role in ('owner', 'admin', 'recruiter', 'super_admin') for share;
    if not found then raise exception 'Cannot manage company tests' using errcode = '42501'; end if;
  end if;
  select * into version from public.test_versions where id = target_version_id
    and test_template_id = target_template_id for update;
  if not found or version.status <> 'draft' or version.published_at is not null then
    raise exception 'Builder target must be a draft' using errcode = '55000';
  end if;
  if jsonb_typeof(delta) is distinct from 'object' or octet_length(delta::text) > 8388608
    or delta - array['version','sections','questions','options','deletedSections','deletedQuestions','deletedOptions'] <> '{}'::jsonb then
    raise exception 'Invalid builder delta' using errcode = '22023';
  end if;
  foreach entity_group in array array['sections','questions','options','deletedSections','deletedQuestions','deletedOptions'] loop
    if jsonb_typeof(delta -> entity_group) is distinct from 'array'
      or jsonb_array_length(delta -> entity_group) > (case
        when entity_group in ('sections','deletedSections') then 100
        when entity_group in ('questions','deletedQuestions') then 30000 else 3000000 end) then
      raise exception 'Invalid builder entity array' using errcode = '22023';
    end if;
  end loop;
  if not (delta ? 'version') or jsonb_typeof(delta -> 'version') not in ('object','null') then
    raise exception 'Invalid builder version patch' using errcode = '22023';
  end if;
  -- Full replacement of editable fields on each dirty entity; unchanged rows absent.
  foreach entity_group in array array['version','sections','questions','options'] loop
    allowed_keys := case entity_group
      when 'version' then array['title','description','instructions','duration_minutes','scoring_type','settings_json']
      when 'sections' then array['id','title','description','order_index','time_limit_minutes','settings_json']
      when 'questions' then array['id','section_id','question_type','text','description','order_index','points','competency_key','difficulty','settings_json']
      else array['id','question_id','text','order_index','is_correct','points','competency_effect_json','explanation','match_text'] end;
    for entry in select value from jsonb_array_elements(case when entity_group = 'version'
      then case when delta -> 'version' = 'null'::jsonb then '[]'::jsonb else jsonb_build_array(delta -> 'version') end
      else delta -> entity_group end) loop
      if jsonb_typeof(entry) is distinct from 'object' or not (entry ?& allowed_keys)
        or entry - allowed_keys <> '{}'::jsonb then
        raise exception 'Invalid builder entity fields' using errcode = '22023';
      end if;
      if entity_group <> 'options' then
        if jsonb_typeof(entry -> 'settings_json') is distinct from 'object'
          or (entry -> 'settings_json') - (case entity_group
            when 'version' then array['allowBack','captureQuestionTime','presentationMode']
            when 'sections' then array['contentBlocks']
            else array['incorrectFeedback','matchingScoringMode','max','min','mode','orderingScoringMode',
              'remediationQuestionId','required','shuffleOptions','structuredResponseVersion'] end) <> '{}'::jsonb then
          raise exception 'Invalid builder settings fields' using errcode = '22023';
        end if;
      elsif jsonb_typeof(entry -> 'competency_effect_json') is distinct from 'object' then
        raise exception 'Invalid builder competency effects' using errcode = '22023';
      end if;
    end loop;
  end loop;
  -- Reject duplicates, null IDs, and contradictory upsert/delete instructions.
  foreach entity_group in array array['sections','questions','options'] loop
    if exists (select 1 from jsonb_array_elements(delta -> entity_group) x
      group by (x ->> 'id')::uuid having (x ->> 'id')::uuid is null or count(*) > 1)
      or exists (select 1 from jsonb_array_elements_text(delta -> ('deleted' || initcap(entity_group))) x
        group by x::uuid having x::uuid is null or count(*) > 1)
      or exists (select 1 from jsonb_array_elements(delta -> entity_group) x
        join jsonb_array_elements_text(delta -> ('deleted' || initcap(entity_group))) y on (x ->> 'id')::uuid = y::uuid) then
      raise exception 'Duplicate or contradictory builder IDs' using errcode = '22023';
    end if;
  end loop;
  payload_hash := md5(delta::text);
  select * into receipt from public.builder_save_state where version_id = target_version_id;
  if receipt.last_request_id = request_id then
    if receipt.last_actor_id is distinct from acting_user_id
      or receipt.last_expected_revision is distinct from expected_revision
      or receipt.last_payload_hash is distinct from payload_hash then
      raise exception 'Builder request ID reused' using errcode = '22023';
    end if;
    if receipt.last_revision = version.builder_revision then
      return jsonb_build_object('revision', receipt.last_revision::text, 'savedAt', receipt.saved_at, 'replayed', true);
    end if;
  end if;
  if version.builder_revision <> expected_revision then
    raise exception 'Builder revision conflict: reload or merge local changes' using errcode = '40001';
  end if;
  -- Validate existing IDs before any upsert, even for the service-role caller.
  if exists (select 1 from public.test_sections s where s.test_version_id <> target_version_id
    and (s.id in (select (x ->> 'id')::uuid from jsonb_array_elements(delta -> 'sections') x)
      or s.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedSections') x)))
    or exists (select 1 from public.questions q join public.test_sections s on s.id = q.section_id
      where s.test_version_id <> target_version_id and
      (q.id in (select (x ->> 'id')::uuid from jsonb_array_elements(delta -> 'questions') x)
        or q.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedQuestions') x)))
    or exists (select 1 from public.answer_options o join public.questions q on q.id = o.question_id
      join public.test_sections s on s.id = q.section_id where s.test_version_id <> target_version_id and
      (o.id in (select (x ->> 'id')::uuid from jsonb_array_elements(delta -> 'options') x)
        or o.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedOptions') x))) then
    raise exception 'Builder entity belongs to another version' using errcode = '42501';
  end if;
  if (select count(*) from public.test_sections s where s.test_version_id = target_version_id
      and s.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedSections') x))
      <> jsonb_array_length(delta -> 'deletedSections')
    or (select count(*) from public.questions q join public.test_sections s on s.id = q.section_id
      where s.test_version_id = target_version_id
      and q.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedQuestions') x))
      <> jsonb_array_length(delta -> 'deletedQuestions')
    or (select count(*) from public.answer_options o join public.questions q on q.id = o.question_id
      join public.test_sections s on s.id = q.section_id where s.test_version_id = target_version_id
      and o.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedOptions') x))
      <> jsonb_array_length(delta -> 'deletedOptions') then
    raise exception 'Builder deleted entity unavailable' using errcode = '22023';
  end if;
  insert into public.builder_save_state(version_id, write_transaction)
    values (target_version_id, txid_current())
    on conflict (version_id) do update set write_transaction = excluded.write_transaction;

  insert into public.test_sections(id, test_version_id, title, description, order_index, time_limit_minutes, settings_json)
    select x.id, target_version_id, x.title, x.description, x.order_index, x.time_limit_minutes, x.settings_json
    from jsonb_to_recordset(delta -> 'sections') x(id uuid, title text, description text, order_index integer, time_limit_minutes integer, settings_json jsonb)
    on conflict (id) do update set title = excluded.title, description = excluded.description,
      order_index = excluded.order_index, time_limit_minutes = excluded.time_limit_minutes,
      settings_json = (public.test_sections.settings_json - 'contentBlocks') || excluded.settings_json
      where public.test_sections.test_version_id = target_version_id;
  get diagnostics affected_rows = row_count;
  if affected_rows <> jsonb_array_length(delta -> 'sections') then
    raise exception 'Builder section ID conflict' using errcode = '40001';
  end if;

  if exists (select 1 from jsonb_array_elements(delta -> 'questions') x
    left join public.test_sections s on s.id = (x ->> 'section_id')::uuid
    where s.test_version_id is distinct from target_version_id
      or s.id in (select v::uuid from jsonb_array_elements_text(delta -> 'deletedSections') v)) then
    raise exception 'Builder question parent unavailable' using errcode = '42501';
  end if;
  insert into public.questions(id, section_id, question_type, text, description, order_index, points, competency_key, difficulty, settings_json)
    select x.id, x.section_id, x.question_type, x.text, x.description, x.order_index, x.points, x.competency_key, x.difficulty, x.settings_json
    from jsonb_to_recordset(delta -> 'questions') x(id uuid, section_id uuid, question_type text, text text,
      description text, order_index integer, points numeric, competency_key text, difficulty text, settings_json jsonb)
    on conflict (id) do update set section_id = excluded.section_id, question_type = excluded.question_type,
      text = excluded.text, description = excluded.description, order_index = excluded.order_index,
      points = excluded.points, competency_key = excluded.competency_key, difficulty = excluded.difficulty,
      settings_json = (public.questions.settings_json - array['incorrectFeedback','matchingScoringMode','max','min',
        'mode','orderingScoringMode','remediationQuestionId','required','shuffleOptions','structuredResponseVersion']) || excluded.settings_json;

  if exists (select 1 from jsonb_array_elements(delta -> 'options') x
    left join public.questions q on q.id = (x ->> 'question_id')::uuid
    left join public.test_sections s on s.id = q.section_id
    where s.test_version_id is distinct from target_version_id
      or s.id in (select v::uuid from jsonb_array_elements_text(delta -> 'deletedSections') v)
      or q.id in (select v::uuid from jsonb_array_elements_text(delta -> 'deletedQuestions') v)) then
    raise exception 'Builder option parent unavailable' using errcode = '42501';
  end if;
  insert into public.answer_options(id, question_id, text, order_index, is_correct, points, competency_effect_json, explanation, match_text)
    select x.id, x.question_id, x.text, x.order_index, x.is_correct, x.points, x.competency_effect_json, x.explanation, x.match_text
    from jsonb_to_recordset(delta -> 'options') x(id uuid, question_id uuid, text text, order_index integer,
      is_correct boolean, points numeric, competency_effect_json jsonb, explanation text, match_text text)
    on conflict (id) do update set question_id = excluded.question_id, text = excluded.text,
      order_index = excluded.order_index, is_correct = excluded.is_correct, points = excluded.points,
      competency_effect_json = excluded.competency_effect_json, explanation = excluded.explanation, match_text = excluded.match_text;
  -- Move surviving children BEFORE deleting parents (otherwise ON DELETE CASCADE loses them).
  delete from public.answer_options o using public.questions q, public.test_sections s
    where o.question_id = q.id and q.section_id = s.id and s.test_version_id = target_version_id
    and o.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedOptions') x);
  delete from public.questions q using public.test_sections s
    where q.section_id = s.id and s.test_version_id = target_version_id
    and q.id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedQuestions') x);
  delete from public.test_sections where test_version_id = target_version_id
    and id in (select x::uuid from jsonb_array_elements_text(delta -> 'deletedSections') x);

  update public.test_versions v set
    title = case when delta -> 'version' = 'null'::jsonb then v.title else delta #>> '{version,title}' end,
    description = case when delta -> 'version' = 'null'::jsonb then v.description else delta #>> '{version,description}' end,
    instructions = case when delta -> 'version' = 'null'::jsonb then v.instructions else delta #>> '{version,instructions}' end,
    duration_minutes = case when delta -> 'version' = 'null'::jsonb then v.duration_minutes else (delta #>> '{version,duration_minutes}')::integer end,
    scoring_type = case when delta -> 'version' = 'null'::jsonb then v.scoring_type else delta #>> '{version,scoring_type}' end,
    settings_json = case when delta -> 'version' = 'null'::jsonb then v.settings_json else
      (v.settings_json - array['allowBack','captureQuestionTime','presentationMode']) || (delta #> '{version,settings_json}') end,
    builder_revision = v.builder_revision + 1
    where v.id = target_version_id returning builder_revision into result_revision;
  acknowledged_at := clock_timestamp();
  update public.builder_save_state set write_transaction = null, last_request_id = request_id,
    last_actor_id = acting_user_id, last_expected_revision = expected_revision,
    last_payload_hash = payload_hash, last_revision = result_revision, saved_at = acknowledged_at
    where version_id = target_version_id;
  return jsonb_build_object('revision', result_revision::text, 'savedAt', acknowledged_at, 'replayed', false);
end;
$$;

revoke all on function public.guard_builder_version_revision() from public, anon, authenticated;
revoke all on function public.guard_builder_content_revision() from public, anon, authenticated;
revoke all on function public.touch_builder_content_revision(uuid) from public, anon, authenticated;
revoke all on function public.save_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,jsonb) to service_role;
