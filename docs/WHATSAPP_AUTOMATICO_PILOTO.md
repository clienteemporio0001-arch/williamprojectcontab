# WhatsApp ContabFlow: configurar uma vez, disparar automaticamente

O envio por WhatsApp usa **Meta WhatsApp Business Platform (Cloud API)**, não WhatsApp Web nem extensão do Chrome.
O cron do Supabase verifica as cobranças a cada 10 minutos; dentro da janela local das 09:00 às 09:59 o servidor procura cobranças pendentes cujas regras de aviso coincidam com a data. O PDF é gerado e anexado ao modelo de utilidade aprovado da Meta.

## 1. Primeiro conectar um número Meta (ambiente piloto)

1. Em https://developers.facebook.com/apps/ abra um aplicativo de negócio (Business).
2. Adicione o produto WhatsApp e entre em **WhatsApp → API Setup** (nomes podem variar).
3. Meta disponibiliza número de teste e token temporário para testes de desenvolvimento; adicione um telefone destinatário próprio e confirme o código solicitado. Não publique nem compartilhe o token.
4. Copie **Phone Number ID** e crie/obtenha token com permissão `whatsapp_business_messaging`. Para produção, use credencial de sistema adequada, vinculada à conta WhatsApp Business e ao número de produção.
5. Em **WhatsApp Manager → Message templates**, crie o template de categoria **Utility**, nome `cobranca_honorarios_pdf`, idioma `Português (Brasil)`, cabeçalho **Document**, com PDF de amostra. Corpo com **exatamente quatro variáveis** (exemplo abaixo). Aguarde a aprovação antes de enviar com a automação.

Texto sugerido (substituir pelas variáveis do template):

> Olá {{1}}! Segue o aviso de cobrança referente a {{2}}, com vencimento em {{3}} e valor de {{4}}. O PDF está anexado. Caso já tenha realizado o pagamento, desconsidere este aviso. Para dúvidas ou para deixar de receber lembretes, entre em contato com o escritório.

Campos preenchidos automaticamente: nome curto do cliente; título da cobrança; data de vencimento; valor em reais. O cabeçalho usa o PDF gerado pelo ContabFlow. Modelos podem ser reclassificados ou recusados pela Meta; use apenas o template efetivamente aprovado.

**O remetente do piloto será UM número WhatsApp configurado na Meta.** Para o SaaS atender vários contadores com o número de cada escritório, será necessário adicionar onboarding da WhatsApp Business Platform por escritório (Embedded Signup) e gerenciar credenciais isoladas; a versão atual não faz isso.

## 2. Supabase Edge Function Secrets (só no servidor)

Abra **Supabase → Edge Functions → Secrets** e cadastre:

| Nome | Valor |
| --- | --- |
| `WHATSAPP_TOKEN` | Token da Meta, com permissão whatsapp_business_messaging |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID, não o telefone de contato |
| `WHATSAPP_TEMPLATE_NAME` | cobranca_honorarios_pdf (ou o aprovado) |
| `WHATSAPP_TEMPLATE_LANG` | pt_BR |
| `WHATSAPP_GRAPH_VERSION` | Versão suportada pela Meta |
| `CRON_SECRET` | Segredo forte, aleatório, de pelo menos 32 caracteres |
| `DISPATCH_LIVE_ENABLED` | false até concluir a simulação |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são necessários à função; confirme que estão disponíveis. Não use a service_role no site.

E-mail/Resend podem permanecer sem configuração: `email_reminders_enabled=false` deixa o canal inativo.

## 3. Publicar a função

Na raiz do repositório, usando Supabase CLI com sessão autenticada:

```bash
supabase functions deploy dispatch-reminders --project-ref xglpxccavpxmowczvtnf --no-verify-jwt
```

Alternativa: configure `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_ID` como GitHub Actions Secrets no ambiente `supabase-pilot` e execute manualmente o workflow **Publicar funções Supabase (manual)**. O deploy da função NÃO habilita envios.

## 4. Configurar o escritório e a cobrança

- Use um escritório com **assinatura ativa** e acesso ativo (o teste gratuito é somente para experimentação sem disparos).
- Configurações: marque **Ativar lembretes por WhatsApp** e salve.
- Clientes: informe o telefone com DDD, em formato correto, e registre autorização explícita e sua origem.
- Cobranças: crie documento pendente, com valor e data; selecione os dias de lembrete (7, 3, 1, no vencimento, depois etc.).
- Para o teste com número Meta de desenvolvimento, o telefone de destino precisa estar habilitado na lista de destinatários de teste da Meta.

## 5. Simular sem enviar

No Supabase, com a função publicada, execute uma chamada autenticada com `x-cron-secret` e JSON `{"dry_run":true}`. O retorno inclui `wouldSendWhatsApp`.

A simulação não dispara mensagens e não consome os disparos no histórico. Por padrão, a rotina de produção só dispara entre **09:00 e 09:59 do fuso do escritório**, nunca fora da data de lembrete escolhida.

## 6. Ativar agendamento automático

No Supabase habilite as extensões `pg_cron` e `pg_net` e o Vault. No Vault cadastre:
- `contabflow_project_url`: `https://xglpxccavpxmowczvtnf.supabase.co`
- `contabflow_cron_secret`: exatamente o mesmo `CRON_SECRET` da Edge Function.

Depois de simular e verificar template, destinatário e PDF:
1. Atualize `DISPATCH_LIVE_ENABLED=true` nas Edge Function Secrets.
2. Abra **SQL Editor**, cole e execute **inteiro** `supabase/migrations/202610280003_whatsapp_auto_cron.sql`.
3. Confirme que a consulta final retorna `active=true` e que a aba **Integrations → Cron** mostra o job `contabflow-dispatch-10min`.
4. Um lançamento pendente e autorizado com data/offset correspondente será processado automaticamente no próximo horário.

O agendamento chama a Edge Function a cada 10 minutos (inclusive sem Chrome e PC). A função usa controle por canal para não reenviar o mesmo aviso no mesmo vencimento e offset.

## 7. Emergência, monitoramento e limites

- Para suspender imediatamente os envios, mude `DISPATCH_LIVE_ENABLED=false`.
- Para parar o agendador: `select cron.unschedule('contabflow-dispatch-10min');`.
- Acompanhe Supabase **Edge Functions → Logs**, **Cron → Job history** e no app **Automações → Histórico de envios**.
- O status `sent` significa apenas que a Meta aceitou a requisição e retornou um ID. Confirmação de entrega requer um webhook de status (etapa posterior).
- Não envie para clientes que não deram autorização específica. O fato de terem o contato salvo não é consentimento.
- Mensagens Meta podem ser tarifadas por modelo/país. Verifique os custos do seu provedor antes da escala.

**Apenas o primeiro cadastro e a definição da régua são manuais. O envio propriamente dito é automático.**
