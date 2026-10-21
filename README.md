# ContabFlow — SaaS de cobrança recorrente de honorários

O primeiro produto gera cobranças de honorários contábeis em PDFs personalizados (cliente, CPF/CNPJ, serviço, valor, vencimento e chave Pix) e programa seu envio pelo WhatsApp. Cada cliente possui seus próprios valores, prazos e dias de lembrete.

**IMPORTANTE:** o documento enviado pelo cliente no início do projeto era um RECIBO que confirmava pagamento. O ContabFlow agora gera AVISOS DE COBRANÇA ANTES DO PAGAMENTO, nunca recibos ou comprovantes de quitação. Pagamentos são confirmados manualmente neste MVP.

## O que está implementado no código

- Dashboard, clientes, cobranças pendentes/pagas e recorrência mensal.
- Consentimento para WhatsApp com registro da origem.
- Dados do escritório: nome, CPF/CNPJ, Pix e contato de suporte.
- Escolha dos dias de aviso para cada cobrança: 30, 15, 7, 5, 3, 1 dias antes, no dia, 1, 3 ou 7 dias depois.
- Download do PDF de cobrança individual na interface (inclusive em modo de demonstração fictícia).
- Geração do PDF pelo servidor em Storage privado em Supabase.
- Rotina agendada que cria a próxima competência e envia o PDF como DOCUMENT no cabeçalho do template oficial WhatsApp, após configuração da integração.
- Banco multi-escritório com RLS e histórico de tentativas de envio.

## Testar a demonstração web

https://clienteemporio0001-arch.github.io/williamprojectcontab/

O site só contém uma interface demo com dados fictícios locais. Sem Supabase e integração Meta, **nenhuma mensagem é enviada automaticamente** e dados da demo não são mantidos na nuvem. Evite cadastrar dados reais na demo.

## Rodar localmente

~~~bash
npm install
npm run dev
~~~

## Configurar produção (não realizado ainda)

1. Crie um projeto Supabase e execute no SQL Editor, nesta ordem:
   - supabase/migrations/202610210001_init.sql
   - supabase/migrations/202610210002_billing.sql
2. Configure login por e-mail e VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY em arquivo .env.local.
3. Publique as Edge Functions:

~~~bash
supabase functions deploy generate-charge
supabase functions deploy dispatch-reminders --no-verify-jwt
~~~

4. Configure secrets no Supabase, nunca no frontend: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME=cobranca_honorarios_pdf, WHATSAPP_TEMPLATE_LANG=pt_BR e WHATSAPP_GRAPH_VERSION (versão suportada).
5. Aprove na Meta um template de utilidade com HEADER do tipo DOCUMENT/PDF e exatamente 4 campos BODY, nesta ordem: nome, descrição dos honorários, vencimento e valor. Exemplo para aprovação:
   
   "Olá {{1}}, segue em anexo o aviso de cobrança de {{2}}, com vencimento em {{3}}, no valor de {{4}}. Caso já tenha pago, desconsidere este aviso. Para dúvidas, responda esta mensagem."
   
   O template anterior de texto simples NÃO serve para este novo código, que envia cabeçalho com documento.
6. Habilite pg_cron e pg_net no Supabase, crie um cron que invoque dispatch-reminders a cada hora, passando o segredo CRON_SECRET no cabeçalho x-cron-secret. A função só envia entre 9h e 10h locais do escritório.
7. Teste com dados sintéticos e números autorizados antes de atender clientes. Observe regras de opt-in, LGPD e custos Meta.

## Limites e itens ainda não feitos

- A integração piloto tem **um único remetente global** configurado no servidor. Para escalar em um SaaS comercial, será preciso configurar números de WhatsApp por escritório com armazenamento seguro de credenciais.
- O status "enviado" representa aceitação da API da Meta, não confirmação de entrega, leitura ou quitação.
- A API oficial da Meta não está conectada em produção, nem o agendamento Supabase implantado. Os arquivos no GitHub são código-fonte, não um serviço ativado.
- Falhas são registradas e precisam de fila/reprocessamento controlado; ainda faltam webhook de entrega, cancelamento por descadastro e cobrança de assinatura.
- Marcar como pago é manual; o sistema não lê extratos bancários ou confirma Pix.
- Os PDFs de cada competência são gerados novamente, sem reutilizar documento de outro mês.
- A função tem limite de 200 escritórios e 1000 cobranças por execução neste protótipo. Implementar paginação e escalabilidade antes da venda em massa.

## Documentação
https://supabase.com/docs/guides/functions
https://supabase.com/docs/guides/storage/serving/downloads
https://business.whatsapp.com/policy
