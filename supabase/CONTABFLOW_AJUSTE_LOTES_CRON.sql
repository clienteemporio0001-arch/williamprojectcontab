-- CONTABFLOW: AJUSTE OPCIONAL DO CRON PARA PROCESSAR PEQUENOS LOTES
-- Seguro: NAO cria um agendamento novo se nao houver nenhum ativo.
-- A Edge Function so envia mensagens se DISPATCH_LIVE_ENABLED=true.
-- Os disparos ocorrem entre 09h e 11h59 no fuso de cada escritorio.
-- Execute no SQL Editor APENAS depois de validar dry_run e provedores.
DO $$
DECLARE
  has_old boolean;
  has_new boolean;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron não instalado. Nenhum agendamento criado.';
    RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname='contabflow-dispatch-10min')
    INTO has_old;
  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname='contabflow-dispatch-1min')
    INTO has_new;
  IF NOT has_old AND NOT has_new THEN
    RAISE NOTICE 'ContabFlow ainda não possui agendamento: nenhum foi criado.';
    RETURN;
  END IF;
  IF has_old THEN
    PERFORM cron.unschedule('contabflow-dispatch-10min');
  END IF;
  PERFORM cron.schedule(
    'contabflow-dispatch-1min',
    '* * * * *',
    'SELECT public.contabflow_dispatch_tick()'
  );
  RAISE NOTICE 'Agendamento existente atualizado: lotes de ate 12 envios por minuto.';
END;
$$;

-- Consulta somente informativa: não dispara mensagens.
SELECT jobid,jobname,schedule,active
FROM cron.job
WHERE jobname LIKE 'contabflow-dispatch%';
