-- Correção do envio de teste do ContabFlow (28/10/2026).
-- A função whatsapp-test-send consulta apenas destinatários já autorizados.
-- O frontend continua limitado por RLS; acesso privilegiado só em Edge Functions.
GRANT SELECT ON TABLE public.clients TO service_role;
