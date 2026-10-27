# ContabFlow — Etapa 5: Teste grátis configurável e WhatsApp flutuante

## Implementado no repositório

- Página pública com benefícios, valores atuais dos planos e chamada para cadastro.
- Botão flutuante **Fale conosco** para `https://wa.me/5568992097927` no site e no painel do escritório.
- Admin Master > **Teste grátis**: habilitar/desabilitar, duração (1 a 90 dias), limite de clientes ativos (1 a 300), título e descrição.
- Novos escritórios entram em teste por padrão por **7 dias** e até **10 clientes ativos** (configurável); o prazo começa após criar o escritório, não na criação do usuário Supabase.
- Quando o teste expira, acesso a clientes, cobranças e documentos é barrado **por RLS e funções do banco**, independentemente do navegador.
- Admin Master > Escritórios > Gerenciar: prorrogar a avaliação, liberar assinatura manualmente ou retornar a acesso pendente.
- Histórico de alteração da configuração e das liberações.
- Escritórios criados antes da migração continuam com `billing_status='active'`; não retrocedemos acessos já existentes.

## O que é necessário fazer no Supabase

1. Abra `Supabase > ContabFlow > SQL Editor > New Query`.
2. No GitHub, copie **integralmente** este arquivo:
   `supabase/migrations/202610270005_trial_and_subscriptions.sql`.
3. Execute **uma única vez** no SQL Editor. O resultado esperado é `Success. No rows returned`.
4. Recarregue o site, entre no Admin Master e abra `Teste grátis` para alterar as configurações.
5. Para verificar o teste, cadastre **uma nova conta comum**, confirme e-mail e crie o escritório. Na área Master ela deverá aparecer com o prazo.

### Importante

- Esta etapa **não implementa checkout/assinatura automática** nem valida pagamentos.
- `Liberar assinatura` é uma operação manual; use apenas após confirmar a contratação externamente.
- O teste **não dispara mensagens** automaticamente: o WhatsApp oficial exige API Meta, templates aprovados, opt-in e agendamento.
- O código atualizado de `dispatch-reminders` impede envios por escritórios vencidos, suspensos ou pendentes. **Publicá-lo no GitHub Pages não faz deploy da Edge Function**: para usar envios reais, publique a função atualizada no Supabase antes de ligar o agendamento.
- O botão flutuante abre uma conversa humana via WhatsApp com o suporte; não envia mensagens automáticas.
- A duração alterada passa a valer para **novos** escritórios; o limite de clientes configurado afeta testes já em andamento.
- Os preços exibidos na página pública são lidos de `public.subscription_plans` no Supabase (requer migração 005 com política de leitura pública).
