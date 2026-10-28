-- CONTABFLOW ETAPA 8 · PEDIDOS DE CONTRATACAO COM APROVACAO SEGURA
-- Executar uma vez no SQL Editor. Nao altera clientes, valores ou escritórios.
BEGIN;
CREATE TABLE IF NOT EXISTS public.saas_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  plan_code text NOT NULL REFERENCES public.subscription_plans(code),
  price_brl numeric(10,2) NOT NULL CHECK (price_brl > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id),
  CONSTRAINT saas_upgrade_review_check CHECK (
    (status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL)
    OR (status<>'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_upgrade_one_pending_per_org
 ON public.saas_upgrade_requests(org_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS saas_upgrade_recent_idx
 ON public.saas_upgrade_requests(created_at DESC);
ALTER TABLE public.saas_upgrade_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saas_upgrade_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.saas_upgrade_requests TO authenticated;
DROP POLICY IF EXISTS upgrade_requests_owner_read ON public.saas_upgrade_requests;
CREATE POLICY upgrade_requests_owner_read ON public.saas_upgrade_requests
 FOR SELECT TO authenticated USING (public.is_org_owner(org_id));

-- O frontend apenas solicita, nunca ativa a assinatura.
CREATE OR REPLACE FUNCTION public.request_saas_upgrade(
  p_org_id uuid, p_plan_code text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_amount numeric(10,2); v_id uuid; v_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_owner(p_org_id) THEN
    RAISE EXCEPTION 'Apenas o responsavel pelo escritorio pode contratar'
      USING ERRCODE='42501';
  END IF;
  SELECT monthly_price_brl INTO v_amount
  FROM public.subscription_plans WHERE code=p_plan_code;
  IF NOT FOUND OR v_amount IS NULL OR v_amount<=0 THEN
    RAISE EXCEPTION 'Plano indisponivel para contratacao';
  END IF;
  -- Serializa pedidos do mesmo escritório, inclusive alteracoes simultaneas.
  PERFORM 1 FROM public.organizations WHERE id=p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Escritorio nao encontrado'; END IF;
  SELECT id INTO v_id FROM public.saas_upgrade_requests
    WHERE org_id=p_org_id AND status='pending' FOR UPDATE;
  IF v_id IS NOT NULL THEN
    UPDATE public.saas_upgrade_requests
      SET plan_code=p_plan_code,price_brl=v_amount,requested_by=auth.uid(),
          created_at=now()
      WHERE id=v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.saas_upgrade_requests(org_id,requested_by,plan_code,price_brl)
    VALUES(p_org_id,auth.uid(),p_plan_code,v_amount)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_saas_upgrade(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_saas_upgrade(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.master_list_upgrade_requests()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso exclusivo ao Admin Master' USING ERRCODE='42501';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC),'[]'::jsonb)
  INTO v_result FROM (
    SELECT r.id,r.org_id,r.plan_code,r.price_brl,r.status,r.created_at,
           r.reviewed_at,o.name AS office_name,p.name AS plan_name,
           u.email AS requester_email
      FROM public.saas_upgrade_requests r
      JOIN public.organizations o ON o.id=r.org_id
      JOIN public.subscription_plans p ON p.code=r.plan_code
      LEFT JOIN auth.users u ON u.id=r.requested_by
      ORDER BY r.created_at DESC LIMIT 200
  ) AS t;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.master_list_upgrade_requests() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_list_upgrade_requests() TO authenticated;

-- Liberacao somente apos verificacao externa do pagamento pelo administrador.
CREATE OR REPLACE FUNCTION public.master_review_upgrade_request(
 p_request_id uuid,p_approve boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_request public.saas_upgrade_requests%ROWTYPE;
 v_old_plan text;v_old_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso exclusivo ao Admin Master' USING ERRCODE='42501';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Decisao obrigatoria'; END IF;
  SELECT * INTO v_request FROM public.saas_upgrade_requests
    WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status<>'pending' THEN
    RAISE EXCEPTION 'Pedido nao existe ou ja foi avaliado';
  END IF;
  IF p_approve THEN
    SELECT plan_code,billing_status INTO v_old_plan,v_old_status
      FROM public.organizations WHERE id=v_request.org_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Escritorio nao encontrado'; END IF;
    UPDATE public.organizations SET plan_code=v_request.plan_code,
      billing_status='active',access_status='active'
      WHERE id=v_request.org_id;
    INSERT INTO public.master_billing_audit(
      actor_user_id,org_id,action,old_status,new_status,
      old_expiration,new_expiration
    )
    SELECT auth.uid(),o.id,'activate',v_old_status,'active',
      o.trial_ends_at,o.trial_ends_at
    FROM public.organizations o WHERE o.id=v_request.org_id;
  END IF;
  UPDATE public.saas_upgrade_requests SET
    status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    reviewed_at=now(),reviewed_by=auth.uid()
  WHERE id=p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.master_review_upgrade_request(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.master_review_upgrade_request(uuid,boolean)
 TO authenticated;
COMMIT;
NOTIFY pgrst,'reload schema';
SELECT to_regclass('public.saas_upgrade_requests') IS NOT NULL AS pedidos_instalados,
 to_regprocedure('public.request_saas_upgrade(uuid,text)') IS NOT NULL AS solicitar,
 to_regprocedure('public.master_list_upgrade_requests()') IS NOT NULL AS listar_admin,
 to_regprocedure('public.master_review_upgrade_request(uuid,boolean)') IS NOT NULL AS aprovar_admin;
