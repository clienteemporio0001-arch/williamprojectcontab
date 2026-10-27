-- CONTABFLOW - ETAPA 4
-- Permitir ao Admin Master atualizar os preços mensais dos planos.
-- Executar no Supabase SQL Editor depois da Etapa 3.
-- Não cria assinaturas nem altera cobranças de gateway externo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.subscription_plan_price_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  plan_code text NOT NULL REFERENCES public.subscription_plans(code),
  old_monthly_price_brl numeric(10,2) NOT NULL,
  new_monthly_price_brl numeric(10,2) NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_plan_price_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_plan_price_audit
  FROM PUBLIC, anon, authenticated;
-- As alterações ficam auditadas e só podem ser lidas pelo administrador
-- usando o SQL Editor, não pelo navegador de um contador.

CREATE OR REPLACE FUNCTION public.master_update_plan_price(
  p_plan_code text,
  p_new_price numeric,
  p_expected_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_price numeric(10,2);
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master_admin() THEN
    RAISE EXCEPTION 'Acesso não autorizado ao Admin Master'
      USING ERRCODE = '42501';
  END IF;
  IF p_plan_code IS NULL OR length(trim(p_plan_code)) = 0 THEN
    RAISE EXCEPTION 'Informe um plano válido';
  END IF;
  IF p_new_price IS NULL
     OR p_new_price < 0
     OR p_new_price > 99999.99
     OR p_new_price <> round(p_new_price, 2) THEN
    RAISE EXCEPTION 'Informe um preço entre R$ 0,00 e R$ 99.999,99, com até 2 casas decimais';
  END IF;
  IF p_expected_price IS NULL THEN
    RAISE EXCEPTION 'Informe o preço anterior para confirmação';
  END IF;

  SELECT monthly_price_brl
    INTO v_old_price
    FROM public.subscription_plans
   WHERE code = p_plan_code
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plano não encontrado';
  END IF;
  IF v_old_price IS DISTINCT FROM p_expected_price THEN
    RAISE EXCEPTION 'O preço deste plano mudou. Atualize a página antes de salvar';
  END IF;
  IF v_old_price = p_new_price THEN
    RETURN;
  END IF;

  UPDATE public.subscription_plans
     SET monthly_price_brl = p_new_price
   WHERE code = p_plan_code;

  INSERT INTO public.subscription_plan_price_audit
    (actor_user_id,plan_code,old_monthly_price_brl,new_monthly_price_brl)
  VALUES (auth.uid(),p_plan_code,v_old_price,p_new_price);
END;
$$;

-- Somente a sessão autenticada pode chamar a função;
-- a função valida individualmente o privilégio Master.
REVOKE ALL ON FUNCTION
  public.master_update_plan_price(text,numeric,numeric)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.master_update_plan_price(text,numeric,numeric)
  TO authenticated;

COMMIT;

-- O retorno esperado é: Success. No rows returned.
