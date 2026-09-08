-- PERF-008.2: consistent snapshots, browser retry receipts and revision-CAS publication.
create or replace function public.guard_builder_version_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  batch_xid bigint;
  enrolled boolean;
begin
  if tg_op = 'INSERT' then
    new.builder_revision := 0;
    return new;
  end if;
  -- Root deletion still goes through existing ownership/RLS/unused-publication guards.
  -- It cannot overwrite newer content; outstanding saves fail once the version is gone.
  if tg_op = 'DELETE' then return old; end if;
  select state.write_transaction into batch_xid
  from public.builder_save_state state where state.version_id = old.id;
  enrolled := found;
  if old.status = 'draft' and enrolled
    and batch_xid is distinct from txid_current()
    and not (new.status = 'archived' and
      to_jsonb(new) - array['status','archived_at','updated_at','builder_revision'] =
      to_jsonb(old) - array['status','archived_at','updated_at','builder_revision']) then
    raise exception 'Builder V2 requires a revision-checked batch' using errcode = '40001';
  end if;
  if new.id is distinct from old.id or new.test_template_id is distinct from old.test_template_id then
    raise exception 'Cannot change test version identity or template' using errcode = '22023';
  end if;
  if old.status = 'draft' then
    -- A metadata-free terminal archive remains available through existing actions.
    -- Every content write and publication still requires the V2 transaction fence.
    new.builder_revision := old.builder_revision + 1;
  else
    -- Keep existing publication/revert/archive trigger comparisons unchanged.
    new.builder_revision := old.builder_revision;
  end if;
  return new;
end;
$$;

alter table public.builder_save_state add column client_payload_hash text,
  add column publication_request_id uuid, add column published_from_revision bigint;

create function public.lock_builder_version_v2(target_template_id uuid, target_version_id uuid,
  acting_user_id uuid, target_company_id uuid)
returns public.test_versions language plpgsql security invoker set search_path = '' as $$
declare template public.test_templates%rowtype; version public.test_versions%rowtype;
begin
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
  if not found then raise exception 'Builder target unavailable' using errcode = '42501'; end if;
  return version;
end;
$$;

create function public.read_builder_snapshot_v2(target_template_id uuid, target_version_id uuid,
  acting_user_id uuid, target_company_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare version public.test_versions%rowtype; result jsonb;
begin
  version := public.lock_builder_version_v2(target_template_id,target_version_id,acting_user_id,target_company_id);
  select jsonb_build_object('version',to_jsonb(version), 'revision',version.builder_revision::text,
    'receipt',(select to_jsonb(state) || jsonb_build_object('last_revision',state.last_revision::text,
      'last_expected_revision',state.last_expected_revision::text,'published_from_revision',state.published_from_revision::text)
      from public.builder_save_state state where version_id=target_version_id),
    'sections',coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('questions',
      coalesce((select jsonb_agg(to_jsonb(q) || jsonb_build_object('answer_options',
        coalesce((select jsonb_agg(to_jsonb(o) order by o.order_index,o.id) from public.answer_options o where o.question_id=q.id),'[]'::jsonb))
        order by q.order_index,q.id) from public.questions q where q.section_id=s.id),'[]'::jsonb))
      order by s.order_index,s.id) from public.test_sections s where s.test_version_id=target_version_id),'[]'::jsonb)) into result;
  return result;
end;
$$;

create function public.commit_builder_delta_v2(target_template_id uuid, target_version_id uuid,
  acting_user_id uuid, target_company_id uuid, expected_revision bigint, request_id uuid,
  client_payload_hash text, delta jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb; receipt public.builder_save_state%rowtype;
begin
  perform public.lock_builder_version_v2(target_template_id,target_version_id,acting_user_id,target_company_id);
  if client_payload_hash is null or client_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid builder request hash' using errcode='22023';
  end if;
  select * into receipt from public.builder_save_state where version_id=target_version_id;
  if receipt.last_request_id=request_id and receipt.client_payload_hash is distinct from client_payload_hash then
    raise exception 'Builder request ID reused' using errcode='22023';
  end if;
  result := public.save_builder_delta_v2(target_template_id,target_version_id,acting_user_id,target_company_id,
    expected_revision,request_id,delta);
  update public.builder_save_state state set client_payload_hash=commit_builder_delta_v2.client_payload_hash
    where version_id=target_version_id;
  return result;
end;
$$;

-- The trusted server validates the snapshot using the existing publication/scoring validator.
-- The CAS below ensures that EXACT validated snapshot is published (including legacy writers).
create function public.publish_builder_version_v2(target_template_id uuid, target_version_id uuid,
  acting_user_id uuid, target_company_id uuid, expected_revision bigint, request_id uuid, version_title text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare version public.test_versions%rowtype; receipt public.builder_save_state%rowtype;
begin
  version := public.lock_builder_version_v2(target_template_id,target_version_id,acting_user_id,target_company_id);
  if expected_revision is null or expected_revision<0 or request_id is null
    or version_title is null or char_length(version_title) not between 2 and 180 then
    raise exception 'Invalid publication identity' using errcode='22023';
  end if;
  select * into receipt from public.builder_save_state where version_id=target_version_id;
  if version.status='published' and receipt.publication_request_id=request_id
    and receipt.last_actor_id=acting_user_id and receipt.published_from_revision=expected_revision
    and version.builder_revision=expected_revision+1 then
    return jsonb_build_object('published',true,'revision',version.builder_revision::text);
  end if;
  if version.status<>'draft' or version.builder_revision<>expected_revision then
    raise exception 'Builder revision conflict: reload or merge local changes' using errcode='40001';
  end if;
  if version.duration_minutes is null or version.duration_minutes<1 then
    raise exception 'Test duration required' using errcode='22023';
  end if;
  insert into public.builder_save_state(version_id,write_transaction) values(target_version_id,txid_current())
    on conflict(version_id) do update set write_transaction=excluded.write_transaction;
  update public.test_versions set status='published',published_at=clock_timestamp(),title=version_title
    where id=target_version_id returning * into version;
  update public.builder_save_state set write_transaction=null, publication_request_id=request_id,
    published_from_revision=expected_revision,last_actor_id=acting_user_id where version_id=target_version_id;
  if target_company_id is null then
    insert into public.platform_audit_logs(actor_user_id,actor_role,action,target_type,target_id,metadata_json)
    select acting_user_id,role,'publish_system_test_version','test_version',target_version_id,
      jsonb_build_object('templateId',target_template_id) from public.platform_users where user_id=acting_user_id;
  end if;
  return jsonb_build_object('published',true,'revision',version.builder_revision::text);
end;
$$;

revoke all on function public.lock_builder_version_v2(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.read_builder_snapshot_v2(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.commit_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.publish_builder_version_v2(uuid,uuid,uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.lock_builder_version_v2(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.read_builder_snapshot_v2(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.commit_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,text,jsonb) to service_role;
grant execute on function public.publish_builder_version_v2(uuid,uuid,uuid,uuid,bigint,uuid,text) to service_role;
