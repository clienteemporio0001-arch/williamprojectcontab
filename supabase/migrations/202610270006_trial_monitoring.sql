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
CREATE TABLE public.saas_activity_events (
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
CREATE INDEX saas_activity_org_time_idx
  ON public.saas_activity_events(org_id,occurred_at DESC);
CREATE INDEX saas_activity_recent_idx
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
