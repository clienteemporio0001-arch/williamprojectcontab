import { useCallback,useEffect,useMemo,useState } from 'react';
import { Building2,Users,Wallet,ShieldCheck,LogOut,RefreshCw,Search,Settings2,LockKeyhole,CheckCircle2,FileText,Pencil,Clock3,Activity,MailCheck } from 'lucide-react';
import { supabase } from './lib/supabase';
import {parsePlanPrice,formatPlanPriceInput} from './lib/plan-prices';
import {DEFAULT_TRIAL,type TrialSettings,remainingTrialDays} from './lib/trial';
import './master.css';

type Plan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Office={id:string;name:string;created_at:string;owner_email:string|null;plan_code:string;plan_name:string;access_status:'active'|'suspended';client_limit:number;monthly_price_brl:number;clients_active:number;charges_total:number;notifications_accepted:number;billing_status?:'active'|'trialing'|'pending';trial_started_at?:string|null;trial_ends_at?:string|null};
type Data={organizations:Office[];plans:Plan[]};
type Props={canOpenOffice:boolean;onOpenOffice:()=>void};
type Signup={user_id:string;email:string|null;full_name:string|null;declared_office_name:string|null;registered_at:string;verified:boolean;last_sign_in_at:string|null;org_id:string|null;office_name:string|null;billing_status:'active'|'trialing'|'pending'|null;access_status:string|null;trial_ends_at:string|null};
type MonitorEvent={id:number;org_id:string;actor_user_id:string|null;event_type:string;entity_id:string|null;occurred_at:string;office_name:string};
type MonitorData={registrations:Signup[];activities:MonitorEvent[]};
const EVENT_LABELS:Record<string,string>={
 client_created:'Cliente cadastrado',client_updated:'Cliente atualizado',client_deleted:'Cliente excluído',
 charge_created:'Cobrança criada',charge_updated:'Cobrança atualizada',charge_deleted:'Cobrança excluída',
 charge_paid:'Pagamento registrado',charge_reopened:'Cobrança reaberta',pdf_generated:'PDF gerado'
};
const timestamp=(value:string)=>new Date(value).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const trialLabel=(o:{billing_status?:string|null;trial_ends_at?:string|null;access_status?:string|null})=>
 o.access_status==='suspended'?'Suspenso':
 o.billing_status==='trialing'
  ?remainingTrialDays(o.trial_ends_at||null)>0?'Em teste':'Teste expirado'
  :o.billing_status==='pending'?'Aguardando ativação'
  :o.billing_status==='active'?'Assinatura liberada':'Sem escritório';
const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
export default function MasterAdmin({canOpenOffice,onOpenOffice}:Props){
 const [tab,setTab]=useState<'home'|'offices'|'plans'|'monitor'>('home');
 const [data,setData]=useState<Data>({organizations:[],plans:[]});
 const [term,setTerm]=useState('');const [edit,setEdit]=useState<Office|null>(null);
 const [plan,setPlan]=useState('');const [access,setAccess]=useState<'active'|'suspended'>('active');
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [editPrice,setEditPrice]=useState<Plan|null>(null);
 const [priceInput,setPriceInput]=useState('');
 const [priceError,setPriceError]=useState('');
 const [trial,setTrial]=useState<TrialSettings>(DEFAULT_TRIAL);
 const [trialAvailable,setTrialAvailable]=useState(false);
 const [trialBusy,setTrialBusy]=useState(false);
 const [trialError,setTrialError]=useState('');
 const [extendDays,setExtendDays]=useState(7);
 const [monitor,setMonitor]=useState<MonitorData>({registrations:[],activities:[]});
 const [monitorError,setMonitorError]=useState('');
 const [monitorOffice,setMonitorOffice]=useState<string>('all');
 const [monitorLoading,setMonitorLoading]=useState(false);
 const reload=useCallback(async()=>{if(!supabase)return;setBusy(true);setError('');
  const {data:result,error:e}=await supabase.rpc('master_dashboard');
  if(e)setError('Não foi possível consultar o Admin Master: '+e.message);
  else{const payload=result as Data|null;setData({organizations:payload?.organizations||[],plans:payload?.plans||[]});}
  setBusy(false);
 },[]);
 useEffect(()=>{void reload();},[reload]);
 const loadMonitor=useCallback(async()=>{
   if(!supabase)return;
   setMonitorLoading(true);
   const {data:result,error:e}=await supabase.rpc('master_monitor',{p_org_id:null,p_limit:150});
   if(e)setMonitorError('Execute a Etapa 6 no Supabase para visualizar todos os cadastros e atividades: '+e.message);
   else{setMonitor(result as MonitorData);setMonitorError('');}
   setMonitorLoading(false);
 },[]);
 useEffect(()=>{void loadMonitor();},[loadMonitor]);
 useEffect(()=>{
   const timer=window.setInterval(()=>{void loadMonitor();},60000);
   return()=>window.clearInterval(timer);
 },[loadMonitor]);
 const refreshTrial=useCallback(async()=>{
   if(!supabase)return;
   const {data:d,error:e}=await supabase.from('saas_trial_settings')
     .select('trial_enabled,trial_days,trial_max_clients,trial_title,trial_description').eq('id',1).single();
   if(e){setTrialAvailable(false);setTrialError('Instale a Etapa 5 do SQL no Supabase antes de editar o teste.');}
   else{setTrialAvailable(true);setTrial(d as TrialSettings);setTrialError('');}
 },[]);
 useEffect(()=>{void refreshTrial();},[refreshTrial]);
 async function saveTrial(){
   if(!supabase||!trialAvailable)return;
   if(!Number.isInteger(trial.trial_days)||trial.trial_days<1||trial.trial_days>90||
      !Number.isInteger(trial.trial_max_clients)||trial.trial_max_clients<1||trial.trial_max_clients>300||
      trial.trial_title.trim().length<5||trial.trial_description.trim().length<10){
     setTrialError('Confira a duração (1 a 90 dias), o limite (1 a 300 clientes) e os textos.');return;
   }
   setTrialBusy(true);setTrialError('');
   const {error:e}=await supabase.rpc('master_update_trial_settings',{
     p_enabled:trial.trial_enabled,p_days:trial.trial_days,p_max_clients:trial.trial_max_clients,
     p_title:trial.trial_title,p_description:trial.trial_description
   });
   setTrialBusy(false);
   if(e){setTrialError('Falha ao salvar: '+e.message);return;}
   await refreshTrial();setNotice('Configurações do teste grátis salvas no Supabase.');
 }
 async function changeBilling(action:'activate'|'extend_trial'|'pending'){
   if(!supabase||!edit)return;
   if(action==='activate'&&!window.confirm('Liberar acesso deste escritório como assinatura ativa? Confirme o pagamento fora da plataforma.'))return;
   if(action==='pending'&&!window.confirm('Bloquear a assinatura deste escritório até regularização?'))return;
   if(action==='extend_trial'&&(!Number.isInteger(extendDays)||extendDays<1||extendDays>90)){
     setError('Informe de 1 a 90 dias para prorrogar.');return;
   }
   setBusy(true);setError('');
   const {error:e}=await supabase.rpc('master_manage_subscription',{
     p_org_id:edit.id,p_action:action,p_days:action==='extend_trial'?extendDays:null
   });
   if(e){setBusy(false);setError('Falha ao atualizar acesso: '+e.message);return;}
   setEdit(null);await reload();setNotice('Acesso do escritório atualizado com registro de auditoria.');
 }

 const offices=data.organizations;
 const active=offices.filter(o=>o.access_status==='active');
 const paying=active.filter(o=>!o.billing_status||o.billing_status==='active');
 const visible=useMemo(()=>offices.filter(o=>(o.name+' '+(o.owner_email||'')).toLowerCase().includes(term.toLowerCase())),[offices,term]);
 const trialOffices=offices.filter(o=>o.billing_status==='trialing');
 const runningTrials=trialOffices.filter(o=>remainingTrialDays(o.trial_ends_at||null)>0);
 const expiredTrials=trialOffices.filter(o=>remainingTrialDays(o.trial_ends_at||null)===0);
 const pendingSignups=monitor.registrations.filter(r=>!r.org_id);
 const filteredActivities=monitor.activities.filter(a=>monitorOffice==='all'||a.org_id===monitorOffice);
 const filteredRegistrations=monitor.registrations.filter(r=>monitorOffice==='all'||r.org_id===monitorOffice);
 function begin(o:Office){setEdit(o);setPlan(o.plan_code);setAccess(o.access_status);setExtendDays(7);setError('');setNotice('');}
 function beginPrice(p:Plan){
  setEditPrice(p);setPriceInput(formatPlanPriceInput(Number(p.monthly_price_brl)));
  setPriceError('');setError('');setNotice('');
 }
 async function savePrice(){
  if(!supabase||!editPrice)return;
  const newPrice=parsePlanPrice(priceInput);
  if(newPrice===null){setPriceError('Digite um valor de R$ 0,00 a R$ 99.999,99, com até dois centavos. Ex.: 79,90');return;}
  const priorPrice=Number(editPrice.monthly_price_brl);
  if(newPrice===priorPrice){setEditPrice(null);return;}
  const accepted=window.confirm(
    'Atualizar o plano '+editPrice.name+' de '+brl(priorPrice)+' para '+brl(newPrice)+' por mês?\\n\\n'+
    'O novo preço será exibido no Admin Master e nas estimativas. Não altera pagamentos de assinaturas externas.'
  );
  if(!accepted)return;
  setBusy(true);setPriceError('');
  const {error:e}=await supabase.rpc('master_update_plan_price',{
    p_plan_code:editPrice.code,
    p_new_price:newPrice,
    p_expected_price:priorPrice
  });
  if(e){
    setBusy(false);
    setPriceError(/function|schema cache|not found/i.test(e.message)
      ?'Instale a Etapa 4 (SQL de preços dos planos) no Supabase antes de salvar.'
      :'Não foi possível salvar o preço: '+e.message);
    return;
  }
  const planName=editPrice.name;
  setEditPrice(null);
  await reload();
  setNotice('Preço de '+planName+' atualizado para '+brl(newPrice)+'/mês e registrado na auditoria.');
 }
 async function save(){if(!supabase||!edit)return;
  if(access==='suspended'&&edit.access_status==='active'&&!window.confirm('Suspender este escritório? Seus clientes e disparos ficarão bloqueados, sem excluir dados.'))return;
  const target=data.plans.find(p=>p.code===plan);
  if(target&&edit.clients_active>target.client_limit&&!window.confirm('O número de clientes ativos já ultrapassa o limite do novo plano. Prosseguir sem excluir os clientes existentes?'))return;
  setBusy(true);const {error:e}=await supabase.rpc('master_update_organization',{p_org_id:edit.id,p_plan_code:plan,p_access_status:access});
  setBusy(false);if(e){setError(e.message);return;}setEdit(null);setNotice('Escritório atualizado e alteração auditada.');await reload();
 }
 return <div className="master-root"><aside className="master-side"><div className="master-logo"><ShieldCheck size={25}/><div><strong>contab<span>flow</span></strong><small>ADMIN MASTER</small></div></div>
  <div className="master-navlabel">GERENCIAMENTO</div>
  <button className={tab==='home'?'current':''} onClick={()=>setTab('home')}><Wallet size={18}/>Visão geral</button>
  <button className={tab==='offices'?'current':''} onClick={()=>setTab('offices')}><Building2 size={18}/>Escritórios <small>{offices.length}</small></button>
  <button className={tab==='plans'?'current':''} onClick={()=>setTab('plans')}><Settings2 size={18}/>Planos SaaS</button>
  <button className={tab==='monitor'?'current':''} onClick={()=>setTab('monitor')}><Activity size={18}/>Cadastros e atividades <small>{pendingSignups.length}</small></button>
  <div className="master-sidefoot"><div><LockKeyhole size={17}/> Área restrita ao administrador da plataforma</div>
   {canOpenOffice&&<button onClick={onOpenOffice}><Building2 size={17}/>Painel do contador</button>}
   <button onClick={()=>{if(supabase)void supabase.auth.signOut();}}><LogOut size={17}/>Sair</button>
  </div></aside>
  <main className="master-content"><header className="master-top"><span>ContabFlow / <strong>Admin Master</strong></span><button disabled={busy} onClick={()=>{void reload();void loadMonitor();}}><RefreshCw size={16}/>Atualizar</button></header>
   <div className="master-inner"><p className="master-eyebrow">PAINEL ADMINISTRATIVO</p>
    <h1>{tab==='home'?'Visão geral da plataforma':tab==='offices'?'Escritórios cadastrados':tab==='plans'?'Planos e teste grátis':'Cadastros e atividades'}</h1>
    <p className="master-sub">{tab==='home'?'Acompanhe sua carteira de escritórios e o uso da plataforma.':tab==='offices'?'Controle o acesso e o plano de cada contador.':tab==='plans'?'Edite os valores e personalize o teste gratuito dos planos.':'Acompanhe cadastros, confirmações de e-mail e ações feitas pelos escritórios.'}</p>
    {error&&<div className="master-alert">{error}</div>}{notice&&<div className="master-alert success">{notice}</div>}
    {busy&&<p className="master-loading">Atualizando informações…</p>}
    {tab==='home'&&<>
     <div className="master-trial-pulse">
       <button onClick={()=>setTab('plans')}><Clock3 size={17}/> Testes em andamento <strong>{runningTrials.length}</strong></button>
       <button onClick={()=>setTab('trial')}><LockKeyhole size={17}/> Testes vencidos <strong>{expiredTrials.length}</strong></button>
       <button onClick={()=>setTab('monitor')}><MailCheck size={17}/> Cadastros sem escritório <strong>{pendingSignups.length}</strong></button>
       <button onClick={()=>setTab('monitor')}><Activity size={17}/> Ações recentes <strong>{monitor.activities.length}</strong></button>
     </div>
     <div className="master-kpis">
      <article><span>Escritórios <Building2 size={18}/></span><strong>{offices.length}</strong><small>{active.length} ativos</small></article>
      <article><span>Clientes atendidos <Users size={18}/></span><strong>{offices.reduce((a,o)=>a+Number(o.clients_active),0)}</strong><small>Clientes ativos de todos os escritórios</small></article>
      <article><span>Suspensos <LockKeyhole size={18}/></span><strong>{offices.length-active.length}</strong><small>Acesso e disparos bloqueados</small></article>
      <article><span>Mensalidades potenciais <Wallet size={18}/></span><strong>{brl(paying.reduce((a,o)=>a+Number(o.monthly_price_brl),0))}</strong><small>Sem teste grátis · receita não confirmada</small></article>
     </div>
     <section className="master-panel"><div className="master-panelhead"><h2>Escritórios recentes</h2><button onClick={()=>setTab('offices')}>Ver todos →</button></div>
      {offices.slice(0,8).map(o=><div className="master-office" key={o.id}><span className="master-avatar">{o.name.slice(0,2).toUpperCase()}</span><div><strong>{o.name}</strong><small>{o.owner_email||'Responsável não cadastrado'}</small></div><span className={'master-tag '+o.access_status}>{o.access_status==='active'?'Ativo':'Suspenso'}</span></div>)}
      {!offices.length&&<div className="master-empty">Nenhum escritório cadastrado.</div>}
     </section>
    </>}
    {tab==='offices'&&<section className="master-panel">
     <div className="master-search"><Search size={18}/><input placeholder="Buscar escritório ou e-mail..." value={term} onChange={e=>setTerm(e.target.value)}/></div>
     <div className="master-tablewrap"><table><thead><tr><th>ESCRITÓRIO / RESPONSÁVEL</th><th>PLANO</th><th>CLIENTES</th><th>COBRANÇAS</th><th>STATUS</th><th></th></tr></thead><tbody>
     {visible.map(o=><tr key={o.id}><td><strong>{o.name}</strong><small>{o.owner_email||'Não informado'}</small></td><td>{o.plan_name}</td><td>{o.clients_active}/{o.client_limit}</td><td>{o.charges_total}</td><td><span className={'master-tag '+o.access_status}>{o.access_status==='active'?'Ativo':'Suspenso'}</span>
 <small>{o.billing_status==='trialing'?(remainingTrialDays(o.trial_ends_at||null)>0?'Teste: '+remainingTrialDays(o.trial_ends_at||null)+' dia(s)':'Teste encerrado')
 :o.billing_status==='pending'?'Aguardando liberação':'Assinatura liberada'}</small></td>
 <td><button onClick={()=>begin(o)}>Gerenciar</button></td></tr>)}
     {!visible.length&&<tr><td colSpan={6}>Nenhum escritório encontrado.</td></tr>}</tbody></table></div>
    </section>}
    {tab==='monitor'&&<div className="master-monitor">
      {monitorError&&<div className="master-alert">{monitorError}</div>}
      <div className="master-monitor-tools">
        <label>Filtrar por escritório
          <select value={monitorOffice} onChange={e=>setMonitorOffice(e.target.value)}>
            <option value="all">Todos os escritórios e cadastros</option>
            {offices.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <button onClick={()=>void loadMonitor()} disabled={monitorLoading}><RefreshCw size={16}/>Atualizar</button>
      </div>
      <section className="master-panel">
        <div className="master-panelhead"><h2>Cadastros na plataforma ({filteredRegistrations.length})</h2><span>Inclui quem ainda não confirmou o e-mail ou criou escritório</span></div>
        <div className="master-tablewrap"><table>
          <thead><tr><th>RESPONSÁVEL</th><th>ESCRITÓRIO</th><th>CADASTRADO EM</th><th>E-MAIL</th><th>SITUAÇÃO</th><th>ÚLTIMO LOGIN</th></tr></thead>
          <tbody>
            {filteredRegistrations.map(r=><tr key={r.user_id}>
              <td><strong>{r.full_name||'Nome não informado'}</strong><small>{r.email||'Sem e-mail'}</small></td>
              <td>{r.office_name||r.declared_office_name||'Ainda não criou'}</td>
              <td>{timestamp(r.registered_at)}</td>
              <td>{r.verified?'Confirmado':'Pendente'}</td>
              <td><span className={'master-trial-status '+(r.billing_status==='trialing'?'trial':'')}>
                {r.org_id?trialLabel(r):r.verified?'Cadastro sem escritório':'Aguardando confirmação'}
              </span></td>
              <td>{r.last_sign_in_at?timestamp(r.last_sign_in_at):'Ainda não entrou'}</td>
            </tr>)}
            {!filteredRegistrations.length&&<tr><td colSpan={6}>Nenhum cadastro encontrado.</td></tr>}
          </tbody>
        </table></div>
      </section>
      <section className="master-panel">
        <div className="master-panelhead"><h2>Atividades registradas ({filteredActivities.length})</h2><span>Clientes, cobranças, PDFs e pagamentos marcados no sistema</span></div>
        <div className="master-activity-list">
          {filteredActivities.map(ev=><div className="master-activity-item" key={ev.id}>
             <Activity size={16}/><div><strong>{EVENT_LABELS[ev.event_type]||ev.event_type}</strong>
             <small>{ev.office_name}</small></div><time>{timestamp(ev.occurred_at)}</time>
           </div>)}
          {!filteredActivities.length&&<div className="master-empty">Nenhuma atividade registrada. O histórico começa depois da execução da Etapa 6.</div>}
        </div>
        <p className="master-hint master-activity-note">Este painel mostra eventos operacionais, não o conteúdo de mensagens, senhas ou arquivos privados. Atualização automática a cada minuto; últimas 150 atividades.</p>
      </section>
    </div>}
    {tab==='plans'&&<div className="master-plan-grid">{data.plans.map(p=><article key={p.code}><Wallet size={22}/><h2>{p.name}</h2><strong>{brl(Number(p.monthly_price_brl))}<small>/mês</small></strong><p><CheckCircle2 size={16}/> Até {p.client_limit} clientes ativos</p><p><FileText size={16}/> Gestão de cobranças e PDFs</p><p>Os valores são propostas comerciais, sem cobrança de assinatura integrada.</p><button type="button" className="master-price-edit" disabled={busy} onClick={()=>beginPrice(p)}><Pencil size={16}/> Alterar valor</button></article>)}</div>}
    {tab==='plans'&&<section className="master-panel master-trial">
      <div className="master-panelhead"><h2>Oferta de teste grátis</h2><Clock3 size={19}/></div>
      <div className="master-trial-content">
        <p className="master-trial-intro">O prazo começa quando o escritório é criado. Após o vencimento, a plataforma bloqueia clientes e cobranças até você prorrogar o teste ou liberar a assinatura.</p>
        <div className="master-trial-stats">
          <div><strong>{runningTrials.length}</strong><span>Em teste</span></div>
          <div><strong>{expiredTrials.length}</strong><span>Vencidos</span></div>
          <div><strong>{monitor.registrations.filter(r=>!r.verified).length}</strong><span>E-mail pendente</span></div>
          <div><strong>{pendingSignups.length}</strong><span>Sem escritório</span></div>
        </div>
        {trialError&&<div className="master-alert" role="alert">{trialError}</div>}
        <label className="master-trial-switch"><input type="checkbox" disabled={!trialAvailable||trialBusy} checked={trial.trial_enabled}
          onChange={e=>setTrial(p=>({...p,trial_enabled:e.target.checked}))}/>
          <span><strong>Oferecer teste gratuito a novos escritórios</strong><small>Se desativado, novos escritórios aguardam sua liberação.</small></span>
        </label>
        <div className="master-trial-cols">
          <label>Duração do teste (dias)
            <div className="master-trial-presets">{[1,3,7].map(days=><button key={days} type="button"
              className={trial.trial_days===days?'chosen':''} disabled={!trialAvailable||trialBusy}
              onClick={()=>setTrial(p=>({...p,trial_days:days}))}>{days} {days===1?'dia':'dias'}</button>)}</div>
            <input type="number" min={1} max={90} step={1} disabled={!trialAvailable||trialBusy}
              value={trial.trial_days} onChange={e=>setTrial(p=>({...p,trial_days:Number(e.target.value)}))}/>
          </label>
          <label>Máximo de clientes durante o teste<input type="number" min={1} max={300} step={1} disabled={!trialAvailable||trialBusy}
            value={trial.trial_max_clients} onChange={e=>setTrial(p=>({...p,trial_max_clients:Number(e.target.value)}))}/></label>
        </div>
        <label>Título público do teste<input type="text" maxLength={100} disabled={!trialAvailable||trialBusy}
          value={trial.trial_title} onChange={e=>setTrial(p=>({...p,trial_title:e.target.value}))}/></label>
        <label>Descrição da oferta<textarea rows={3} maxLength={300} disabled={!trialAvailable||trialBusy}
          value={trial.trial_description} onChange={e=>setTrial(p=>({...p,trial_description:e.target.value}))}/></label>
        <p className="master-hint">Alterar a duração afeta somente novos escritórios. Alterar o limite de clientes afeta todos os testes em andamento. A cobrança mensal não é automática nesta versão.</p>
        <button className="master-trial-save" disabled={!trialAvailable||trialBusy} onClick={()=>void saveTrial()}>
          {trialBusy?'Salvando…':'Salvar alterações do teste'}
        </button>
      </div>
      <div className="master-trial-table">
        <div className="master-panelhead"><h2>Escritórios no período de teste</h2>
          <button onClick={()=>setTab('monitor')}>Ver todos os cadastros</button></div>
        <div className="master-tablewrap"><table>
          <thead><tr><th>ESCRITÓRIO</th><th>CLIENTES</th><th>COBRANÇAS</th><th>STATUS</th><th>VENCIMENTO</th><th></th></tr></thead>
          <tbody>{trialOffices.map(o=><tr key={o.id}>
            <td><strong>{o.name}</strong><small>{o.owner_email||'Sem responsável'}</small></td>
            <td>{o.clients_active}/{trial.trial_max_clients}</td><td>{o.charges_total}/3</td>
            <td><span className="master-trial-status trial">{trialLabel(o)}</span></td>
            <td>{o.trial_ends_at?timestamp(o.trial_ends_at):'Sem data'}</td>
            <td><button onClick={()=>begin(o)}>Gerenciar</button></td>
          </tr>)}
          {!trialOffices.length&&<tr><td colSpan={6}>Nenhum escritório em avaliação ainda.</td></tr>}</tbody>
        </table></div>
      </div>
    </section>}

   </div>
  </main>
  {editPrice&&<div className="master-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target&&!busy)setEditPrice(null);}}>
    <section className="master-modal" role="dialog" aria-modal="true" aria-labelledby="plan-price-dialog-title">
      <h2 id="plan-price-dialog-title">Alterar valor do plano</h2>
      <p>{editPrice.name} — atualmente {brl(Number(editPrice.monthly_price_brl))}/mês</p>
      <label htmlFor="plan-price-input">Novo valor mensal (R$)
        <input id="plan-price-input" type="text" inputMode="decimal" maxLength={8} autoFocus
          value={priceInput} onChange={e=>{setPriceInput(e.target.value);setPriceError('');}}
          placeholder="Ex.: 79,90" aria-invalid={!!priceError} />
      </label>
      {priceError&&<p className="master-price-error" role="alert">{priceError}</p>}
      <p className="master-hint">O valor ficará salvo no Supabase, será exibido nos planos e atualizará a estimativa mensal do dashboard. Clientes existentes não serão cobrados automaticamente.</p>
      <div className="master-modalactions">
        <button type="button" disabled={busy} onClick={()=>setEditPrice(null)}>Cancelar</button>
        <button type="button" disabled={busy||parsePlanPrice(priceInput)===null} onClick={()=>void savePrice()}>
          {busy?'Salvando…':'Salvar novo valor'}
        </button>
      </div>
    </section>
  </div>}
  {edit&&<div className="master-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)setEdit(null);}}><section className="master-modal" role="dialog" aria-modal="true" aria-label="Administrar escritório">
   <h2>Gerenciar escritório</h2><p>{edit.name} — {edit.owner_email||'Sem responsável'}</p>
   <label>Plano<select value={plan} onChange={e=>setPlan(e.target.value)}>{data.plans.map(p=><option key={p.code} value={p.code}>{p.name} — até {p.client_limit} clientes</option>)}</select></label>
   <label>Situação<select value={access} onChange={e=>setAccess(e.target.value as 'active'|'suspended')}><option value="active">Ativo</option><option value="suspended">Suspenso</option></select></label>
   <div className="master-subscription-control">
     <strong>Assinatura e teste</strong>
     <p>{edit.billing_status==='active'?'Assinatura liberada':
       edit.billing_status==='pending'?'Aguardando contratação':'Teste gratuito · '+(remainingTrialDays(edit.trial_ends_at||null)>0
         ?remainingTrialDays(edit.trial_ends_at||null)+' dia(s) restante(s)':'encerrado')}</p>
     {edit.trial_ends_at&&<small>Vencimento do teste: {new Date(edit.trial_ends_at).toLocaleDateString('pt-BR')}</small>}
     {edit.billing_status!=='active'&&<div className="master-trial-actions">
       <label>Adicionar dias<input type="number" min={1} max={90} step={1}
         value={extendDays} onChange={e=>setExtendDays(Number(e.target.value))}/></label>
       <button type="button" disabled={busy} onClick={()=>void changeBilling('extend_trial')}>Prorrogar teste</button>
       <button type="button" disabled={busy} onClick={()=>void changeBilling('activate')}>Liberar assinatura</button>
     </div>}
     {edit.billing_status==='active'&&<button type="button" className="master-mark-pending" disabled={busy}
       onClick={()=>void changeBilling('pending')}>Colocar em acesso pendente</button>}
     {error&&<p className="master-price-error" role="alert">{error}</p>}
   </div>
   <p className="master-hint">A suspensão impede acesso aos dados operacionais e futuros envios. Não exclui documentos.</p>
   <div className="master-modalactions"><button onClick={()=>setEdit(null)}>Cancelar</button><button disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':'Salvar alterações'}</button></div>
  </section></div>}
 </div>;
}
