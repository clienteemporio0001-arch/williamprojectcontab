-- ===============================================================
-- CONTABFLOW • ATIVAÇÃO ÚNICA: TESTE GRÁTIS + PLANOS + MONITORAMENTO
-- Contém as Etapas 5, 6 e 7, nesta ordem.
-- Use no Supabase SQL Editor (projeto ContabFlow).
-- Não apaga clientes, documentos ou escritórios existentes.
-- Não cobra mensalidade automaticamente.
-- Se já personalizou a duração do teste, atenção: a Etapa 6 define
-- inicialmente 7 dias e 3 clientes. Depois ajuste em Planos SaaS.
-- ===============================================================

-- CONTABFLOW • ETAPA 5 • Teste gratuito configurável e status de assinatura
-- Execute uma vez, após as etapas 1 a 4. Não apaga os escritórios existentes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.saas_trial_settings (
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

CREATE TABLE IF NOT EXISTS public.saas_trial_settings_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  previous_value jsonb NOT NULL,
  next_value jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.saas_trial_settings_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_trial_settings_audit FROM PUBLIC,anon,authenticated;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'active'
    CHECK(billing_status IN('active','trialing','pending')),
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

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
CREATE TABLE IF NOT EXISTS public.master_billing_audit (
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


-- ================= ETAPA 6 =================
-- CONTABFLOW - ETAPA 6
-- Monitoramento de cadastros, auditoria e limites reais de demonstração.
-- Pré-requisito obrigatório: ETAPA 5 já executada no Supabase.
-- Executar uma única vez no SQL Editor. Não altera assinaturas ativas.
BEGIN;

UPDATE public.saas_trial_settings
   SET trial_max_clients=3, trial_days=7, trial_enabled=true, updated_at=now()
 WHERE id=1;

-- 3 clientes cadastrados no total durante o teste (ativos e inativos).
-- Outros planos mantêm o limite contratado de clientes ativos.
CREATE OR REPLACE FUNCTION public.enforce_client_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_status text; v_billing text; v_end timestamptz;
  v_plan_limit integer; v_trial_limit integer; v_count bigint;
BEGIN
  IF TG_OP='UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'Não é permitido mover clientes entre escritórios';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text,0));
  SELECT o.access_status,o.billing_status,o.trial_ends_at,p.client_limit
    INTO v_status,v_billing,v_end,v_plan_limit
    FROM public.organizations o
    JOIN public.subscription_plans p ON p.code=o.plan_code
   WHERE o.id=NEW.org_id;

  IF v_status IS DISTINCT FROM 'active'
    OR NOT (v_billing='active' OR
            (v_billing='trialing' AND v_end IS NOT NULL AND v_end>now())) THEN
    RAISE EXCEPTION 'Escritório com acesso expirado, suspenso ou pendente';
  END IF;

  IF v_billing='trialing' AND TG_OP='INSERT' THEN
    SELECT trial_max_clients INTO v_trial_limit
      FROM public.saas_trial_settings WHERE id=1;
    SELECT count(*) INTO v_count FROM public.clients WHERE org_id=NEW.org_id;
    IF v_count>=least(v_plan_limit,coalesce(v_trial_limit,3)) THEN
      RAISE EXCEPTION 'Limite do teste grátis atingido: máximo de % clientes cadastrados',
        least(v_plan_limit,coalesce(v_trial_limit,3));
    END IF;
  ELSIF v_billing='active' AND NEW.active
     AND (TG_OP='INSERT' OR NOT OLD.active) THEN
    SELECT count(*) INTO v_count
    FROM public.clients WHERE org_id=NEW.org_id AND active;
    IF v_count>=v_plan_limit THEN
      RAISE EXCEPTION 'Limite de clientes ativos do plano atingido (%)',v_plan_limit;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_client_plan_limit()
  FROM PUBLIC,anon,authenticated;

-- Máximo de 3 cobranças cadastradas durante o teste.
-- A recorrência permanece gerenciável, mas a 4ª geração é impedida.
CREATE OR REPLACE FUNCTION public.enforce_trial_charge_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_billing text;v_end timestamptz;v_access text;v_count bigint;
BEGIN
  IF TG_OP='UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'Não é permitido mover cobranças entre escritórios';
  END IF;
  IF TG_OP<>'INSERT' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.org_id::text,0));
  SELECT access_status,billing_status,trial_ends_at
    INTO v_access,v_billing,v_end
    FROM public.organizations WHERE id=NEW.org_id;
  IF v_access IS DISTINCT FROM 'active' OR
    NOT(v_billing='active' OR
       (v_billing='trialing' AND v_end IS NOT NULL AND v_end>now())) THEN
    RAISE EXCEPTION 'Escritório com acesso expirado, suspenso ou pendente';
  END IF;
  IF v_billing='trialing' THEN
    SELECT count(*) INTO v_count FROM public.obligations
     WHERE org_id=NEW.org_id;
    IF v_count>=3 THEN
      RAISE EXCEPTION 'Limite do teste grátis atingido: máximo de 3 cobranças';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_trial_charge_limit()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS obligations_trial_limit ON public.obligations;
CREATE TRIGGER obligations_trial_limit BEFORE INSERT OR UPDATE ON public.obligations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_trial_charge_limit();

-- O banco também impede que uma função antiga dispare mensagens durante a avaliação:
-- a rotina de envio deve reservar a tentativa em reminder_logs ANTES do WhatsApp.
CREATE OR REPLACE FUNCTION public.block_trial_automatic_reminders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.organizations o
      WHERE o.id=NEW.org_id AND o.access_status='active'
        AND o.billing_status='active'
  ) THEN
    RAISE EXCEPTION 'Envio automático indisponível durante avaliação ou acesso bloqueado';
  END IF;
  RETURN NEW;
END;
$;
REVOKE ALL ON FUNCTION public.block_trial_automatic_reminders()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trial_reminder_guard ON public.reminder_logs;
CREATE TRIGGER trial_reminder_guard
  BEFORE INSERT ON public.reminder_logs
  FOR EACH ROW EXECUTE FUNCTION public.block_trial_automatic_reminders();

-- Eventos não contêm nomes, números ou valores financeiros.
-- Apenas tipo de ação, escritório, horário e identificador técnico.
CREATE TABLE IF NOT EXISTS public.saas_activity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid,
  event_type text NOT NULL CHECK(event_type IN(
    'client_created','client_updated','client_deleted',
    'charge_created','charge_updated','charge_deleted',
    'charge_paid','charge_reopened','pdf_generated')),
  entity_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saas_activity_org_time_idx
  ON public.saas_activity_events(org_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS saas_activity_recent_idx
  ON public.saas_activity_events(occurred_at DESC);
ALTER TABLE public.saas_activity_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_activity_events FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.log_saas_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_kind text;v_org uuid;v_entity uuid;v_before text;v_after text;
BEGIN
  v_org:=CASE WHEN TG_OP='DELETE' THEN OLD.org_id ELSE NEW.org_id END;
  v_entity:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
  IF TG_TABLE_NAME='clients' THEN
    v_kind:=CASE TG_OP WHEN 'INSERT' THEN 'client_created'
       WHEN 'UPDATE' THEN 'client_updated' ELSE 'client_deleted' END;
  ELSE
    v_kind:=CASE TG_OP WHEN 'INSERT' THEN 'charge_created'
       WHEN 'DELETE' THEN 'charge_deleted' ELSE 'charge_updated' END;
    IF TG_OP='UPDATE' THEN
      v_before:=OLD.status;v_after:=NEW.status;
      IF v_after='paid' AND v_before IS DISTINCT FROM v_after THEN
        v_kind:='charge_paid';
      ELSIF v_before='paid' AND v_after='pending' THEN
        v_kind:='charge_reopened';
      END IF;
    END IF;
  END IF;
  INSERT INTO public.saas_activity_events(org_id,actor_user_id,event_type,entity_id)
  VALUES(v_org,auth.uid(),v_kind,v_entity);
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.log_saas_activity()
 FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS clients_saas_activity ON public.clients;
CREATE TRIGGER clients_saas_activity AFTER INSERT OR UPDATE OR DELETE
 ON public.clients FOR EACH ROW EXECUTE FUNCTION public.log_saas_activity();
DROP TRIGGER IF EXISTS charges_saas_activity ON public.obligations;
CREATE TRIGGER charges_saas_activity AFTER INSERT OR UPDATE OR DELETE
 ON public.obligations FOR EACH ROW EXECUTE FUNCTION public.log_saas_activity();

-- Monitor de registros, incluindo contas ainda sem escritório (e-mail não confirmado).
-- Somente o Admin Master pode consultar estes dados.
CREATE OR REPLACE FUNCTION public.master_monitor(
  p_org_id uuid DEFAULT NULL,p_limit integer DEFAULT 80
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_signups jsonb;v_events jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN
    RAISE EXCEPTION 'Limite inválido';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(reg) ORDER BY reg.registered_at DESC),'[]'::jsonb)
  INTO v_signups FROM (
    SELECT u.id AS user_id,u.email,
      u.raw_user_meta_data->>'full_name' AS full_name,
      u.raw_user_meta_data->>'office_name' AS declared_office_name,
      u.created_at AS registered_at,
      u.email_confirmed_at IS NOT NULL AS verified,
      u.last_sign_in_at,
      o.id AS org_id,o.name AS office_name,
      o.billing_status,o.access_status,o.trial_ends_at
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT a.org_id FROM public.organization_members a
       WHERE a.user_id=u.id ORDER BY a.created_at LIMIT 1
    ) m ON TRUE
    LEFT JOIN public.organizations o ON o.id=m.org_id
    WHERE NOT EXISTS(SELECT 1 FROM public.master_admins ma WHERE ma.user_id=u.id)
      AND (p_org_id IS NULL OR o.id=p_org_id)
    ORDER BY u.created_at DESC LIMIT 200
  ) reg;

  SELECT coalesce(jsonb_agg(to_jsonb(ev) ORDER BY ev.occurred_at DESC),'[]'::jsonb)
  INTO v_events FROM (
    SELECT a.id,a.org_id,a.actor_user_id,a.event_type,a.entity_id,a.occurred_at,
      o.name AS office_name
    FROM public.saas_activity_events a
    JOIN public.organizations o ON o.id=a.org_id
    WHERE p_org_id IS NULL OR a.org_id=p_org_id
    ORDER BY a.occurred_at DESC LIMIT p_limit
  ) ev;

  RETURN jsonb_build_object('registrations',v_signups,'activities',v_events);
END;
$$;
REVOKE ALL ON FUNCTION public.master_monitor(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_monitor(uuid,integer) TO authenticated;
COMMIT;


-- ================= ETAPA 7 =================
-- CONTABFLOW • ETAPA 7 — Seleção de plano + teste grátis junto dos planos
-- Pré-requisitos: SQL das Etapas 5 e 6 executados.
-- A conta escolhe o plano no cadastro (auth.users.raw_user_meta_data.selected_plan_code).
-- O teste grátis usa a duração global ajustada pelo Admin Master em Planos SaaS.
-- Nenhuma assinatura é cobrada ou ativada automaticamente.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_workspace(workspace_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,pg_temp
AS $$
DECLARE
  new_id uuid;
  trial_conf public.saas_trial_settings%ROWTYPE;
  selected_plan text;
  selected_from_signup text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login antes de criar seu escritório';
  END IF;
  IF workspace_name IS NULL
     OR length(trim(workspace_name)) < 2 OR length(workspace_name)>100 THEN
    RAISE EXCEPTION 'Nome do escritório inválido';
  END IF;

  -- Evita que uma mesma conta crie várias avaliações gratuitas.
  IF EXISTS(
     SELECT 1 FROM public.organization_members WHERE user_id=auth.uid()
  ) THEN
    RAISE EXCEPTION 'Este usuário já pertence a um escritório';
  END IF;

  SELECT (u.raw_user_meta_data->>'selected_plan_code')
    INTO selected_from_signup
    FROM auth.users u
   WHERE u.id=auth.uid();

  -- Compatibilidade com cadastros antigos: plano com menor limite de clientes.
  IF selected_from_signup IS NULL OR trim(selected_from_signup)='' THEN
    SELECT p.code INTO selected_plan FROM public.subscription_plans p
     ORDER BY p.client_limit ASC LIMIT 1;
  ELSE
    SELECT p.code INTO selected_plan FROM public.subscription_plans p
     WHERE p.code=selected_from_signup;
  END IF;

  IF selected_plan IS NULL THEN
    RAISE EXCEPTION 'Plano escolhido inválido. Volte ao cadastro ou fale com o suporte';
  END IF;

  SELECT * INTO trial_conf FROM public.saas_trial_settings WHERE id=1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração do teste grátis não encontrada';
  END IF;

  INSERT INTO public.organizations(
    name,plan_code,billing_status,trial_started_at,trial_ends_at
  ) VALUES(
    trim(workspace_name),
    selected_plan,
    CASE WHEN trial_conf.trial_enabled THEN 'trialing' ELSE 'pending' END,
    CASE WHEN trial_conf.trial_enabled THEN now() ELSE NULL END,
    CASE WHEN trial_conf.trial_enabled
      THEN now()+make_interval(days=>trial_conf.trial_days)
      ELSE NULL END
  ) RETURNING id INTO new_id;

  INSERT INTO public.organization_members(org_id,user_id,role)
  VALUES(new_id,auth.uid(),'owner');

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;

-- Permite visualizar no Admin Master a escolha feita mesmo antes de o
-- contador confirmar seu e-mail ou criar o escritório.
CREATE OR REPLACE FUNCTION public.master_monitor(
  p_org_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_signups jsonb;v_events jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>200 THEN
    RAISE EXCEPTION 'Limite inválido';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(reg) ORDER BY reg.registered_at DESC),'[]'::jsonb)
    INTO v_signups FROM (
    SELECT u.id AS user_id,u.email,
      u.raw_user_meta_data->>'full_name' AS full_name,
      u.raw_user_meta_data->>'office_name' AS declared_office_name,
      u.raw_user_meta_data->>'selected_plan_code' AS selected_plan_code,
      u.created_at AS registered_at,
      u.email_confirmed_at IS NOT NULL AS verified,
      u.last_sign_in_at,
      o.id AS org_id,o.name AS office_name,
      o.plan_code,o.billing_status,o.access_status,o.trial_ends_at
    FROM auth.users u
    LEFT JOIN LATERAL (
      SELECT a.org_id FROM public.organization_members a
       WHERE a.user_id=u.id ORDER BY a.created_at LIMIT 1
    ) m ON TRUE
    LEFT JOIN public.organizations o ON o.id=m.org_id
    WHERE NOT EXISTS(SELECT 1 FROM public.master_admins ma WHERE ma.user_id=u.id)
      AND (p_org_id IS NULL OR o.id=p_org_id)
    ORDER BY u.created_at DESC LIMIT 200
  ) reg;

  SELECT coalesce(jsonb_agg(to_jsonb(ev) ORDER BY ev.occurred_at DESC),'[]'::jsonb)
    INTO v_events FROM (
    SELECT a.id,a.org_id,a.actor_user_id,a.event_type,a.entity_id,a.occurred_at,
      o.name AS office_name
    FROM public.saas_activity_events a
    JOIN public.organizations o ON o.id=a.org_id
    WHERE p_org_id IS NULL OR a.org_id=p_org_id
    ORDER BY a.occurred_at DESC LIMIT p_limit
  ) ev;

  RETURN jsonb_build_object('registrations',v_signups,'activities',v_events);
END;
$$;

REVOKE ALL ON FUNCTION public.master_monitor(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_monitor(uuid,integer) TO authenticated;

COMMIT;

-- Esperado: Success. No rows returned.
-- Após executar, teste um cadastro com plano Profissional e confira em
-- Admin Master > Escritórios se ele ficou vinculado ao Profissional.
