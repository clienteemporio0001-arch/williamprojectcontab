-- Tentativas controladas do botão de teste WhatsApp.
-- Acesso somente via Edge Function autenticada com service role.
create table if not exists public.whatsapp_test_attempts (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  recipient_last4 text not null check (recipient_last4 ~ '^[0-9]{4}$'),
  requested_at timestamptz not null default now(),
  slot_started_at timestamptz not null default to_timestamp(floor(extract(epoch from now()) / 300) * 300),
  status text not null default 'processing' check (status in ('processing','accepted','failed')),
  provider_message_id text,
  error_code text,
  constraint whatsapp_test_one_per_five_minutes unique(org_id,slot_started_at)
);
create index if not exists whatsapp_test_attempts_org_daily_idx
  on public.whatsapp_test_attempts(org_id,requested_at desc);
alter table public.whatsapp_test_attempts enable row level security;
revoke all on public.whatsapp_test_attempts from anon, authenticated, public;
grant select,insert,update on public.whatsapp_test_attempts to service_role;
grant usage,select on sequence public.whatsapp_test_attempts_id_seq to service_role;
comment on table public.whatsapp_test_attempts is
 'Registro de segurança: até 3 testes por escritório/dia, um a cada 5 minutos, sem guardar telefone completo.';
