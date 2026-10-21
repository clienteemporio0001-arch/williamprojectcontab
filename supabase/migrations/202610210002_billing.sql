-- CONTABFLOW - ETAPA 2
-- Execute APENAS apos a Etapa 1.
-- Avisos de cobranca antes do pagamento, nao recibos de quitacao.

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pix_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_contact text NOT NULL DEFAULT '';

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tax_id text;

ALTER TABLE public.obligations
  ADD COLUMN IF NOT EXISTS reminder_offsets integer[] NOT NULL
  DEFAULT ARRAY[7,3,1,0];

ALTER TABLE public.obligations
  ADD CONSTRAINT obligation_reminder_offsets_valid
  CHECK (
    array_length(reminder_offsets,1) BETWEEN 1 AND 10
    AND array_position(reminder_offsets,NULL) IS NULL
    AND reminder_offsets <@ ARRAY[
      -7,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,7,8,9,10,
      11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,
      26,27,28,29,30
    ]
  );

-- Permissoes explicitas de acesso via API para usuarios autenticados.
-- RLS segue obrigatorio: cada escritorio visualiza somente seus dados.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT SELECT ON public.organization_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.obligations TO authenticated;
GRANT SELECT ON public.reminder_logs TO authenticated;

-- Bucket nao publico para PDFs individualizados.
INSERT INTO storage.buckets (
  id,name,public,file_size_limit,allowed_mime_types
) VALUES (
  'billing-documents',
  'billing-documents',
  false,
  5242880,
  ARRAY['application/pdf']
) ON CONFLICT(id) DO NOTHING;

CREATE TABLE public.billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  obligation_id uuid NOT NULL,
  storage_path text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(obligation_id),
  CONSTRAINT billing_doc_obligation_org
    FOREIGN KEY(org_id,obligation_id)
    REFERENCES public.obligations(org_id,id)
    ON DELETE CASCADE
);

CREATE INDEX billing_doc_org_idx
  ON public.billing_documents(org_id);

ALTER TABLE public.billing_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.billing_documents TO authenticated;

CREATE POLICY billing_documents_read
  ON public.billing_documents
  FOR SELECT TO authenticated
  USING(public.is_org_member(org_id));

-- O usuario autenticado ve PDFs apenas do seu proprio escritorio.
-- Somente a Edge Function (service_role) cria/altera os arquivos.
CREATE POLICY billing_storage_member_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'billing-documents'
    AND EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.org_id::text = split_part(name,'/',1)
    )
  );

-- Expandir faixa permitida para datas personalizadas de lembrete.
ALTER TABLE public.reminder_logs
  DROP CONSTRAINT IF EXISTS reminder_logs_offset_days_check;

ALTER TABLE public.reminder_logs
  ADD CONSTRAINT reminder_offset_range
  CHECK(offset_days BETWEEN -7 AND 30);

COMMIT;
