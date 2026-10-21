# ContabFlow — Ativar Admin Master

## O que foi implementado
- Central independente e responsiva, exclusiva do administrador SaaS.
- Visão geral: escritórios cadastrados, clientes ativos somados, suspensões e mensalidades **potenciais** por plano.
- Lista de escritórios, responsável, plano, capacidade, número de cobranças e situação.
- Alteração de plano e suspensão/reativação com auditoria das operações.
- Limites de clientes ativos aplicados pelo banco e suspensão aplicada a RLS, PDFs e rotinas automáticas.
- Três planos iniciais: Essencial (50, R$ 69,90), Profissional (150, R$ 99,90) e Plus (300, R$ 127,00).
- **Ainda não existe gateway de assinatura**: o painel não registra pagamentos nem receita real.

## 1. Executar a Etapa 3 no Supabase

Abra Supabase > ContabFlow > SQL Editor > New Query.

Abra o arquivo \`supabase/migrations/202610210003_admin_master.sql\` e execute **integralmente**, uma única vez, depois das migrações 001 e 002.

O SQL cria as funções autorizadas. Ele **não transforma ninguém em master automaticamente** e não exige que você informe senhas.

## 2. Registrar seu usuário como administrador master

Primeiro, acesse o ContabFlow pelo navegador, clique em Cadastre-se e confirme o e-mail, se necessário.

No Supabase, abra **Authentication > Users** e confira que seu usuário já existe.

No **SQL Editor**, execute o bloco abaixo substituindo APENAS o endereço entre aspas pelo **e-mail da sua própria conta cadastrada**. Não compartilhe o e-mail ou credenciais aqui se preferir.

~~~sql
DO $$
DECLARE chosen_user_id uuid;
BEGIN
  SELECT id INTO chosen_user_id
  FROM auth.users
  WHERE lower(email)=lower('SEU_EMAIL_CADASTRADO_AQUI')
    AND email_confirmed_at IS NOT NULL;
  IF chosen_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não encontrado ou e-mail não confirmado';
  END IF;
  INSERT INTO public.master_admins(user_id) VALUES (chosen_user_id)
  ON CONFLICT(user_id) DO NOTHING;
END;
$$;
~~~

Não use no SQL um e-mail que não pertence a você. A tabela \`master_admins\` **não tem políticas de inserção para usuários comuns**.

**Teste:** saia e entre novamente no ContabFlow (ou recarregue após entrar). O acesso Master será verificado pelo banco e abrirá automaticamente para o usuário autorizado. Para uma conta comum, o Admin Master não aparece e a consulta é negada pelo servidor.

## 3. Publicar backend atualizado

A atualização de frontend é automática com GitHub Pages. Já as funções Supabase só são publicadas manualmente, após configurar os segredos no ambiente GitHub \`supabase-pilot\`:

- \`SUPABASE_ACCESS_TOKEN\` — token do Supabase (segredo; não cole em variáveis públicas).
- \`SUPABASE_PROJECT_ID\` — Project Ref (identificador do projeto).

Vá em GitHub > Actions > **Publicar funções Supabase (manual)** para publicar \`generate-charge\` e \`dispatch-reminders\`. A atualização do agendador é obrigatória antes de ativar suspensões, pois ela impede envios de escritórios suspensos. Não ative agendamento de mensagens até validar a API Meta.

## Segurança e ressalvas

- O master recebe somente totais e nome/e-mail do responsável. Ele não recebe CPFs, Pix ou contatos finais dos clientes dos escritórios.
- O master é concedido apenas manualmente via SQL Editor, com usuário autenticado e confirmado; não há cadastro Master público.
- Escritórios suspensos não conseguem acessar/alterar os registros da sua carteira nem gerar PDFs. Uma suspensão não apaga dados.
- Reduzir um plano não apaga clientes já existentes, mas impede novos clientes ativos enquanto exceder o limite.
- O indicador de receita mensal é uma estimativa pelos valores dos planos, **não um sistema de cobrança de assinaturas**.
- Antes do lançamento comercial, implementar assinatura e validação automática de pagamentos, notificações de entrega e LGPD.

**Se a migração 003 falhar, pare e envie a mensagem exata de erro; não tente executar trechos isolados.**
