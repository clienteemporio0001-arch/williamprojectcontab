-- O serviço autenticado elimina o registro após apagar o PDF privado.
-- Não concede exclusão para anon/authenticated nem muda as políticas RLS.
BEGIN;
GRANT DELETE ON TABLE public.billing_documents TO service_role;
COMMIT;
