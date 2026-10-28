# CONTABFLOW — WhatsApp por escritório: implementação Embedded Signup

## O que já está no GitHub (não equivale a produção ativada)
- `src/WhatsAppConnectionPanel.tsx`: botão **Conectar meu WhatsApp Business**, tentativa de coexistência do app Business e status individual por escritório.
- `supabase/functions/whatsapp-connect/index.ts`: troca do código OAuth no backend, valida propriedade do número na WABA, criptografa token, tenta assinar os webhooks da Meta, permite revogar integração pelo painel.
- `supabase/functions/whatsapp-webhook/index.ts`: Meta GET challenge e POST com assinatura HMAC SHA-256; registra envio, entrega, leitura e falha apenas no escritório correto (não armazena o conteúdo de mensagens recebidas).
- `supabase/functions/dispatch-reminders/index.ts`: para WhatsApp, exige token + phone_number_id da **mesma organização**, conta ativa, cliente com autorização, template aprovado e data correta; não recai em telefone global de outro escritório.
- `supabase/migrations/202610280004_whatsapp_per_office.sql`: conexão por escritório com RLS e token criptografado, além de status de entrega.

## 1. Meta: aprovação para conectar números de outros contadores
No app ContabFlow (Meta for Developers) escolha **Torne-se um Provedor de Tecnologia** e inicie a habilitação. Prepare:
- Verificação empresarial do portfólio proprietário do SaaS;
- App Review/Advanced Access para `whatsapp_business_messaging`, `whatsapp_business_management` (e `business_management` se o produto exigir);
- Facebook Login for Business com **WhatsApp Embedded Signup** (versão atual: v4, se oferecida), selecionando somente os recursos necessários;
- Política de privacidade, termos, procedimentos de exclusão de dados, URL HTTPS do aplicativo e demais requisitos de revisão. O painel da Meta é a referência final dos requisitos.
- Os contadores conectarão seus próprios portfólios, contas WhatsApp e números, autorizando acesso via janela oficial da Meta.

**Sem essas aprovações, não é possível garantir conexão de contas externas em produção.** O botão no site pode estar pronto, mas não criará permissões que a Meta ainda não concedeu.

## 2. Criar Meta Configuration ID
Abra **Meta for Developers → ContabFlow → Facebook Login for Business → Configurações**.
Crie uma configuração de **WhatsApp Embedded Signup**; inclua WhatsApp Cloud API, ativos WhatsApp Business e permissões `whatsapp_business_management` + `whatsapp_business_messaging`.
Guarde o **Configuration ID**. Permita JavaScript SDK e defina o domínio autorizado:
`https://clienteemporio0001-arch.github.io`
e redirecionamento válido (caminho exato, se Meta solicitar):
`https://clienteemporio0001-arch.github.io/williamprojectcontab/`.
Ative modo Live/publicação somente quando a revisão da Meta autorizar.

Se for desejado manter o aplicativo WhatsApp Business e a API no **mesmo número**, a conta do cliente precisa ser elegível para **coexistência**, e a configuração da Meta precisa ter esse fluxo habilitado. Não exclua números existentes para tentar forçar a conexão.

## 3. GitHub Pages: duas Repository Variables públicas (NÃO tokens)
GitHub → repositório williamprojectcontab → Settings → Secrets and variables → Actions → Variables:
- `VITE_META_APP_ID` = ID público do app ContabFlow na Meta;
- `VITE_META_CONFIG_ID` = ID público da configuração Embedded Signup.

O workflow de Pages injeta essas variáveis no build. Após configurá-las, republique o GitHub Pages; sem elas, o botão aparece desabilitado, com aviso claro.

**NÃO crie variáveis VITE_ para META_APP_SECRET, tokens Meta ou SERVICE_ROLE_KEY.**

## 4. Supabase: instalar SQL e publicar as funções
Supabase → SQL Editor → New Query, cole integralmente:
`supabase/migrations/202610280004_whatsapp_per_office.sql`.
Resultado esperado: `conexoes_por_escritorio=true`, `token_criptografado=true`, `webhook_status=true`.
Migrações anteriores, incluindo a Etapa 9, precisam estar instaladas.

No Supabase → Edge Functions → Secrets, defina:
- `META_APP_ID`: ID do aplicativo (não segredo).
- `META_APP_SECRET`: segredo do app na Meta (somente servidor).
- `META_WEBHOOK_VERIFY_TOKEN`: segredo longo e aleatório que você cria (somente servidor).
- `WHATSAPP_CREDENTIAL_KEY`: chave aleatória e forte, **32+ caracteres**; usada para criptografar cada token Meta no banco. Guarde backup protegido. Se perder essa chave, os tokens armazenados não poderão ser recuperados, exigindo reconexão.
- `WHATSAPP_GRAPH_VERSION`: `v26.0` ou outra versão suportada confirmada na Meta;
- `WHATSAPP_TEMPLATE_NAME`: `cobranca_honorarios_pdf` (o mesmo template deve estar aprovado em **cada WABA**).
- `WHATSAPP_TEMPLATE_LANG`: `pt_BR`.
- `CRON_SECRET` e `DISPATCH_LIVE_ENABLED=false` para agendador seguro.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: confirmar disponibilidade (variáveis reservadas que o Supabase pode fornecer automaticamente).

Para publicar com CLI:
```bash
supabase functions deploy whatsapp-connect --project-ref xglpxccavpxmowczvtnf --no-verify-jwt
supabase functions deploy whatsapp-webhook --project-ref xglpxccavpxmowczvtnf --no-verify-jwt
supabase functions deploy dispatch-reminders --project-ref xglpxccavpxmowczvtnf --no-verify-jwt
```
Também estão incluídas no workflow manual `.github/workflows/deploy-supabase.yml`, que requer secrets `SUPABASE_ACCESS_TOKEN` e `SUPABASE_PROJECT_ID` no GitHub Actions environment `supabase-pilot`.

Todas as funções exigem autenticação na aplicação ou validam o segredo correto (Meta HMAC ou `CRON_SECRET`); o endpoint de conexão verifica a sessão Supabase e se a pessoa é owner do escritório.

## 5. Meta: URL do webhook
No caso de uso WhatsApp, configuração de Webhooks:
- Callback URL: `https://xglpxccavpxmowczvtnf.supabase.co/functions/v1/whatsapp-webhook`
- Verificar token: o mesmo `META_WEBHOOK_VERIFY_TOKEN` das Secrets do Supabase.
- Inscreva-se em `messages` para status. O backend também tentará `POST /{waba_id}/subscribed_apps` a cada conexão.

## 6. Fluxo do contador
1. Login → Configurações → **Integração WhatsApp** → **Conectar meu WhatsApp Business**.
2. O cliente escolhe/cria conta Meta, verifica número, autoriza permissões. O backend troca o código por token e valida vínculo do número.
3. Configurações: **Ativar lembretes por WhatsApp** (habilitado apenas quando o número estiver conectado e assinatura ativa). Salva.
4. No menu Clientes, registra o telefone e a autorização real do cliente (ter contato salvo NÃO é autorização).
5. Em Cobranças, define valor, vencimento e dias. O cron verifica automaticamente; **não requer apertar enviar**.
6. O PDF usa dados do contador. O envio iniciado pela empresa exige template de utilidade aprovado e habilitado na WABA daquele escritório. Cada novo escritório pode precisar aprovar o modelo `cobranca_honorarios_pdf` com cabeçalho DOCUMENT e quatro parâmetros no corpo.
7. Status `sent` indica aceitação pela Meta, mas os webhooks atualizam `delivered`, `read` ou `failed`. O erro 130497 continua sendo bloqueio da Meta para o país de destino e NÃO é corrigido por essa infraestrutura.

## 7. Cron e proteção
Instale `supabase/migrations/202610280003_whatsapp_auto_cron.sql` APENAS depois de configurar `pg_cron`, `pg_net` e dois segredos no Supabase Vault. A rotina executa a cada dez minutos; apenas envia entre 09:00-09:59 no fuso do contador e nas datas escolhidas. A função usa deduplicação por (obrigação, data, deslocamento, canal).
Ative `DISPATCH_LIVE_ENABLED=true` apenas após validar a conexão, o template aprovado, autorização do destinatário e o modo de simulação `dry_run:true`.

## Avisos antes de comercializar
- Cada contador precisa de acesso legítimo à sua conta WhatsApp e autorização dos destinatários; devem existir mecanismos de cancelamento/opt-out.
- A Meta pode cobrar por mensagens de utilidade; custos e limites são por número/WABA.
- O programa Tech Provider pode exigir documentação, revisão e verificação que não podem ser substituídas por código.
- Esta integração é base técnica; **não houve teste real com token de negócio aprovado nem envio validado em produção**. A ativação exige configuração e teste.
