-- Identidade visual de cada escritório: um PNG privado e pequeno.
-- Um único objeto determinístico por escritório evita acumular versões antigas.
BEGIN;
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS logo_path text,
  ADD COLUMN IF NOT EXISTS logo_updated_at timestamptz;
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_logo_path_valid;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_logo_path_valid
  CHECK (logo_path IS NULL OR logo_path=(id::text || '/logo.png'));
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('office-logos','office-logos',false,81920,ARRAY['image/png'])
ON CONFLICT(id) DO UPDATE SET
  public=false,file_size_limit=81920,allowed_mime_types=ARRAY['image/png'];
DROP POLICY IF EXISTS office_logos_member_read ON storage.objects;
CREATE POLICY office_logos_member_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='office-logos'
  AND name=split_part(name,'/',1)||'/logo.png'
  AND public.is_org_member((split_part(name,'/',1))::uuid)
);
DROP POLICY IF EXISTS office_logos_owner_insert ON storage.objects;
CREATE POLICY office_logos_owner_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='office-logos'
  AND name=split_part(name,'/',1)||'/logo.png'
  AND public.is_org_owner((split_part(name,'/',1))::uuid)
  AND public.is_org_active((split_part(name,'/',1))::uuid)
);
DROP POLICY IF EXISTS office_logos_owner_update ON storage.objects;
CREATE POLICY office_logos_owner_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id='office-logos'
  AND name=split_part(name,'/',1)||'/logo.png'
  AND public.is_org_owner((split_part(name,'/',1))::uuid)
  AND public.is_org_active((split_part(name,'/',1))::uuid)
)
WITH CHECK (
  bucket_id='office-logos'
  AND name=split_part(name,'/',1)||'/logo.png'
  AND public.is_org_owner((split_part(name,'/',1))::uuid)
  AND public.is_org_active((split_part(name,'/',1))::uuid)
);
DROP POLICY IF EXISTS office_logos_owner_delete ON storage.objects;
CREATE POLICY office_logos_owner_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id='office-logos'
  AND name=split_part(name,'/',1)||'/logo.png'
  AND public.is_org_owner((split_part(name,'/',1))::uuid)
  AND public.is_org_active((split_part(name,'/',1))::uuid)
);
COMMIT;
