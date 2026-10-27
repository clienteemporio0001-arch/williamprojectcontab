-- CONTABFLOW • ETAPA 5 • Teste gratuito configurável e status de assinatura
-- Execute uma vez, após as etapas 1 a 4. Não apaga os escritórios existentes.
BEGIN;

CREATE TABLE public.saas_trial_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
  trial_enabled boolean NOT NULL DEFAULT true,
  trial_days integer NOT NULL DEFAULT 7 CHECK(trial_days BETWEEN 1 AND 90),
  trial_max_clients integer NOT NULL DEFAULT 10 CHECK(trial_max_clients BETWEEN 1 AND 300),
  trial_title text NOT NULL DEFAULT 'Teste o ContabFlow gratuitamente'
    CHECK(length(trim(trial_title)) BETWEEN 5 AND 100),
  trial_description text NOT NULL DEFAULT 'Automatize seus honorários e conheça a plataforma antes de contratar.'
    CHECK(length(trim(trial_description)) BETWEEN 10 AND 300),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
INSERT INTO public.saas_trial_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
-- Planos e valores são informações públicas na landing page.
DROP POLICY IF EXISTS subscription_plans_public_read ON public.subscription_plans;
CREATE POLICY subscription_plans_public_read
  ON public.subscription_plans FOR SELECT TO anon USING(true);
GRANT SELECT ON public.subscription_plans TO anon;

ALTER TABLE public.saas_trial_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saas_trial_settings_public_read ON public.saas_trial_settings;
CREATE POLICY saas_trial_settings_public_read
  ON public.saas_trial_settings FOR SELECT TO anon,authenticated USING(true);
REVOKE ALL ON public.saas_trial_settings FROM PUBLIC, anon, authenticated;
-- Expor apenas os campos comerciais; identificador do administrador fica privado.
GRANT SELECT(trial_enabled,trial_days,trial_max_clients,trial_title,trial_description)
  ON public.saas_trial_settings TO anon, authenticated;

CREATE TABLE public.saas_trial_settings_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  previous_value jsonb NOT NULL,
  next_value jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saas_trial_settings_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_trial_settings_audit FROM PUBLIC,anon,authenticated;

ALTER TABLE public.organizations
  ADD COLUMN billing_status text NOT NULL DEFAULT 'active'
    CHECK(billing_status IN('active','trialing','pending')),
  ADD COLUMN trial_started_at timestamptz,
  ADD COLUMN trial_ends_at timestamptz;

-- Organizações anteriores continuam ativas; novas ganham teste ou ficam
-- pendentes de liberação quando o teste está desabilitado.
CREATE OR REPLACE FUNCTION public.create_workspace(workspace_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
DECLARE new_id uuid; trial_conf public.saas_trial_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login antes de criar seu escritório'; END IF;
  IF workspace_name IS NULL OR length(trim(workspace_name))<2 OR length(workspace_name)>100 THEN
    RAISE EXCEPTION 'Nome do escritório inválido';
  END IF;
  IF EXISTS(SELECT 1 FROM public.organization_members WHERE user_id=auth.uid()) THEN
    RAISE EXCEPTION 'Este usuário já pertence a um escritório';
  END IF;
  SELECT * INTO trial_conf FROM public.saas_trial_settings WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configuração do teste não encontrada'; END IF;

  INSERT INTO public.organizations(
    name,billing_status,trial_started_at,trial_ends_at
  ) VALUES(
    trim(workspace_name),
    CASE WHEN trial_conf.trial_enabled THEN 'trialing' ELSE 'pending' END,
    CASE WHEN trial_conf.trial_enabled THEN now() ELSE NULL END,
    CASE WHEN trial_conf.trial_enabled THEN now()+make_interval(days=>trial_conf.trial_days) ELSE NULL END
  ) RETURNING id INTO new_id;

  INSERT INTO public.organization_members(org_id,user_id,role)
  VALUES(new_id,auth.uid(),'owner');
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_workspace(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;

-- Vencimento aplicado no servidor a cada requisição, não apenas no React.
CREATE OR REPLACE FUNCTION public.is_org_active(target_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.organizations o
    WHERE o.id=target_org
      AND o.access_status='active'
      AND (
        o.billing_status='active'
        OR (
          o.billing_status='trialing'
          AND o.trial_ends_at IS NOT NULL AND o.trial_ends_at>now()
        )
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_org_active(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_org_active(uuid) TO authenticated,service_role;

-- Restringe a quantidade de clientes ATIVOS no período de teste,
-- mesmo que tentem burlar a interface com chamadas diretas à API.
CREATE OR REPLACE FUNCTION public.enforce_client_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
DECLARE active_count bigint; max_clients integer; trial_cap integer;
        current_status text; current_billing text; ends_at timestamptz;
BEGIN
  IF TG_OP='UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'Não é permitido mover clientes entre escritórios';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text,0));
  SELECT o.access_status,o.billing_status,o.trial_ends_at,p.client_limit
  INTO current_status,current_billing,ends_at,max_clients
  FROM public.organizations o
  JOIN public.subscription_plans p ON p.code=o.plan_code
  WHERE o.id=NEW.org_id;

  IF current_status IS DISTINCT FROM 'active' OR NOT (
    current_billing='active' OR
    (current_billing='trialing' AND ends_at IS NOT NULL AND ends_at>now())
  ) THEN
    RAISE EXCEPTION 'Acesso do escritório expirado, pendente ou suspenso';
  END IF;
  IF current_billing='trialing' THEN
    SELECT trial_max_clients INTO trial_cap FROM public.saas_trial_settings WHERE id=1;
    max_clients:=least(max_clients,coalesce(trial_cap,10));
  END IF;
  IF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active) THEN
    SELECT count(*) INTO active_count FROM public.clients
      WHERE org_id=NEW.org_id AND active=true;
    IF active_count>=max_clients THEN
      RAISE EXCEPTION 'Limite de clientes ativos atingido (%)',max_clients;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_client_plan_limit() FROM PUBLIC,anon,authenticated;
-- Trigger existente (clients_plan_limit) permanece ativo.

-- O Admin Master pode atualizar a oferta pública, com trilha de auditoria.
CREATE OR REPLACE FUNCTION public.master_update_trial_settings(
  p_enabled boolean,p_days integer,p_max_clients integer,
  p_title text,p_description text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
DECLARE before_record jsonb;after_record jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_enabled IS NULL OR p_days NOT BETWEEN 1 AND 90
     OR p_max_clients NOT BETWEEN 1 AND 300
     OR p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 5 AND 100
     OR p_description IS NULL OR length(trim(p_description)) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Configuração do teste inválida';
  END IF;
  SELECT to_jsonb(s) INTO before_record
  FROM public.saas_trial_settings s WHERE s.id=1 FOR UPDATE;
  IF before_record IS NULL THEN RAISE EXCEPTION 'Configuração do teste não encontrada'; END IF;
  UPDATE public.saas_trial_settings SET
    trial_enabled=p_enabled,trial_days=p_days,trial_max_clients=p_max_clients,
    trial_title=trim(p_title),trial_description=trim(p_description),
    updated_at=now(),updated_by=auth.uid()
  WHERE id=1;
  SELECT to_jsonb(s) INTO after_record FROM public.saas_trial_settings s WHERE s.id=1;
  INSERT INTO public.saas_trial_settings_audit(actor_user_id,previous_value,next_value)
  VALUES(auth.uid(),before_record,after_record);
END;
$$;
REVOKE ALL ON FUNCTION public.master_update_trial_settings(boolean,integer,integer,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_update_trial_settings(boolean,integer,integer,text,text)
  TO authenticated;

-- Conversão manual após comprovação de contratação OU extensão excepcional.
CREATE TABLE public.master_billing_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  action text NOT NULL CHECK(action IN ('activate','extend_trial','pending')),
  old_status text NOT NULL,
  new_status text NOT NULL,
  old_expiration timestamptz,
  new_expiration timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.master_billing_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.master_billing_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.master_manage_subscription(
  p_org_id uuid,p_action text,p_days integer DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
DECLARE old_status text; old_expires timestamptz;new_status text;new_expires timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_action NOT IN('activate','extend_trial','pending') OR p_action IS NULL THEN
    RAISE EXCEPTION 'Ação inválida';
  END IF;
  IF p_action='extend_trial' AND (p_days IS NULL OR p_days NOT BETWEEN 1 AND 90) THEN
    RAISE EXCEPTION 'A extensão deve ter de 1 a 90 dias';
  END IF;
  SELECT billing_status,trial_ends_at INTO old_status,old_expires
  FROM public.organizations WHERE id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escritório não encontrado'; END IF;
  new_status:=CASE WHEN p_action='activate' THEN 'active'
                   WHEN p_action='pending' THEN 'pending'
                   ELSE 'trialing' END;
  new_expires:=CASE WHEN p_action='extend_trial' THEN
     greatest(coalesce(old_expires,now()),now())+make_interval(days=>p_days)
     ELSE old_expires END;
  UPDATE public.organizations SET
    billing_status=new_status,
    trial_started_at=CASE WHEN p_action='extend_trial' THEN
      coalesce(trial_started_at,now()) ELSE trial_started_at END,
    trial_ends_at=new_expires
  WHERE id=p_org_id;
  INSERT INTO public.master_billing_audit(
    actor_user_id,org_id,action,old_status,new_status,old_expiration,new_expiration
  ) VALUES(auth.uid(),p_org_id,p_action,old_status,new_status,old_expires,new_expires);
END;
$$;
REVOKE ALL ON FUNCTION public.master_manage_subscription(uuid,text,integer)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_manage_subscription(uuid,text,integer)
  TO authenticated;

-- Acrescenta o período e o acesso atual à lista do Admin Master.
CREATE OR REPLACE FUNCTION public.master_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
DECLARE result jsonb;plans jsonb;
BEGIN
  IF NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb)
  INTO result FROM (
    SELECT o.id,o.name,o.created_at,o.plan_code,o.access_status,
      o.billing_status,o.trial_started_at,o.trial_ends_at,
      p.name AS plan_name,p.client_limit,p.monthly_price_brl,
      (SELECT count(*) FROM public.clients c WHERE c.org_id=o.id AND c.active) AS clients_active,
      (SELECT count(*) FROM public.obligations b WHERE b.org_id=o.id) AS charges_total,
      (SELECT count(*) FROM public.reminder_logs l WHERE l.org_id=o.id AND l.status='sent')
        AS notifications_accepted,
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

COMMIT;
