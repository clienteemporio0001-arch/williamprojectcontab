# ContabFlow — ativação dos disparos por E-mail e WhatsApp

## Estado da implementação
- A função `supabase/functions/dispatch-reminders/index.ts` inclui Resend e WhatsApp Business Cloud API.
- Sem uso de navegador, extensão ou computador ligado.
- O Supabase gerencia cron e worker, mas **nada é disparado até a configuração explícita**.
- Por segurança, `DISPATCH_LIVE_ENABLED` precisa estar definido como `true`; do contrário, o worker só aceita simulação (`dry_run:true`).
- Escritórios em teste ou suspensos **não disparam**; precisa `billing_status='active'`.
- Cada escritório escolhe quais canais ativar em Configurações; ambos vêm desativados.
- Cada cliente tem opt-in registrado separadamente para os dois canais.
- Uma cobrança marcada como paga não deve continuar disparando lembretes.
- Mesmo vencimento pode gerar um e-mail e um WhatsApp, mas o histórico impede repetir o mesmo canal no mesmo dia/offset.
- O campo "Aceito pela API" não significa "Entregue", "Lido" ou "Pago".

## Passo 1: banco
Cole integralmente `supabase/migrations/202610280002_dual_channel_reminders.sql` no **Supabase → SQL Editor → New query → Run**.
Veja os quatro indicadores `true`. A migração inclui um bloqueio de alteração direta dos campos de plano pago e status de assinatura pelo usuário.

## Passo 2: contas e segredos de provedores
**E-mail**: crie sua conta em https://resend.com e valide um domínio remetente, por exemplo `cobrancas@SEU-DOMINIO.com.br`. Crie chave de API e configure os segredos da Edge Function:
- `RESEND_API_KEY`: chave privada
- `RESEND_FROM_EMAIL`: remetente do domínio validado (ex.: `ContabFlow <cobrancas@SEU-DOMINIO.com.br>`)

**WhatsApp**: tenha WhatsApp Business Platform (Cloud API), Meta Business verificada conforme necessário, `Phone Number ID`, token de acesso adequado e um **template de utilidade aprovado**, com cabeçalho DOCUMENT e quatro variáveis no corpo.
- `WHATSAPP_TOKEN`: token privado (nunca no front-end)
- `WHATSAPP_PHONE_NUMBER_ID`: identificador do número remetente
- `WHATSAPP_TEMPLATE_NAME`: nome do template aprovado
- `WHATSAPP_TEMPLATE_LANG`: `pt_BR`
- `WHATSAPP_GRAPH_VERSION`: versão atualmente compatível da Graph API

Template de utilidade recomendado, com documento no cabeçalho:
"Olá {{1}}, segue o aviso de cobrança referente a {{2}}, com vencimento em {{3}} e valor de {{4}}. Se você já efetuou o pagamento, desconsidere este aviso. Em caso de dúvidas, responda à mensagem."

**Infraestrutura**
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (o projeto Supabase costuma fornecê-los)
- `CRON_SECRET`: gere segredo forte exclusivo para o job; não compartilhe em conversas.
- `DISPATCH_LIVE_ENABLED`: `false` enquanto testa.

Todos os valores vão em **Supabase → Edge Functions → Secrets**. Nunca inclua tokens no GitHub ou em variáveis `VITE_*`.

## Passo 3: publicar a Edge Function
No seu terminal, com a CLI Supabase autenticada e vinculada ao projeto:
```bash
supabase functions deploy dispatch-reminders --project-ref SEU_PROJECT_REF --no-verify-jwt
```
Ou use o workflow manual `.github/workflows/deploy-supabase.yml` após configurar `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_ID` como GitHub Actions environment secrets no ambiente `supabase-pilot`.

A API da função só aceita POST com header `x-cron-secret` igual a `CRON_SECRET`.

## Passo 4: simular sem enviar
Com a função implantada, faça um POST autenticado para
`https://SEU_PROJECT_REF.supabase.co/functions/v1/dispatch-reminders`:
```bash
curl -X POST "https://SEU_PROJECT_REF.supabase.co/functions/v1/dispatch-reminders" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: SEU_CRON_SECRET" \
  -d '{"dry_run":true}'
```
O retorno mostrará `wouldSendEmail` e `wouldSendWhatsApp`, sem gerar PDFs, criar novas competências, chamar APIs externas ou gravar logs.

Para aparecerem destinatários, use um escritório **com assinatura ativa**, habilite o canal em Configurações, cadastre cliente ativo com autorização do canal e uma cobrança pendente com data na régua escolhida.

## Passo 5: agendamento 100% em nuvem
Use Supabase Cron (`pg_cron`) + `pg_net` e armazene a URL do projeto e o `CRON_SECRET` no Supabase Vault. **Não cole valores reais de segredos nos scripts SQL armazenados no GitHub.**

No Vault, crie:
- `contabflow_project_url`: `https://SEU_PROJECT_REF.supabase.co`
- `contabflow_cron_secret`: o mesmo segredo configurado em `CRON_SECRET` na Edge Function.

Depois de testar, no SQL Editor:
```sql
select cron.schedule(
  'contabflow-dispatch-10min',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='contabflow_project_url') || '/functions/v1/dispatch-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='contabflow_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $job$
);
```
O worker efetua disparos apenas entre 09:00 e 09:59 **no fuso do escritório**. O agendamento a cada dez minutos permite novas tentativas de processamento sem reenviar o mesmo registro.

Habilite `DISPATCH_LIVE_ENABLED=true` **apenas após**:
1. testar `dry_run:true`;
2. aprovar template Meta e validar remetente Resend;
3. enviar mensagens para destinatários de teste que consentiram;
4. confirmar que o histórico funciona.

Para pausar imediatamente: defina `DISPATCH_LIVE_ENABLED=false` ou desative o cron no painel Supabase.

## Limites do piloto
- Os envios da Meta usam **um único número central**. Para SaaS de vários escritórios, implementar credenciais e identificação de remetente por escritório antes de escalar.
- O e-mail parte do domínio central verificado. Não se passa pelo domínio do contador sem autorização.
- Não há monitoramento de webhooks de entrega/leitura, bounces, opt-out por resposta ou retry automático.
- O envio é limitado a 200 escritórios e 1000 cobranças por escritório por ciclo de processamento. Planejar paginação/filas antes de escalar.
- Antes da operação real, testar com dados sintéticos e revisar consentimento, política de dados, bloqueios e custos dos provedores.
