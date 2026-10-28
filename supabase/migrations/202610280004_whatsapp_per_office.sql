-- CONTABFLOW: Conexão WhatsApp por escritório
-- Execute após Etapa 9. Credenciais NUNCA são armazenadas em texto no navegador.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.whatsapp_integrations (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  waba_id text NOT NULL CHECK(waba_id ~ '^[0-9]{5,30}$'),
  phone_number_id text NOT NULL UNIQUE CHECK(phone_number_id ~ '^[0-9]{5,30}$'),
  display_phone_number text NOT NULL DEFAULT '',
  verified_name text NOT NULL DEFAULT '',
  access_token_encrypted bytea NOT NULL,
  connection_status text NOT NULL DEFAULT 'pending'
    CHECK(connection_status IN ('pending','connected','error')),
  last_error text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_integrations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.whatsapp_integrations TO service_role;

-- As funções só podem ser chamadas por um backend autenticado como service_role.
CREATE OR REPLACE FUNCTION public.whatsapp_integration_store(
  p_org_id uuid,
  p_waba_id text,
  p_phone_number_id text,
  p_display_phone_number text,
  p_verified_name text,
  p_access_token text,
  p_crypto_key text,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,extensions,pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Operation denied' USING ERRCODE='42501';
  END IF;
  IF length(p_crypto_key)<32 OR length(p_access_token)<30 THEN
    RAISE EXCEPTION 'Chave de proteção ou token Meta inválido';
  END IF;
  IF p_status NOT IN ('pending','connected','error') THEN
    RAISE EXCEPTION 'Estado inválido';
  END IF;
  INSERT INTO public.whatsapp_integrations(
    org_id,waba_id,phone_number_id,display_phone_number,verified_name,
    access_token_encrypted,connection_status,last_error
  ) VALUES (
    p_org_id,p_waba_id,p_phone_number_id,p_display_phone_number,
    coalesce(p_verified_name,''),pgp_sym_encrypt(p_access_token,p_crypto_key),
    p_status,left(coalesce(p_error,''),300)
  )
  ON CONFLICT(org_id) DO UPDATE SET
    waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,
    display_phone_number=excluded.display_phone_number,verified_name=excluded.verified_name,
    access_token_encrypted=excluded.access_token_encrypted,
    connection_status=excluded.connection_status,last_error=excluded.last_error,
    updated_at=now();
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_integration_token(p_org_id uuid,p_crypto_key text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions,pg_temp AS $$
DECLARE v_token text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Operation denied' USING ERRCODE='42501';
  END IF;
  SELECT pgp_sym_decrypt(access_token_encrypted,p_crypto_key) INTO v_token
    FROM public.whatsapp_integrations
    WHERE org_id=p_org_id AND connection_status='connected';
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_integration_store(uuid,text,text,text,text,text,text,text,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_integration_token(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_integration_store(uuid,text,text,text,text,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_integration_token(uuid,text)
  TO service_role;

-- Webhook de status (entrega/leitura/erro) por canal, preservando o histórico.
ALTER TABLE public.reminder_logs
  DROP CONSTRAINT IF EXISTS reminder_logs_status_check;
ALTER TABLE public.reminder_logs
  ADD CONSTRAINT reminder_logs_status_check
  CHECK(status IN ('processing','sent','failed','delivered','read'));
ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS read_at timestamptz;
CREATE INDEX IF NOT EXISTS reminder_logs_provider_msg_lookup
  ON public.reminder_logs(org_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;

COMMIT;
NOTIFY pgrst,'reload schema';

SELECT to_regclass('public.whatsapp_integrations') IS NOT NULL AS conexoes_por_escritorio,
       to_regprocedure('public.whatsapp_integration_token(uuid,text)') IS NOT NULL AS token_criptografado,
       EXISTS(SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='reminder_logs'
              AND column_name='delivered_at') AS webhook_status;
