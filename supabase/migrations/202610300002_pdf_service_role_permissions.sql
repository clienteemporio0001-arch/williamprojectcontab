-- Corrige o erro 500 na função generate-charge após o upload bem-sucedido.
-- A Edge Function utiliza service_role para registrar o PDF e o evento de auditoria.
-- Nenhuma permissão nova é concedida a anon ou authenticated.
BEGIN;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_documents TO service_role;
GRANT INSERT ON TABLE public.saas_activity_events TO service_role;
GRANT USAGE ON SEQUENCE public.saas_activity_events_id_seq TO service_role;
COMMIT;
