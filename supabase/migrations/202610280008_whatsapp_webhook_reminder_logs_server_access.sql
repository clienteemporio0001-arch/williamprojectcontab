-- Webhook autenticado pela assinatura Meta precisa consultar e atualizar status de envios.
-- Acesso restrito ao service_role (segredo armazenado no servidor, nunca no frontend).
GRANT SELECT, UPDATE ON TABLE public.reminder_logs TO service_role;
