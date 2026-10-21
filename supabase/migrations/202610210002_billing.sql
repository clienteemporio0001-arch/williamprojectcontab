-- ContabFlow • Fase 2: cobrança de honorários ANTES do pagamento
-- Execute após a migração inicial (202610210001_init.sql).
alter table public.organizations
  add column if not exists tax_id text not null default '',
  add column if not exists pix_key text not null default '',
  add column if not exists billing_contact text not null default '';
alter table public.clients
  add column if not exists tax_id text;
alter table public.obligations
  add column if not exists reminder_offsets integer[] not null default array[7,3,1,0];
-- 30 a 0 dias antes, e até 7 dias após o vencimento.
alter table public.obligations
  add constraint obligation_reminder_offsets_valid check (
    array_length(reminder_offsets,1) between 1 and 10 and
    array_position(reminder_offsets,null) is null and
    array_to_string(reminder_offsets,',') ~ '^(-?[0-9]+)(,-?[0-9]+)*
  );
-- Armazenamento privado. Somente o servidor cria/atualiza PDFs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('billing-documents','billing-documents',false,5242880,array['application/pdf'])
on conflict(id) do nothing;

create table public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  storage_path text not null,
  generated_at timestamptz not null default now(),
  unique(obligation_id),
  constraint billing_doc_obligation_org foreign key(org_id,obligation_id)
    references public.obligations(org_id,id) on delete cascade
);
create index billing_doc_org_idx on public.billing_documents(org_id);
alter table public.billing_documents enable row level security;
create policy billing_documents_read on public.billing_documents
  for select to authenticated using(public.is_org_member(org_id));
-- Read limitado ao escritório. Edição/upload do arquivo somente por service_role.
create policy billing_storage_member_read on storage.objects
  for select to authenticated using (
    bucket_id = 'billing-documents' and exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id::text = split_part(name,'/',1)
    )
  );
 and
    reminder_offsets <@ array[-7,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]
  );
-- Armazenamento privado. Somente o servidor cria/atualiza PDFs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('billing-documents','billing-documents',false,5242880,array['application/pdf'])
on conflict(id) do nothing;

create table public.billing_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  storage_path text not null,
  generated_at timestamptz not null default now(),
  unique(obligation_id),
  constraint billing_doc_obligation_org foreign key(org_id,obligation_id)
    references public.obligations(org_id,id) on delete cascade
);
create index billing_doc_org_idx on public.billing_documents(org_id);
alter table public.billing_documents enable row level security;
create policy billing_documents_read on public.billing_documents
  for select to authenticated using(public.is_org_member(org_id));
-- Read limitado ao escritório. Edição/upload do arquivo somente por service_role.
create policy billing_storage_member_read on storage.objects
  for select to authenticated using (
    bucket_id = 'billing-documents' and exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id::text = split_part(name,'/',1)
    )
  );

-- A versão anterior permitia somente 7/3/1/0/-1.
alter table public.reminder_logs
  drop constraint if exists reminder_logs_offset_days_check;
alter table public.reminder_logs
  add constraint reminder_offset_range check (offset_days between -7 and 30);
