-- ============================================================================
-- 82. Messenger enhancements: file attachments, message edit & delete
-- ----------------------------------------------------------------------------
-- - New private 'chat' storage bucket (internal users only, signed URLs).
-- - chat_messages.attachments jsonb  [{path,name,type,size}]
-- - chat_post() now also stores attachments (and allows an empty body when at
--   least one file is attached).
-- - chat_messages_for() returns attachments.
-- - Authors may delete their own messages (RLS policy).
-- Additive & idempotent.
-- ============================================================================

alter table public.chat_messages add column if not exists attachments jsonb not null default '[]';

-- allow authors to delete their own messages
drop policy if exists msg_del on public.chat_messages;
create policy msg_del on public.chat_messages for delete to authenticated
  using (author=auth.uid());
grant delete on public.chat_messages to authenticated;

-- ---- storage bucket for chat files (private; internal-only; signed URLs) ----
insert into storage.buckets (id, name, public) values ('chat','chat', false)
  on conflict (id) do nothing;
drop policy if exists chat_read   on storage.objects;
drop policy if exists chat_insert on storage.objects;
drop policy if exists chat_delete on storage.objects;
create policy chat_read   on storage.objects for select to authenticated using (bucket_id='chat' and public.is_internal());
create policy chat_insert on storage.objects for insert to authenticated with check (bucket_id='chat' and public.is_internal());
create policy chat_delete on storage.objects for delete to authenticated using (bucket_id='chat' and public.is_internal());

-- ---- chat_post: add attachments; allow empty body if files attached ----
drop function if exists public.chat_post(bigint,text,bigint,uuid[],text,text);
create or replace function public.chat_post(p_channel bigint, p_body text,
    p_parent bigint default null, p_mentions uuid[] default null,
    p_ref_type text default null, p_ref_id text default null,
    p_attachments jsonb default '[]')
returns bigint language plpgsql security definer set search_path=public as $$
declare mid bigint; me_name text; ch public.chat_channels; u uuid; peer uuid;
        preview text; link text; nfiles int := coalesce(jsonb_array_length(coalesce(p_attachments,'[]')),0);
begin
  if not public.is_chat_member(p_channel) then raise exception 'not a member'; end if;
  if coalesce(btrim(p_body),'')='' and nfiles=0 then raise exception 'empty message'; end if;
  insert into public.chat_messages(channel_id, parent_id, author, body, ref_type, ref_id, attachments)
    values (p_channel, p_parent, auth.uid(), coalesce(p_body,''), p_ref_type, p_ref_id, coalesce(p_attachments,'[]'))
    returning id into mid;

  select coalesce(nullif(full_name,''),email) into me_name from public.profiles where id=auth.uid();
  select * into ch from public.chat_channels where id=p_channel;
  preview := left(regexp_replace(coalesce(nullif(btrim(p_body),''), '📎 '||nfiles||' file(s)'),'\s+',' ','g'), 90);
  link := 'messenger:'||p_channel;

  if p_mentions is not null then
    foreach u in array p_mentions loop
      if u <> auth.uid() then
        perform public.notify_link(u,'chat', me_name||' mentioned you: '||preview, link);
      end if;
    end loop;
  end if;
  if ch.kind='dm' then
    for peer in select user_id from public.chat_members where channel_id=p_channel and user_id<>auth.uid() loop
      if p_mentions is null or not (peer = any(p_mentions)) then
        perform public.notify_link(peer,'chat', me_name||' (DM): '||preview, link);
      end if;
    end loop;
  end if;
  return mid;
end $$;
grant execute on function public.chat_post(bigint,text,bigint,uuid[],text,text,jsonb) to authenticated;

-- ---- chat_messages_for: include attachments ----
drop function if exists public.chat_messages_for(bigint);
create or replace function public.chat_messages_for(p_channel bigint)
returns table(id bigint, parent_id bigint, author uuid, author_name text, body text,
              ref_type text, ref_id text, attachments jsonb, created_at timestamptz, edited_at timestamptz)
language sql stable security definer set search_path=public as $$
  select m.id, m.parent_id, m.author, coalesce(nullif(p.full_name,''),p.email,'—') as author_name,
         m.body, m.ref_type, m.ref_id, m.attachments, m.created_at, m.edited_at
  from public.chat_messages m left join public.profiles p on p.id=m.author
  where m.channel_id=p_channel
    and exists(select 1 from public.chat_members cm where cm.channel_id=p_channel and cm.user_id=auth.uid())
  order by m.created_at;
$$;
grant execute on function public.chat_messages_for(bigint) to authenticated;
