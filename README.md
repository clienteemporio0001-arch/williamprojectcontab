# ContabFlow — automação para escritórios contábeis

MVP SaaS para clientes, obrigações contábeis, vencimentos e lembretes personalizados pelo WhatsApp.

## Implementado

- Dashboard: clientes, vencimentos dos próximos 7 dias, atrasados, valores e marcação manual de pagamento.
- Cadastro de clientes com WhatsApp e registro da fonte da autorização para contato.
- Obrigações com documento, valor, vencimento, link HTTPS opcional e recorrência mensal.
- Mensagem de WhatsApp **manual** com variáveis do cliente e da obrigação.
- Modo demonstração: dados fictícios salvos somente neste navegador (localStorage).
- Supabase Auth + Postgres + RLS para separar os registros dos escritórios.
- Edge Function para avisos a 7, 3 e 1 dias antes, no vencimento e 1 dia depois (configuração adicional obrigatória).
- Geração de nova competência mensal pela Edge Function; nunca reaproveita link do documento anterior.

## Executar localmente

~~~bash
npm install
npm run dev
~~~

Sem arquivo de variáveis de ambiente, a aplicação fica em **demonstração local**. Não use dados verdadeiros nesse modo.

### Banco real: Supabase

1. Crie um projeto Supabase e execute no SQL Editor a migração disponível em supabase/migrations/202610210001_init.sql.
2. Habilite Supabase Auth por e-mail e configure as URLs de redirecionamento de seu domínio.
3. Copie .env.example para .env.local e configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (chave pública).
4. Execute npm run dev; autentique-se e crie o primeiro escritório.
5. Não coloque SUPABASE_SERVICE_ROLE_KEY no frontend ou no GitHub.

### WhatsApp automático: configuração necessária

**Requisitos:** conta WhatsApp Business Platform da Meta; permissão explícita dos clientes, com opção de revogação; um modelo de utilidade aprovado pela Meta; credenciais e agendamento em um servidor.

Template recomendado: nome lembrete_contabil, idioma pt_BR, corpo com **4 variáveis** nesta ordem: nome, documento, vencimento, valor.

Exemplo para solicitar aprovação: "Olá {{1}}, informamos que o documento {{2}} tem vencimento em {{3}}, no valor de {{4}}. Caso já tenha pago, desconsidere este aviso. Em caso de dúvidas, responda a esta mensagem."

Publique a função:

~~~bash
supabase functions deploy dispatch-reminders --no-verify-jwt
~~~

Configure no painel Supabase os seguintes segredos da Edge Function:
- SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (gerenciados pelo projeto);
- CRON_SECRET (segredo aleatório forte);
- WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID;
- WHATSAPP_TEMPLATE_NAME=lembrete_contabil, WHATSAPP_TEMPLATE_LANG=pt_BR;
- WHATSAPP_GRAPH_VERSION (opcional; informe uma versão suportada pela Meta).

Habilite pg_cron e pg_net nas extensões do Supabase. No Supabase SQL Editor, adicione os segredos ao Vault (substitua os exemplos):

~~~sql
select vault.create_secret('https://SEU-PROJETO.supabase.co', 'contabflow_project_url');
select vault.create_secret('SEU-SEGREDO-FORTE', 'contabflow_cron_secret');
~~~

Programe a Edge Function uma vez por hora. Internamente, ela envia os avisos somente às 9h locais de cada escritório:

~~~sql
select cron.schedule(
  'contabflow-lembretes',
  '0 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'contabflow_project_url') || '/functions/v1/dispatch-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'contabflow_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
~~~

Envios pela API oficial só ocorrem **após** esse procedimento, com telefone autorizado e template aprovado. O retorno "Aceito pela API" não prova entrega nem pagamento. A Meta pode cobrar por mensagens de template.

## Testar a demonstração Web

O workflow de GitHub Actions publica o frontend estático em GitHub Pages após push na main. Antes disso, habilite **Settings > Pages > Source: GitHub Actions** no repositório.

URL esperada após deploy bem-sucedido: https://clienteemporio0001-arch.github.io/williamprojectcontab/

GitHub Pages não hospeda o backend; dados de produção exigem Supabase e configuração segura.

## Limites desta primeira versão

- O banco já suporta múltiplos escritórios, mas a integração piloto da Meta usa **um remetente compartilhado**. Implementar números/credenciais por escritório antes de vender como SaaS.
- O sistema não gera automaticamente guias fiscais nem altera PDFs de cobrança reais. Cada guia pode ter código, valor e dados próprios. Não reutilize documentos anteriores.
- Use armazenamento privado e links assinados para PDFs; evite links fiscais públicos.
- É necessário implementar assinaturas, webhook de entrega, fila com novas tentativas, configuração personalizada de régua e controles LGPD antes da produção ampla.
- A função piloto processa até 200 escritórios e 1.000 obrigações por escritório por rodada; escalabilidade requer paginação e fila.
- "Pago" é um status confirmado manualmente pelo contador; não significa integração com banco.

## Referências

- Política de mensagens: https://business.whatsapp.com/policy/preview?lang=pt_BR
- Agendamentos Supabase: https://supabase.com/docs/guides/functions/schedule-functions
