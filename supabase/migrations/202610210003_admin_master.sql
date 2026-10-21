-- CONTABFLOW - ETAPA 3 - ADMIN MASTER / CONTROLE SAAS
-- Requer as etapas 1 e 2. Execute uma vez no SQL Editor.
-- Seguranca: privilegios master apenas via public.master_admins,
-- preenchida manualmente no SQL Editor, NUNCA pelo frontend.
BEGIN;

CREATE TABLE public.subscription_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  client_limit integer NOT NULL CHECK (client_limit >= 1),
  monthly_price_brl numeric(10,2) NOT NULL CHECK (monthly_price_brl >= 0)
);
INSERT INTO public.subscription_plans(code,name,client_limit,monthly_price_brl)
VALUES ('essencial','Essencial',50,69.90),
       ('profissional','Profissional',150,99.90),
       ('plus','Escritório Plus',300,127.00)
ON CONFLICT(code) DO NOTHING;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY subscription_plans_read ON public.subscription_plans
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.subscription_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscription_plans TO authenticated;

ALTER TABLE public.organizations
  ADD COLUMN plan_code text NOT NULL DEFAULT 'essencial'
    REFERENCES public.subscription_plans(code),
  ADD COLUMN access_status text NOT NULL DEFAULT 'active'
    CHECK(access_status IN ('active','suspended'));

-- Apenas o responsavel da plataforma pode alterar plan_code/access_status.
REVOKE UPDATE ON public.organizations FROM PUBLIC, anon, authenticated;
GRANT UPDATE(name,message_template,tax_id,pix_key,billing_contact,timezone)
  ON public.organizations TO authenticated;
CREATE TABLE public.master_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_admins FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_master_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.master_admins ma WHERE ma.user_id=auth.uid()
 );
$$;
REVOKE ALL ON FUNCTION public.is_master_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_master_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_org_active(target_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.organizations o
   WHERE o.id=target_org AND o.access_status='active'
 );
$$;
REVOKE ALL ON FUNCTION public.is_org_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_active(uuid) TO authenticated, service_role;

ALTER POLICY organizations_update ON public.organizations
  USING(public.is_org_owner(id) AND public.is_org_active(id))
  WITH CHECK(public.is_org_owner(id) AND public.is_org_active(id));

-- Suspensao revoga leitura/gravacao de clientes, cobrancas e PDFs.
ALTER POLICY clients_read ON public.clients
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY clients_insert ON public.clients
 WITH CHECK(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY clients_update ON public.clients
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id))
 WITH CHECK(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY clients_delete ON public.clients
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id));

ALTER POLICY obligations_read ON public.obligations
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY obligations_insert ON public.obligations
 WITH CHECK(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY obligations_update ON public.obligations
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id))
 WITH CHECK(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY obligations_delete ON public.obligations
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY reminder_logs_read ON public.reminder_logs
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY billing_documents_read ON public.billing_documents
 USING(public.is_org_member(org_id) AND public.is_org_active(org_id));
ALTER POLICY billing_storage_member_read ON storage.objects
 USING (
   bucket_id='billing-documents'
   AND EXISTS(
     SELECT 1 FROM public.organization_members m
     WHERE m.user_id=auth.uid()
       AND m.org_id::text=split_part(name,'/',1)
       AND public.is_org_active(m.org_id)
   )
 );

-- Limite de CLIENTES ATIVOS por plano, inclusive em escritas diretas na API.
-- Lock transacional por escritorio impede ultrapassar limite por concorrencia.
CREATE OR REPLACE FUNCTION public.enforce_client_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE active_count bigint; max_clients integer; current_status text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'Nao e permitido mover clientes entre escritorios';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text,0));
  SELECT o.access_status,p.client_limit INTO current_status,max_clients
  FROM public.organizations o
  JOIN public.subscription_plans p ON p.code=o.plan_code
  WHERE o.id=NEW.org_id;
  IF current_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Escritorio suspenso ou inexistente';
  END IF;
  IF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active) THEN
    SELECT count(*) INTO active_count FROM public.clients
    WHERE org_id=NEW.org_id AND active=true;
    IF active_count >= max_clients THEN
      RAISE EXCEPTION 'Limite de clientes ativos do plano atingido (%)',max_clients;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_client_plan_limit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clients_plan_limit
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.enforce_client_plan_limit();

-- Impede criacao ilimitada de escritorios por membros existentes.
CREATE OR REPLACE FUNCTION public.create_workspace(workspace_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login antes de criar seu escritório'; END IF;
  IF length(trim(workspace_name))<2 OR length(workspace_name)>100 THEN
    RAISE EXCEPTION 'Nome do escritório inválido';
  END IF;
  IF EXISTS(SELECT 1 FROM public.organization_members WHERE user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Este usuário já pertence a um escritório';
  END IF;
  INSERT INTO public.organizations(name) VALUES(trim(workspace_name)) RETURNING id INTO new_id;
  INSERT INTO public.organization_members(org_id,user_id,role)
  VALUES(new_id,auth.uid(),'owner');
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_workspace(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;

CREATE TABLE public.master_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  action text NOT NULL,
  previous_value jsonb NOT NULL,
  next_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_audit_logs FROM PUBLIC,anon,authenticated;

-- Um unico endpoint RPC consulta resumos, sem expor CPF, telefone,
-- Pix ou dados pessoais de clientes dos escritorios.
CREATE OR REPLACE FUNCTION public.master_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE result jsonb; plans jsonb;
BEGIN
  IF NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb)
  INTO result
  FROM (
    SELECT o.id,o.name,o.created_at,o.plan_code,o.access_status,
      p.name AS plan_name,p.client_limit,p.monthly_price_brl,
      (SELECT count(*) FROM public.clients c
        WHERE c.org_id=o.id AND c.active) AS clients_active,
      (SELECT count(*) FROM public.obligations b
        WHERE b.org_id=o.id) AS charges_total,
      (SELECT count(*) FROM public.reminder_logs l
        WHERE l.org_id=o.id AND l.status='sent') AS notifications_accepted,
      (SELECT u.email FROM public.organization_members m
        JOIN auth.users u ON u.id=m.user_id
        WHERE m.org_id=o.id AND m.role='owner'
        ORDER BY m.created_at LIMIT 1) AS owner_email
    FROM public.organizations o
    JOIN public.subscription_plans p ON p.code=o.plan_code
    ORDER BY o.created_at DESC LIMIT 500
  ) t;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.monthly_price_brl),'[]'::jsonb)
    INTO plans FROM public.subscription_plans p;
  RETURN jsonb_build_object('organizations',result,'plans',plans);
END;
$$;
REVOKE ALL ON FUNCTION public.master_dashboard() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_dashboard() TO authenticated;

-- Alteracoes auditadas e aceitas apenas do administrador master.
CREATE OR REPLACE FUNCTION public.master_update_organization(
  p_org_id uuid,
  p_plan_code text,
  p_access_status text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE old_plan text; old_status text;
BEGIN
  IF NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_access_status NOT IN ('active','suspended') OR p_access_status IS NULL THEN
    RAISE EXCEPTION 'Situação inválida';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.subscription_plans WHERE code=p_plan_code) THEN
    RAISE EXCEPTION 'Plano inválido';
  END IF;
  SELECT o.plan_code,o.access_status INTO old_plan,old_status
  FROM public.organizations o WHERE o.id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escritório não encontrado'; END IF;
  IF old_plan=p_plan_code AND old_status=p_access_status THEN RETURN; END IF;
  UPDATE public.organizations SET plan_code=p_plan_code,
    access_status=p_access_status WHERE id=p_org_id;
  INSERT INTO public.master_audit_logs(
    actor_user_id,org_id,action,previous_value,next_value
  ) VALUES (
    auth.uid(),p_org_id,'update_org',
    jsonb_build_object('plan',old_plan,'status',old_status),
    jsonb_build_object('plan',p_plan_code,'status',p_access_status)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.master_update_organization(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_update_organization(uuid,text,text) TO authenticated;

COMMIT;

-- PASSO MANUAL DE ATIVACAO: depois de se cadastrar e confirmar e-mail,
-- execute SQL separado conforme docs/ADMIN_MASTER.md, usando seu ID do Auth.
-- NENHUMA conta vira master automaticamente.
