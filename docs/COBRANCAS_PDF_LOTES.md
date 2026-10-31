# ContabFlow — PDF único e despacho em lotes

## Regra para documentos
- Cada cobrança `obligations.id` corresponde a um arquivo imutável em bucket privado `billing-documents`, no caminho `org_id/obligation_id.pdf`.
- `generate-charge` e `dispatch-reminders` usam a mesma função `ensureChargeDocument`. A primeira execução cria o documento, as seguintes baixam **o mesmo arquivo**, mesmo para canais diferentes ou vários dias de lembrete.
- O upload nunca usa `upsert:true`; se duas execuções gerarem a mesma cobrança ao mesmo tempo, uma delas reutiliza o arquivo da outra. A tabela `billing_documents` mantém o registro.
- Não se altera um PDF já emitido silenciosamente. Se o arquivo ainda **não possui nenhuma tentativa de envio**, a interface permite **Excluir PDF** explicitamente, usando a operação autenticada `generate-charge {action:"delete"}`. A função verifica RLS da cobrança, status pendente e ausência de `reminder_logs`, remove o arquivo do Storage pela API oficial e elimina seu registro em `billing_documents`; depois o contador edita a data/valor e gera um novo PDF ao clicar em **PDF**.
- Se já houver histórico de disparo (`processing`, `failed`, `sent`, `delivered` ou `read`), não é possível excluir o aviso: crie uma cobrança corrigida e cancele a antiga. Isso também vale para situações incertas após uma tentativa de envio.
- A migration `202610310001_guard_issued_charge_changes.sql` impede no banco a alteração silenciosa de cliente, descrição, valor e vencimento enquanto houver um PDF ou histórico. Mudanças no contato do escritório e dados mestres não reescrevem PDFs antigos.
- A primeira emissão evita download desnecessário de um arquivo inexistente. Reabrir o PDF baixa o mesmo objeto privado, sem gerar outra cópia; não usa `upsert:true` no Storage.
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

## Exclusão definitiva solicitada pelo responsável do escritório
- **Excluir PDF** (correção de cobrança): permanece restrito a documentos de cobranças pendentes, sem histórico de disparo. A cobrança continua cadastrada.
- **Excluir cobrança**: operação diferente e irreversível, disponível na lista de Cobranças mesmo quando a cobrança está marcada como paga. Remove a cobrança, seu PDF privado (Storage API), histórico de notificações e eventos internos vinculados; o cliente continua na carteira.
- **Excluir cliente**: com confirmação explícita, remove o cliente e todas as cobranças vinculadas (incluindo PDFs privados, status de pagamento e histórico de lembretes) do escritório.
- Operações usam `delete-office-record` com JWT e verificação por RLS; somente `service_role` consegue executar a transação `purge_office_record`, que revalida vínculo do usuário ao escritório. Não há concessão de DELETE de documentos ao público.
- A remoção dos arquivos usa a Storage API **antes** da transação relacional, que elimina cliente/cobranças com FKs e apaga eventos internos vinculados. Se o Storage falhar, os registros do banco são preservados; se o banco falhar, o usuário pode repetir a exclusão após avaliar a mensagem, pois não se considera concluída antes da transação.
- Ações nunca são executadas ao abrir uma tela. Usam confirmação do usuário, sem agendamentos adicionais ou leituras automáticas de PDFs. Os KPIs do CRM recalculam dos dados em memória, sem consultas extras.
- Apagar registros dentro do ContabFlow não apaga mensagens já entregues por WhatsApp/e-mail, downloads feitos por destinatários nem backups ou informações que devam ser legalmente retidas fora das tabelas operacionais.

## Logo personalizada por escritório (economia de Storage)
- `organizations.logo_path` e `logo_updated_at` são metadados leves, já lidos com o escritório; não guardam imagens na tabela.
- O bucket `office-logos` é privado. O proprietário do escritório pode gravar, substituir e remover `org_id/logo.png`; os membros podem somente visualizar a imagem. Não existe URL pública da logo.
- O navegador converte PNG/JPG/WebP em um único PNG de até **80 KiB** e largura/altura máxima **500 px** antes do upload. Não são usadas transformações pagas do Supabase nem Edge Functions adicionais para isso.
- No painel, o PNG é baixado somente quando o escritório/versão muda; a URL local temporária é liberada na troca de sessão.
- `ensureChargeDocument` consulta a logo **somente se o PDF ainda não existe**. A imagem é incorporada ao PDF na primeira emissão, preservando os documentos já existentes. Uma troca de logo não reescreve cobranças antigas.
- A mesma lógica está no código de `generate-charge` e `dispatch-reminders`. A implantação do worker de lembretes permanece condicionada ao processo separado de ativação segura dos envios, não é ligada automaticamente.
