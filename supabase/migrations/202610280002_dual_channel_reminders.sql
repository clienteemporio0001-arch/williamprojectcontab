-- CONTABFLOW ETAPA 9: DOIS CANAIS DE COBRANCA (EMAIL + WHATSAPP)
-- SQL idempotente e sem disparos; dados anteriores preservados.
BEGIN;

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email_opt_in boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email_opt_in_at timestamptz;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email_consent_source text;

-- Forca consentimento verificavel, sem preencher automaticamente autorizacoes.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_email_opt_in_consistency;
ALTER TABLE public.clients ADD CONSTRAINT clients_email_opt_in_consistency CHECK (
  NOT email_opt_in
  OR (email IS NOT NULL AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
      AND email_opt_in_at IS NOT NULL AND nullif(trim(email_consent_source),'') IS NOT NULL)
);
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_email_valid;
ALTER TABLE public.clients ADD CONSTRAINT clients_email_valid CHECK (
  email IS NULL OR email='' OR email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
);

-- Os dois canais sao DESLIGADOS por padrao: o contador habilita quando estiver pronto.
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS email_reminders_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS whatsapp_reminders_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.reminder_logs ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public.reminder_logs DROP CONSTRAINT IF EXISTS reminder_logs_channel_valid;
ALTER TABLE public.reminder_logs ADD CONSTRAINT reminder_logs_channel_valid
  CHECK(channel IN ('email','whatsapp'));

-- A chave antiga impedia email e WhatsApp para a mesma cobranca e mesmo dia.
ALTER TABLE public.reminder_logs
 DROP CONSTRAINT IF EXISTS reminder_logs_obligation_id_due_date_offset_days_key;

CREATE UNIQUE INDEX IF NOT EXISTS reminder_logs_unique_channel
 ON public.reminder_logs(obligation_id,due_date,offset_days,channel);
CREATE INDEX IF NOT EXISTS reminder_logs_channel_status
 ON public.reminder_logs(org_id,channel,status,created_at DESC);

-- Protege campos de assinatura contra alteração direta de um assinante.
-- Admin Master segue usando seus RPCs auditados; service role interna continua autorizada.
CREATE OR REPLACE FUNCTION public.guard_org_billing_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_master_admin() AND (
    NEW.plan_code IS DISTINCT FROM OLD.plan_code
    OR NEW.billing_status IS DISTINCT FROM OLD.billing_status
    OR NEW.access_status IS DISTINCT FROM OLD.access_status
    OR NEW.trial_started_at IS DISTINCT FROM OLD.trial_started_at
    OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
  ) THEN
    RAISE EXCEPTION 'Plano, acesso e periodo de teste so podem ser alterados pelo Admin Master'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$;
DROP TRIGGER IF EXISTS organizations_guard_billing_fields ON public.organizations;
CREATE TRIGGER organizations_guard_billing_fields
 BEFORE UPDATE ON public.organizations FOR EACH ROW
 EXECUTE FUNCTION public.guard_org_billing_fields();
REVOKE ALL ON FUNCTION public.guard_org_billing_fields() FROM PUBLIC,anon,authenticated;

-- O usuario autenticado apenas altera as preferencias do proprio escritorio
-- via RLS ja existente. Logs de disparo permanecem apenas para leitura.
GRANT SELECT,UPDATE ON public.organizations TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.clients TO authenticated;
GRANT SELECT ON public.reminder_logs TO authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';

SELECT
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='clients' AND column_name='email') AS email_cliente,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='email_reminders_enabled') AS ativacao_email,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='whatsapp_reminders_enabled') AS ativacao_whatsapp,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='reminder_logs' AND column_name='channel') AS historico_por_canal;
