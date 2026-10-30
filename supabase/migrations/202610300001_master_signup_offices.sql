-- CONTABFLOW: gestão de pré-cadastros e liberações por pagamento externo
-- Funções acessíveis apenas a usuários autenticados que sejam Admin Master.
BEGIN;

CREATE OR REPLACE FUNCTION public.master_provision_signup(
  p_user_id uuid,
  p_plan_code text,
  p_activate boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,pg_temp
AS $fn$
DECLARE
  v_user auth.users%ROWTYPE;
  v_name text;
  v_org_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso exclusivo ao Admin Master' USING ERRCODE='42501';
  END IF;

  IF p_user_id IS NULL OR p_plan_code IS NULL OR p_activate IS NULL THEN
    RAISE EXCEPTION 'Dados obrigatórios ausentes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subscription_plans WHERE code=p_plan_code
  ) THEN
    RAISE EXCEPTION 'Plano inexistente';
  END IF;

  SELECT * INTO v_user FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cadastro não localizado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.master_admins WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION 'Conta administrativa não pode ser provisionada como cliente';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id=p_user_id) THEN
    RAISE EXCEPTION 'Esse cadastro já pertence a um escritório. Atualize a lista.';
  END IF;

  v_name := nullif(btrim(v_user.raw_user_meta_data->>'office_name'), '');
  IF v_name IS NULL THEN
    v_name := 'Escritório de ' || coalesce(
      nullif(btrim(v_user.raw_user_meta_data->>'full_name'), ''),
      split_part(coalesce(v_user.email, ''),'@',1),
      'Novo cadastro'
    );
  END IF;
  v_name := left(v_name,100);
  IF length(v_name)<2 THEN v_name := 'Escritório ' || left(p_user_id::text,8); END IF;

  INSERT INTO public.organizations (
    name,plan_code,billing_status,access_status,trial_started_at,trial_ends_at
  ) VALUES (
    v_name,p_plan_code,
    CASE WHEN p_activate THEN 'active' ELSE 'pending' END,
    'active',NULL,NULL
  ) RETURNING id INTO v_org_id;

  INSERT INTO public.organization_members(org_id,user_id,role)
    VALUES (v_org_id,p_user_id,'owner');

  INSERT INTO public.master_audit_logs(
    actor_user_id,org_id,action,previous_value,next_value
  ) VALUES (
    auth.uid(),v_org_id,'provision_signup',NULL,
    jsonb_build_object('user_id',p_user_id,'plan',p_plan_code,
      'billing_status',CASE WHEN p_activate THEN 'active' ELSE 'pending' END)
  );

  IF p_activate THEN
    INSERT INTO public.master_billing_audit(
      actor_user_id,org_id,action,old_status,new_status,
      old_expiration,new_expiration
    ) VALUES (
      auth.uid(),v_org_id,'activate','pending','active',NULL,NULL
    );
  END IF;

  RETURN v_org_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.master_provision_signup(uuid,text,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.master_provision_signup(uuid,text,boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.master_activate_paid_plan(
  p_org_id uuid,
  p_plan_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public,pg_temp
AS $fn$
DECLARE
  v_prior public.organizations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso exclusivo ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_org_id IS NULL OR p_plan_code IS NULL THEN
    RAISE EXCEPTION 'Escolha um escritório e plano';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE code=p_plan_code) THEN
    RAISE EXCEPTION 'Plano inexistente';
  END IF;

  SELECT * INTO v_prior FROM public.organizations WHERE id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escritório não localizado'; END IF;

  IF v_prior.billing_status='active' AND v_prior.plan_code=p_plan_code
     AND v_prior.access_status='active' THEN
    RETURN;
  END IF;

  UPDATE public.organizations
    SET plan_code=p_plan_code,billing_status='active',access_status='active'
    WHERE id=p_org_id;

  INSERT INTO public.master_audit_logs (
    actor_user_id,org_id,action,previous_value,next_value
  ) VALUES (
    auth.uid(),p_org_id,'external_payment_plan_activation',
    jsonb_build_object('plan',v_prior.plan_code,'billing',v_prior.billing_status,
      'access',v_prior.access_status),
    jsonb_build_object('plan',p_plan_code,'billing','active','access','active')
  );

  INSERT INTO public.master_billing_audit (
    actor_user_id,org_id,action,old_status,new_status,
    old_expiration,new_expiration
  ) VALUES (
    auth.uid(),p_org_id,'activate',v_prior.billing_status,'active',
    v_prior.trial_ends_at,v_prior.trial_ends_at
  );

  -- Um pagamento conferido manualmente finaliza solicitações abertas;
  -- a solicitação do mesmo plano é aprovada, outras são rejeitadas.
  UPDATE public.saas_upgrade_requests
    SET status=CASE WHEN plan_code=p_plan_code THEN 'approved' ELSE 'rejected' END,
        reviewed_at=now(),reviewed_by=auth.uid()
    WHERE org_id=p_org_id AND status='pending';
END;
$fn$;

REVOKE ALL ON FUNCTION public.master_activate_paid_plan(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.master_activate_paid_plan(uuid,text)
  TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
