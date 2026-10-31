-- Bloqueia alterações de dados financeiros/identificação após emissão ou tentativa de envio.
-- Para corrigir uma cobrança sem histórico: exclua explicitamente o PDF pelo backend.
-- Com histórico de envio, preserve a cobrança e crie outra corrigida.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_issued_charge_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF ROW(OLD.client_id, OLD.title, OLD.amount, OLD.due_date)
    IS DISTINCT FROM ROW(NEW.client_id, NEW.title, NEW.amount, NEW.due_date)
  THEN
    IF EXISTS (
      SELECT 1 FROM public.billing_documents d
      WHERE d.org_id = OLD.org_id AND d.obligation_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM public.reminder_logs l
      WHERE l.org_id = OLD.org_id AND l.obligation_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'A cobrança já possui PDF ou histórico de envio. Exclua o PDF não enviado antes de corrigir, ou crie uma nova cobrança se houve envio.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS obligations_issued_document_guard ON public.obligations;
CREATE TRIGGER obligations_issued_document_guard
  BEFORE UPDATE OF client_id, title, amount, due_date
  ON public.obligations
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_issued_charge_changes();

COMMIT;
