-- ContabFlow - exclusão definitiva por ação explícita do usuário.
-- A função só aceita chamadas server-side (service_role), após autenticação/RLS
-- na Edge Function. O Storage é removido antes pela API oficial.
BEGIN;

CREATE OR REPLACE FUNCTION public.purge_office_record(
  p_org_id uuid,
  p_record_id uuid,
  p_kind text,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_charge_count integer := 0;
  v_removed integer := 0;
BEGIN
  IF p_kind NOT IN ('client', 'obligation') THEN
    RAISE EXCEPTION 'Tipo de registro inválido' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = p_org_id AND m.user_id = p_actor_id
  ) OR NOT public.is_org_active(p_org_id) THEN
    RAISE EXCEPTION 'Sem acesso ativo ao escritório' USING ERRCODE='42501';
  END IF;

  IF p_kind = 'client' THEN
    -- Trava o cliente no ato da exclusão para impedir novas cobranças vinculadas.
    PERFORM 1 FROM public.clients c
      WHERE c.id = p_record_id AND c.org_id = p_org_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente não encontrado neste escritório' USING ERRCODE='P0002';
    END IF;
    SELECT count(*) INTO v_charge_count FROM public.obligations o
      WHERE o.org_id = p_org_id AND o.client_id = p_record_id;

    -- As FKs ON DELETE CASCADE removem billing_documents/reminder_logs.
    DELETE FROM public.obligations o
      WHERE o.org_id = p_org_id AND o.client_id = p_record_id;
    DELETE FROM public.clients c
      WHERE c.org_id = p_org_id AND c.id = p_record_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    IF v_removed <> 1 THEN
      RAISE EXCEPTION 'Exclusão do cliente não confirmada' USING ERRCODE='P0002';
    END IF;
    RETURN jsonb_build_object('deleted', true,'kind','client','charges_deleted',v_charge_count);
  ELSE
    PERFORM 1 FROM public.obligations o
      WHERE o.id=p_record_id AND o.org_id=p_org_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cobrança não encontrada neste escritório' USING ERRCODE='P0002';
    END IF;
    DELETE FROM public.obligations o
      WHERE o.org_id=p_org_id AND o.id=p_record_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    IF v_removed <> 1 THEN
      RAISE EXCEPTION 'Exclusão da cobrança não confirmada' USING ERRCODE='P0002';
    END IF;
    RETURN jsonb_build_object('deleted',true,'kind','obligation','charges_deleted',1);
  END IF;
END;
$function$;

-- SECURITY DEFINER não é exposto aos usuários nem à chave pública.
REVOKE ALL ON FUNCTION public.purge_office_record(uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_office_record(uuid,uuid,text,uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_office_record(uuid,uuid,text,uuid) TO service_role;

COMMIT;
