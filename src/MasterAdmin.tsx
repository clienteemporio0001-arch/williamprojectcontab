import { useCallback,useEffect,useMemo,useState } from 'react';
import { Building2,Users,Wallet,ShieldCheck,LogOut,RefreshCw,Search,Settings2,LockKeyhole,CheckCircle2,FileText,Pencil,Clock3 } from 'lucide-react';
import { supabase } from './lib/supabase';
import {parsePlanPrice,formatPlanPriceInput} from './lib/plan-prices';
import {DEFAULT_TRIAL,type TrialSettings,remainingTrialDays} from './lib/trial';
import './master.css';

type Plan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Office={id:string;name:string;created_at:string;owner_email:string|null;plan_code:string;plan_name:string;access_status:'active'|'suspended';client_limit:number;monthly_price_brl:number;clients_active:number;charges_total:number;notifications_accepted:number;billing_status?:'active'|'trialing'|'pending';trial_started_at?:string|null;trial_ends_at?:string|null};
type Data={organizations:Office[];plans:Plan[]};
type Props={canOpenOffice:boolean;onOpenOffice:()=>void};
const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
export default function MasterAdmin({canOpenOffice,onOpenOffice}:Props){
 const [tab,setTab]=useState<'home'|'offices'|'plans'|'trial'>('home');
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
 const reload=useCallback(async()=>{if(!supabase)return;setBusy(true);setError('');
  const {data:result,error:e}=await supabase.rpc('master_dashboard');
  if(e)setError('Não foi possível consultar o Admin Master: '+e.message);
  else{const payload=result as Data|null;setData({organizations:payload?.organizations||[],plans:payload?.plans||[]});}
  setBusy(false);
 },[]);
 useEffect(()=>{void reload();},[reload]);
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
  <button className={tab==='trial'?'current':''} onClick={()=>setTab('trial')}><Clock3 size={18}/>Teste grátis</button>
  <div className="master-sidefoot"><div><LockKeyhole size={17}/> Área restrita ao administrador da plataforma</div>
   {canOpenOffice&&<button onClick={onOpenOffice}><Building2 size={17}/>Painel do contador</button>}
   <button onClick={()=>{if(supabase)void supabase.auth.signOut();}}><LogOut size={17}/>Sair</button>
  </div></aside>
  <main className="master-content"><header className="master-top"><span>ContabFlow / <strong>Admin Master</strong></span><button disabled={busy} onClick={()=>void reload()}><RefreshCw size={16}/>Atualizar</button></header>
   <div className="master-inner"><p className="master-eyebrow">PAINEL ADMINISTRATIVO</p>
    <h1>{tab==='home'?'Visão geral da plataforma':tab==='offices'?'Escritórios cadastrados':tab==='plans'?'Planos e limites':'Configurar teste grátis'}</h1>
    <p className="master-sub">{tab==='home'?'Acompanhe sua carteira de escritórios e o uso da plataforma.':tab==='offices'?'Controle o acesso e o plano de cada contador.':tab==='plans'?'Preços configurados para o SaaS (não significam pagamentos recebidos).':'Personalize a duração, o limite e a oferta do período de avaliação.'}</p>
    {error&&<div className="master-alert">{error}</div>}{notice&&<div className="master-alert success">{notice}</div>}
    {busy&&<p className="master-loading">Atualizando informações…</p>}
    {tab==='home'&&<>
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
    {tab==='trial'&&<section className="master-panel master-trial">
      <div className="master-panelhead"><h2>Oferta de teste grátis</h2><Clock3 size={19}/></div>
      <div className="master-trial-content">
        <p className="master-trial-intro">O prazo começa quando o escritório é criado. Após o vencimento, a plataforma bloqueia clientes e cobranças até você prorrogar o teste ou liberar a assinatura.</p>
        {trialError&&<div className="master-alert" role="alert">{trialError}</div>}
        <label className="master-trial-switch"><input type="checkbox" disabled={!trialAvailable||trialBusy} checked={trial.trial_enabled}
          onChange={e=>setTrial(p=>({...p,trial_enabled:e.target.checked}))}/>
          <span><strong>Oferecer teste gratuito a novos escritórios</strong><small>Se desativado, novos escritórios aguardam sua liberação.</small></span>
        </label>
        <div className="master-trial-cols">
          <label>Duração do teste (dias)<input type="number" min={1} max={90} step={1} disabled={!trialAvailable||trialBusy}
            value={trial.trial_days} onChange={e=>setTrial(p=>({...p,trial_days:Number(e.target.value)}))}/></label>
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
    </section>}
    {tab==='plans'&&<div className="master-plan-grid">{data.plans.map(p=><article key={p.code}><Wallet size={22}/><h2>{p.name}</h2><strong>{brl(Number(p.monthly_price_brl))}<small>/mês</small></strong><p><CheckCircle2 size={16}/> Até {p.client_limit} clientes ativos</p><p><FileText size={16}/> Gestão de cobranças e PDFs</p><p>Os valores são propostas comerciais, sem cobrança de assinatura integrada.</p><button type="button" className="master-price-edit" disabled={busy} onClick={()=>beginPrice(p)}><Pencil size={16}/> Alterar valor</button></article>)}</div>}
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
