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
