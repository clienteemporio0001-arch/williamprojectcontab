-- ContabFlow • migração inicial
-- Execute no SQL Editor de um projeto Supabase novo.
create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 2 and 100),
  timezone text not null default 'America/Rio_Branco',
  message_template text not null default 'Olá, {nome}! Lembramos que o documento {documento} vence em {vencimento}. Valor: {valor}. {link} Se já pagou, desconsidere este lembrete.',
  created_at timestamptz not null default now()
);
create table public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (
  select 1 from public.organization_members m
  where m.org_id = target_org and m.user_id = auth.uid()
) $$;
create or replace function public.is_org_owner(target_org uuid)
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (
  select 1 from public.organization_members m
  where m.org_id = target_org and m.user_id = auth.uid() and m.role = 'owner'
) $$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_owner(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(trim(name)) >= 2),
  company text not null default '',
  phone text not null check(phone ~ '^55[0-9]{10,11}$'),
  opt_in boolean not null default false,
  opt_in_at timestamptz,
  consent_source text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(org_id,id),
  constraint client_consent_consistency check (
    not opt_in or (opt_in_at is not null and length(trim(coalesce(consent_source,''))) > 0)
  )
);
create index clients_org_idx on public.clients(org_id,name);
create index clients_phone_idx on public.clients(org_id,phone);

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  title text not null check(length(trim(title)) >= 2),
  amount numeric(12,2) check(amount is null or amount >= 0),
  due_date date not null,
  status text not null default 'pending' check(status in ('pending','paid','cancelled')),
  document_url text,
  recurring boolean not null default false,
  series_id uuid,
  due_day integer check(due_day between 1 and 31),
  created_at timestamptz not null default now(),
  unique(org_id,id),
  constraint obligation_client_organization foreign key(org_id,client_id)
    references public.clients(org_id,id) on delete restrict,
  constraint obligation_recurrence check (
    (recurring and series_id is not null and due_day is not null) or
    (not recurring and series_id is null and due_day is null)
  ),
  constraint obligation_link_https check (document_url is null or document_url ~ '^https://')
);
create unique index obligations_unique_monthly on public.obligations(series_id,due_date) where series_id is not null;
create index obligations_org_date_idx on public.obligations(org_id,due_date,status);
create index obligations_series_idx on public.obligations(org_id,series_id,due_date);

create table public.reminder_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  due_date date not null,
  offset_days integer not null check(offset_days in (-1,0,1,3,7)),
  status text not null default 'processing' check(status in ('processing','sent','failed')),
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint reminder_obligation_org foreign key(org_id,obligation_id)
    references public.obligations(org_id,id) on delete cascade,
  unique(obligation_id,due_date,offset_days)
);
create index reminder_logs_org_idx on public.reminder_logs(org_id,created_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.obligations enable row level security;
alter table public.reminder_logs enable row level security;

create policy organizations_read on public.organizations
for select to authenticated using(public.is_org_member(id));
create policy organizations_update on public.organizations
for update to authenticated using(public.is_org_owner(id))
with check(public.is_org_owner(id));

create policy members_read on public.organization_members
for select to authenticated using(user_id = auth.uid());

create policy clients_read on public.clients
for select to authenticated using(public.is_org_member(org_id));
create policy clients_insert on public.clients
for insert to authenticated with check(public.is_org_member(org_id));
create policy clients_update on public.clients
for update to authenticated using(public.is_org_member(org_id))
with check(public.is_org_member(org_id));
create policy clients_delete on public.clients
for delete to authenticated using(public.is_org_member(org_id));

create policy obligations_read on public.obligations
for select to authenticated using(public.is_org_member(org_id));
create policy obligations_insert on public.obligations
for insert to authenticated with check(public.is_org_member(org_id));
create policy obligations_update on public.obligations
for update to authenticated using(public.is_org_member(org_id))
with check(public.is_org_member(org_id));
create policy obligations_delete on public.obligations
for delete to authenticated using(public.is_org_member(org_id));
create policy reminder_logs_read on public.reminder_logs
for select to authenticated using(public.is_org_member(org_id));

-- Cadastro seguro do espaço. O usuário não pode escolher arbitrariamente o owner.
create or replace function public.create_workspace(workspace_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Faça login antes de criar seu escritório'; end if;
  if length(trim(workspace_name)) < 2 or length(workspace_name) > 100 then
    raise exception 'Nome do escritório inválido';
  end if;
  insert into public.organizations(name) values(trim(workspace_name)) returning id into new_id;
  insert into public.organization_members(org_id,user_id,role)
  values(new_id,auth.uid(),'owner');
  return new_id;
end;
$$;
revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;
