-- CONTABFLOW ETAPA 10 — ATIVAÇÃO DO AGENDAMENTO AUTOMÁTICO
--
-- PRÉ-REQUISITOS:
-- 1. Habilitar extensões pg_cron e pg_net no Supabase.
-- 2. Supabase Vault: criar segredo contabflow_project_url, com URL HTTPS do projeto.
-- 3. Supabase Vault: criar segredo contabflow_cron_secret, com mesmo CRON_SECRET da Edge Function.
-- 4. Publicar dispatch-reminders, configurar credenciais Meta e DISPATCH_LIVE_ENABLED.
-- 5. Simular dry_run:true e conferir destinatários autorizados antes de ativar envios.
--
-- Este SQL não guarda senhas, tokens ou valores privados no código.
-- Job roda a cada 10 minutos; worker filtra horário local de 09:00-09:59
-- e as datas de lembrete. Não depende de Chrome ou computador aberto.

BEGIN;

DO $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'Habilite pg_cron na seção Database > Extensions do Supabase';
  END IF;
  IF to_regnamespace('net') IS NULL THEN
    RAISE EXCEPTION 'Habilite pg_net na seção Database > Extensions do Supabase';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'Habilite Supabase Vault e configure os segredos';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1'
    INTO v_url USING 'contabflow_project_url';
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1'
    INTO v_secret USING 'contabflow_cron_secret';
  IF v_url IS NULL OR v_url !~ '^https://[a-zA-Z0-9-]+[.]supabase[.]co/?$' THEN
    RAISE EXCEPTION 'Vault: contabflow_project_url ausente ou URL do projeto inválida';
  END IF;
  IF v_secret IS NULL OR length(v_secret)<32 THEN
    RAISE EXCEPTION 'Vault: contabflow_cron_secret ausente ou muito curto';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.contabflow_dispatch_tick()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_url text;
  v_secret text;
  v_id bigint;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets
    WHERE name='contabflow_project_url';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
    WHERE name='contabflow_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL OR length(v_secret)<32 THEN
    RAISE EXCEPTION 'Configure os dois segredos no Supabase Vault';
  END IF;

  SELECT net.http_post(
    url := trim(trailing '/' FROM v_url)||'/functions/v1/dispatch-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.contabflow_dispatch_tick()
  FROM PUBLIC,anon,authenticated;

-- Registro idempotente: agendar o mesmo nome atualiza a programação.
SELECT cron.schedule(
  'contabflow-dispatch-10min',
  '*/10 * * * *',
  'SELECT public.contabflow_dispatch_tick()'
);

COMMIT;

SELECT jobid,jobname,schedule,active
FROM cron.job
WHERE jobname='contabflow-dispatch-10min';

-- Pausar de imediato, sem excluir agendamento:
-- SELECT cron.unschedule('contabflow-dispatch-10min');
--
-- Além disso, para bloquear envios na Edge Function,
-- configure DISPATCH_LIVE_ENABLED=false nas Edge Function Secrets.
