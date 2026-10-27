# ContabFlow — Etapa 6: Teste de 3 clientes e monitoramento administrativo

## Mudanças no produto

- Todo usuário **não-Master** recém-registrado aparece em **Admin Master → Cadastros e atividades** (incluindo e-mails sem confirmação e cadastros ainda sem escritório).
- Ao criar o escritório, o teste padrão é de 7 dias e a conta aparece em **Admin Master → Período de teste**.
- O Master visualiza avaliações em andamento, vencidas, cadastros sem escritório, último login e eventos operacionais.
- Eventos armazenados: cadastrar/editar/excluir cliente; criar/editar/excluir cobrança; marcar pagamento/reabrir; gerar PDF (*após atualizar a Edge Function no Supabase*).
- O painel do contador tem banner explícito: "Sua conta está no período de teste gratuito", dias restantes e limites.
- Limites padrão: **3 clientes cadastrados no total** e **3 cobranças**. O número de clientes pode ser ajustado pelo Master em Teste grátis. O limite de cobranças da avaliação é fixo em 3 nesta etapa.
- Em teste não são permitidos envios automáticos pela API oficial WhatsApp; apenas abertura manual de uma conversa, com autorização do destinatário.
- Ao encerrar o teste, o servidor impede o acesso operacional, preservando os dados do escritório.
- Bloco de orientação no dashboard: cadastre clientes, crie documentos e veja recursos futuros. Tutoriais e parcerias são apenas ideias futuras, não cursos ou recursos já disponíveis.
- Nenhum sistema de pagamento/assinatura foi ativado automaticamente.

## Como ativar

**As migrações SQL do GitHub não são aplicadas automaticamente ao Supabase.**

1. Abra Supabase → SQL Editor.
2. Se a **Etapa 5** ainda não tiver sido executada, rode:
   `supabase/migrations/202610270005_trial_and_subscriptions.sql`
3. Em seguida, rode **uma vez**:
   `supabase/migrations/202610270006_trial_monitoring.sql`
4. Recarregue o ContabFlow com Ctrl+Shift+R.
5. Crie uma conta de teste comum com e-mail externo, confirme o e-mail e crie o escritório.
6. Verifique se o novo usuário está em "Cadastros e atividades"; o escritório em "Período de teste"; e que o 4º cliente e a 4ª cobrança são bloqueados.
7. Para ver eventos de geração de PDF, publicar a versão atual da Edge Function `generate-charge` no Supabase. Para os disparos automáticos oficiais, publique também a `dispatch-reminders` atualizada **antes de ativar os agendamentos de produção**.

## Segurança e escopo

- A permissão de leitura de `master_monitor` é verificada dentro da função, usando `is_master_admin()`, não por estado do navegador.
- O log de atividades contém apenas tipo de evento, IDs técnicos e horário. Não registra senhas, conteúdo de mensagens ou dados financeiros.
- O histórico começa **após** aplicar a migração 006; não é retroativo.
- O monitor mostra até 200 cadastros recentes e 150 eventos recentes, atualizando a cada minuto.
- O limite de 3 clientes e 3 cobranças é aplicado por gatilhos SQL. O gatilho `trial_reminder_guard` também bloqueia a reserva de lembretes automáticos em testes.
- Configurações de duração do teste alteram apenas novos escritórios; limitações de clientes alteram avaliações em andamento.
