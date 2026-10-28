-- Track WhatsApp test delivery statuses from signed Meta webhook (no phone numbers stored).
ALTER TABLE public.whatsapp_test_attempts
  DROP CONSTRAINT IF EXISTS whatsapp_test_attempts_status_check;
ALTER TABLE public.whatsapp_test_attempts
  ADD CONSTRAINT whatsapp_test_attempts_status_check
  CHECK (status IN ('processing','accepted','sent','delivered','read','failed'));
ALTER TABLE public.whatsapp_test_attempts
  ADD COLUMN IF NOT EXISTS last_status_at timestamptz;
CREATE INDEX IF NOT EXISTS whatsapp_test_provider_id_idx
  ON public.whatsapp_test_attempts (org_id,provider_message_id)
  WHERE provider_message_id IS NOT NULL;
