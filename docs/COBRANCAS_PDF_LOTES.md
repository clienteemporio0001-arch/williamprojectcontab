# ContabFlow — PDF único e despacho em lotes

## Regra para documentos
- Cada cobrança `obligations.id` corresponde a um arquivo imutável em bucket privado `billing-documents`, no caminho `org_id/obligation_id.pdf`.
- `generate-charge` e `dispatch-reminders` usam a mesma função `ensureChargeDocument`. A primeira execução cria o documento, as seguintes baixam **o mesmo arquivo**, mesmo para canais diferentes ou vários dias de lembrete.
- O upload nunca usa `upsert:true`; se duas execuções gerarem a mesma cobrança ao mesmo tempo, uma delas reutiliza o arquivo da outra. A tabela `billing_documents` mantém o registro.
- Não se altera um PDF já emitido silenciosamente. Se valor, vencimento ou dados do favorecido mudarem, crie uma cobrança corrigida e cancele a anterior; não reaproveite o aviso com dados desatualizados.
- Armazenamento privado, sem URL pública do documento.

## Lotes e deduplicação
- Máximo de **12 tentativas de envio por execução**, máximo de **6 por escritório**.
- Janela de execução normal: **09:00 a 11:59 no horário local do escritório**.
- Só considera escritórios com assinatura `active`, acesso `active` e canal habilitado; exige consentimento do cliente.
- Chave única já existente: `(obligation_id,due_date,offset_days,channel)`. A criação do log antes da chamada ao provedor previne envios simultâneos duplicados. Uma falha ou timeout após a requisição ao provedor **não** dispara repetição automática; confirme o status no log/provedor.
- Falha de preparação de PDF acontece ANTES do log e do contato com Meta/Resend. A próxima execução pode tentar novamente com segurança.
- Eventos de entrega/leitura continuam vindos do webhook.

## Ativação controlada
1. Deploy das Edge Functions `generate-charge` e `dispatch-reminders` (incluindo `_shared/charge_document.ts`).
2. Confira a presença das tabelas `billing_documents`, `reminder_logs` e do bucket privado `billing-documents`. O bucket e suas políticas já fazem parte da Etapa 2.
3. Execute testes: `deno check` e `deno test supabase/functions/_shared/*_test.ts`; CI também valida.
4. Execute `dispatch-reminders` com `dry_run:true`, usando `x-cron-secret`. Não gera PDFs, não grava logs e não envia mensagens.
5. Só após validar WhatsApp Business, modelo aprovado, consentimentos e credenciais, configure `DISPATCH_LIVE_ENABLED=true`.
6. Caso o cron de 10 minutos já esteja instalado e seja necessário escoar mais lembretes, execute o SQL **opcional** `supabase/CONTABFLOW_AJUSTE_LOTES_CRON.sql` para alterar o cron existente para cada minuto. O SQL não cria novos agendamentos quando nenhum está instalado.

## Observabilidade e cautelas
- Em `reminder_logs`, `processing` antigo pode indicar que o provedor aceitou mas a resposta não foi consolidada. **Nunca reenvie cegamente** esses registros. Confira o `provider_message_id`/webhook.
- `failed` guarda o erro de uma tentativa no provedor; requer análise antes de novo disparo. O sistema prefere evitar uma duplicidade a repetir uma cobrança em estado incerto.
- A rotina respeita um teto por execução; para grandes volumes com muitos escritórios simultâneos será necessário evoluir para uma fila persistente, paginação de escritórios, métricas de backlog e limites de taxa por provedor.
- O bloqueio `DISPATCH_LIVE_ENABLED` continua obrigatório, independente do agendamento.
