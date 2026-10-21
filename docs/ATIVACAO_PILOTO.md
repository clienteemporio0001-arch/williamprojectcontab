# Ativação do ContabFlow — piloto seguro

Esta é a sequência para colocar o SaaS na nuvem e testar cobranças personalizadas por WhatsApp. As credenciais ficam com o proprietário das contas; **não as envie na conversa nem faça commit no GitHub**.

## 1. Banco de dados (Supabase)

1. Acesse https://supabase.com/dashboard e crie um projeto chamado ContabFlow (ou selecione um existente).
2. Em SQL Editor, execute uma única vez, nesta ordem:
   - [Migração inicial](../supabase/migrations/202610210001_init.sql)
   - [Cobrança de honorários](../supabase/migrations/202610210002_billing.sql)
3. Em Authentication, confirme se o cadastro/login por e-mail está habilitado e configure as URLs de redirecionamento autorizadas.
4. Anote localmente **Project URL**, **Publishable/anon key** e **Project Ref**. Somente a URL e chave pública vão ao frontend; senhas e service_role nunca entram no GitHub público.

## 2. Ligar a interface Web

No GitHub, abra **Settings > Secrets and variables > Actions > Variables** e crie:

- VITE_SUPABASE_URL = URL HTTPS do projeto
- VITE_SUPABASE_ANON_KEY = publishable/anon key pública do projeto

Uma nova execução de **Publicar demonstração Web** deve passar a carregar a tela de login e os dados reais do projeto. Sem essas variáveis, continua no modo demonstração. O deploy do Pages não publica as funções de servidor.

## 3. Publicar funções no Supabase pelo GitHub

1. No Supabase, gere um token de acesso com o menor privilégio viável, específico para o projeto.
2. No GitHub, em **Settings > Environments**, crie o ambiente `supabase-pilot` (se já não existir) e cadastre os Secrets:
   - SUPABASE_ACCESS_TOKEN: token de acesso do Supabase;
   - SUPABASE_PROJECT_ID: o Project Ref do projeto.
3. Em **Actions**, abra **Publicar funções Supabase (manual)** e clique em **Run workflow**.
4. O processo publica as funções `generate-charge` (JWT obrigatório) e `dispatch-reminders` (protegida por CRON_SECRET). O simples deploy **não ativa envios**, pois ainda não há agendamento e credenciais Meta.

Se o ambiente exigir aprovação de deployment, aprove apenas após revisar o projeto e a conta de destino.

## 4. Conectar WhatsApp oficial — sem usar extensões

Na Meta Business, vincule um número autorizado e configure o WhatsApp Cloud API. Solicite aprovação de um template da categoria utilidade com:

- Nome: cobranca_honorarios_pdf
- Idioma: pt_BR
- Cabeçalho do tipo DOCUMENT com arquivo PDF
- Corpo com 4 variáveis, nessa ordem: (1) nome, (2) serviço, (3) vencimento, (4) valor

Exemplo de corpo: "Olá {{1}}, segue em anexo o aviso de cobrança referente a {{2}}, com vencimento em {{3}}, no valor de {{4}}. Caso já tenha efetuado o pagamento, desconsidere esta mensagem."

A Meta decide sobre aprovação/categoria. A mensagem só pode ser enviada com autorização válida do destinatário.

Configure **somente em Supabase Edge Function Secrets**:

- CRON_SECRET (valor aleatório robusto)
- WHATSAPP_TOKEN
- WHATSAPP_PHONE_NUMBER_ID
- WHATSAPP_TEMPLATE_NAME = cobranca_honorarios_pdf
- WHATSAPP_TEMPLATE_LANG = pt_BR
- WHATSAPP_GRAPH_VERSION = versão suportada da Graph API

SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY devem estar configuradas no ambiente das funções. Nunca coloque SERVICE_ROLE no frontend ou README.

## 5. Testes sem envios reais

1. Faça login e crie seu primeiro escritório.
2. Configure nome do escritório, identificação e chave Pix.
3. Cadastre um **cliente fictício**, valor e vencimento e baixe o PDF.
4. Confirme que o PDF está identificado como **AVISO DE COBRANÇA**, nunca **RECIBO DE PAGAMENTO**.
5. Para simular a rotina, execute a Edge Function `dispatch-reminders` com:
   - Método POST
   - Cabeçalho x-cron-secret: o mesmo valor do secret CRON_SECRET
   - Corpo JSON: {"dry_run":true}
6. A resposta conta `wouldSend` (envios que seriam elegíveis) e **não cria PDFs, logs ou mensagens**. Não confunda esse teste com confirmação de entrega.
7. Cadastre um número real **de teste, com opt-in documentado**. Após confirmar que o modelo está aprovado e a conta está configurada, execute um piloto controlado antes de ativar um agendamento recorrente.

## 6. Agendar apenas depois do piloto

Habilite pg_cron e pg_net em Supabase e salve URL do projeto e CRON_SECRET no Vault. O SQL do agendamento está no [README principal](../README.md). O cron deve chamar dispatch-reminders uma vez por hora, com POST, e a função filtra o horário local para às 9h.

**Não ative o agendamento antes de verificar as informações Pix, os consentimentos, os valores e o modelo de cobrança.**

## Itens para a operação comercial futura

Ainda são necessários: gestão de números por escritório, confirmação de entrega por webhook, fila de retentativas, reprocessamento seguro, assinatura dos escritórios, opt-out automático, revisão LGPD e testes de escala. O status "enviado" indica apenas aceitação pela API; não equivale a pagamento ou leitura.
