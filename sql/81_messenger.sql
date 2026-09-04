-- ============================================================================
-- 81. Internal Messenger  (feature #3) — Teams-like chat, no calling
-- ----------------------------------------------------------------------------
-- Channels (group), Direct Messages (1:1 or small group), threaded replies,
-- @mentions that raise bell notifications, and the option to attach a message
-- to an approval item (ref_type/ref_id deep-link). Internal users only.
-- All access flows through membership; helper functions avoid RLS recursion.
-- Additive & idempotent.
-- ============================================================================

create table if not exists public.chat_channels (
  id          bigint generated always as identity primary key,
  name        text,                      -- null for DMs (name derived from members)
  kind        text not null default 'channel' check (kind in ('channel','dm')),
  topic       text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table if not exists public.chat_members (
  channel_id   bigint not null references public.chat_channels(id) on delete cascade,
  user_id      uuid   not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  joined_at    timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  channel_id bigint not null references public.chat_channels(id) on delete cascade,
  parent_id  bigint references public.chat_messages(id) on delete cascade, -- thread root (null = top level)
  author     uuid references public.profiles(id),
  body       text not null,
  ref_type   text,                       -- optional: attach to an approval item
  ref_id     text,
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index if not exists chat_msg_channel_idx on public.chat_messages(channel_id, created_at);
create index if not exists chat_msg_parent_idx  on public.chat_messages(parent_id);
create index if not exists chat_member_user_idx  on public.chat_members(user_id);

alter table public.chat_channels enable row level security;
alter table public.chat_members  enable row level security;
alter table public.chat_messages enable row level security;

-- membership check as definer -> avoids policy recursion between the 3 tables
create or replace function public.is_chat_member(cid bigint)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.chat_members m where m.channel_id=cid and m.user_id=auth.uid());
$$;

-- ---- policies ----
drop policy if exists chan_sel on public.chat_channels;
create policy chan_sel on public.chat_channels for select to authenticated
  using (public.is_chat_member(id) or created_by=auth.uid());
drop policy if exists chan_ins on public.chat_channels;
create policy chan_ins on public.chat_channels for insert to authenticated
  with check (created_by=auth.uid() and public.is_internal());

drop policy if exists mem_sel on public.chat_members;
create policy mem_sel on public.chat_members for select to authenticated
  using (user_id=auth.uid() or public.is_chat_member(channel_id));
drop policy if exists mem_upd on public.chat_members;               -- update own last_read_at
create policy mem_upd on public.chat_members for update to authenticated
  using (user_id=auth.uid()) with check (user_id=auth.uid());

drop policy if exists msg_sel on public.chat_messages;
create policy msg_sel on public.chat_messages for select to authenticated
  using (public.is_chat_member(channel_id));
drop policy if exists msg_ins on public.chat_messages;
create policy msg_ins on public.chat_messages for insert to authenticated
  with check (author=auth.uid() and public.is_chat_member(channel_id));
drop policy if exists msg_upd on public.chat_messages;              -- edit own message
create policy msg_upd on public.chat_messages for update to authenticated
  using (author=auth.uid()) with check (author=auth.uid());

grant select, insert, update on public.chat_channels to authenticated;
grant select, insert, update, delete on public.chat_members to authenticated;
grant select, insert, update on public.chat_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Roster: internal users you can DM / add to a channel (bypasses profile RLS)
-- ---------------------------------------------------------------------------
create or replace function public.chat_roster()
returns table(id uuid, name text, email text)
language sql stable security definer set search_path=public as $$
  select p.id, coalesce(nullif(p.full_name,''), p.email) as name, p.email
  from public.profiles p
  where coalesce(p.is_external,false)=false and p.id <> auth.uid()
  order by coalesce(nullif(p.full_name,''), p.email);
$$;

-- ---------------------------------------------------------------------------
-- Create a group channel with an initial member set (creator auto-added)
-- ---------------------------------------------------------------------------
create or replace function public.chat_create_channel(p_name text, p_members uuid[], p_topic text default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare cid bigint; u uuid;
begin
  if not public.is_internal() then raise exception 'internal users only'; end if;
  insert into public.chat_channels(name, kind, topic, created_by)
    values (nullif(btrim(p_name),''), 'channel', p_topic, auth.uid()) returning id into cid;
  insert into public.chat_members(channel_id, user_id) values (cid, auth.uid());
  if p_members is not null then
    foreach u in array p_members loop
      if u <> auth.uid() then
        insert into public.chat_members(channel_id, user_id) values (cid, u)
          on conflict do nothing;
      end if;
    end loop;
  end if;
  return cid;
end $$;

-- add members to an existing channel (any member may add)
create or replace function public.chat_add_members(p_channel bigint, p_members uuid[])
returns void language plpgsql security definer set search_path=public as $$
declare u uuid;
begin
  if not public.is_chat_member(p_channel) then raise exception 'not a member'; end if;
  foreach u in array coalesce(p_members,'{}') loop
    insert into public.chat_members(channel_id, user_id) values (p_channel, u) on conflict do nothing;
  end loop;
end $$;

-- leave a channel
create or replace function public.chat_leave(p_channel bigint)
returns void language sql security definer set search_path=public as $$
  delete from public.chat_members where channel_id=p_channel and user_id=auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Open (or reuse) a 1:1 DM with another internal user
-- ---------------------------------------------------------------------------
create or replace function public.chat_open_dm(p_other uuid)
returns bigint language plpgsql security definer set search_path=public as $$
declare cid bigint;
begin
  if not public.is_internal() then raise exception 'internal users only'; end if;
  -- find an existing 2-person dm containing exactly me + the other
  select c.id into cid from public.chat_channels c
   where c.kind='dm'
     and (select count(*) from public.chat_members m where m.channel_id=c.id)=2
     and exists(select 1 from public.chat_members m where m.channel_id=c.id and m.user_id=auth.uid())
     and exists(select 1 from public.chat_members m where m.channel_id=c.id and m.user_id=p_other)
   limit 1;
  if cid is not null then return cid; end if;
  insert into public.chat_channels(kind, created_by) values ('dm', auth.uid()) returning id into cid;
  insert into public.chat_members(channel_id, user_id) values (cid, auth.uid()), (cid, p_other);
  return cid;
end $$;

-- ---------------------------------------------------------------------------
-- Post a message; raise notifications for @mentions (and the DM peer).
-- p_mentions = user ids the client parsed from @handles.
-- ---------------------------------------------------------------------------
create or replace function public.chat_post(p_channel bigint, p_body text,
    p_parent bigint default null, p_mentions uuid[] default null,
    p_ref_type text default null, p_ref_id text default null)
returns bigint language plpgsql security definer set search_path=public as $$
declare mid bigint; me_name text; ch public.chat_channels; u uuid; peer uuid;
        preview text; link text;
begin
  if not public.is_chat_member(p_channel) then raise exception 'not a member'; end if;
  if coalesce(btrim(p_body),'')='' then raise exception 'empty message'; end if;
  insert into public.chat_messages(channel_id, parent_id, author, body, ref_type, ref_id)
    values (p_channel, p_parent, auth.uid(), p_body, p_ref_type, p_ref_id) returning id into mid;

  select coalesce(nullif(full_name,''),email) into me_name from public.profiles where id=auth.uid();
  select * into ch from public.chat_channels where id=p_channel;
  preview := left(regexp_replace(p_body,'\s+',' ','g'), 90);
  link := 'messenger:'||p_channel;

  -- notify explicit @mentions (members only)
  if p_mentions is not null then
    foreach u in array p_mentions loop
      if u <> auth.uid() and public.is_chat_member(p_channel) then
        perform public.notify_link(u,'chat', me_name||' mentioned you: '||preview, link);
      end if;
    end loop;
  end if;

  -- for a 1:1 DM, always notify the other party
  if ch.kind='dm' then
    for peer in select user_id from public.chat_members where channel_id=p_channel and user_id<>auth.uid() loop
      if p_mentions is null or not (peer = any(p_mentions)) then
        perform public.notify_link(peer,'chat', me_name||' (DM): '||preview, link);
      end if;
    end loop;
  end if;

  return mid;
end $$;

-- mark a channel read up to now
create or replace function public.chat_mark_read(p_channel bigint)
returns void language sql security definer set search_path=public as $$
  update public.chat_members set last_read_at=now()
   where channel_id=p_channel and user_id=auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- My channels with unread counts + DM peer name (one call for the sidebar)
-- ---------------------------------------------------------------------------
create or replace function public.chat_my_channels()
returns table(id bigint, name text, kind text, topic text, dm_peer text,
              last_at timestamptz, unread bigint)
language sql stable security definer set search_path=public as $$
  select c.id, c.name, c.kind, c.topic,
         (select string_agg(coalesce(nullif(p.full_name,''),p.email), ', ')
            from public.chat_members mm join public.profiles p on p.id=mm.user_id
           where mm.channel_id=c.id and mm.user_id<>auth.uid()) as dm_peer,
         (select max(created_at) from public.chat_messages msg where msg.channel_id=c.id) as last_at,
         (select count(*) from public.chat_messages msg
            where msg.channel_id=c.id and msg.created_at > m.last_read_at and msg.author<>auth.uid()) as unread
  from public.chat_channels c
  join public.chat_members m on m.channel_id=c.id and m.user_id=auth.uid()
  order by last_at desc nulls last;
$$;

-- Messages for a channel, with author names (membership enforced inside)
create or replace function public.chat_messages_for(p_channel bigint)
returns table(id bigint, parent_id bigint, author uuid, author_name text, body text,
              ref_type text, ref_id text, created_at timestamptz, edited_at timestamptz)
language sql stable security definer set search_path=public as $$
  select m.id, m.parent_id, m.author, coalesce(nullif(p.full_name,''),p.email,'—') as author_name,
         m.body, m.ref_type, m.ref_id, m.created_at, m.edited_at
  from public.chat_messages m left join public.profiles p on p.id=m.author
  where m.channel_id=p_channel
    and exists(select 1 from public.chat_members cm where cm.channel_id=p_channel and cm.user_id=auth.uid())
  order by m.created_at;
$$;

-- total unread across all my channels (for the nav badge)
create or replace function public.chat_unread_total()
returns bigint language sql stable security definer set search_path=public as $$
  select coalesce(sum(unread),0) from public.chat_my_channels();
$$;

grant execute on function public.chat_roster() to authenticated;
grant execute on function public.chat_create_channel(text,uuid[],text) to authenticated;
grant execute on function public.chat_add_members(bigint,uuid[]) to authenticated;
grant execute on function public.chat_leave(bigint) to authenticated;
grant execute on function public.chat_open_dm(uuid) to authenticated;
grant execute on function public.chat_post(bigint,text,bigint,uuid[],text,text) to authenticated;
grant execute on function public.chat_mark_read(bigint) to authenticated;
grant execute on function public.chat_my_channels() to authenticated;
grant execute on function public.chat_messages_for(bigint) to authenticated;
grant execute on function public.chat_unread_total() to authenticated;
