import {useState,type FormEvent} from 'react';
import {ArrowRight,CalendarClock,CheckCircle2,Clock3,FileText,LayoutDashboard,LockKeyhole,LogOut,ShieldCheck,Sparkles,Users} from 'lucide-react';
import type {TrialSettings} from './lib/trial';
import './styles.css';

type Plan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Props={
 name:string;
 plans:Plan[];
 plansError:boolean;
 trial:TrialSettings;
 initialOffice:string;
 busy:boolean;
 error:string;
 onActivate:(planCode:string,officeName:string)=>Promise<void>;
 onLogout:()=>void;
};
const currency=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);

export default function ProspectWelcome({name,plans,plansError,trial,initialOffice,busy,error,onActivate,onLogout}:Props){
 const [step,setStep]=useState<'preview'|'activate'>('preview');
 const [chosen,setChosen]=useState('');
 const [office,setOffice]=useState(initialOffice);
 const [detailsOpen,setDetailsOpen]=useState(false);
 const firstName=name.trim().split(/\s+/)[0]||'contador';
 async function submit(e:FormEvent){
  e.preventDefault();
  if(!chosen||office.trim().length<2)return;
  await onActivate(chosen,office.trim());
 }
 return <div className="welcome-shell">
   <header className="welcome-header"><div className="welcome-brand"><span className="welcome-mark"><CalendarClock size={22}/></span><span>contab<span>flow</span><small>SEU ESPAÇO DE TRABALHO</small></span></div>
     <button onClick={onLogout}><LogOut size={16}/> Sair</button></header>
   <div className="welcome-content">
     <div className="welcome-breadcrumb">MINHA PLATAFORMA <span>/</span> BOAS-VINDAS</div>
     <div className="welcome-head"><div><span className="welcome-greeting"><Sparkles size={15}/> Seu acesso está pronto</span>
       <h1>Bem-vindo ao seu espaço, {firstName}.</h1>
       <p>Esse painel é seu para conhecer. Explore a proposta do ContabFlow com calma. <strong>Seus dias grátis ainda não começaram.</strong></p>
     </div><span className="welcome-chip"><LockKeyhole size={14}/> Nenhuma cobrança ativa</span></div>

     {step==='preview'?<>
       <div className="welcome-preview-grid">
         <div className="welcome-preview-card"><Users size={21}/><span>Minha carteira</span><strong>Clientes</strong><p>Cadastre seus clientes quando ativar o teste.</p></div>
         <div className="welcome-preview-card"><FileText size={21}/><span>Minha operação</span><strong>Cobranças e PDFs</strong><p>Gerencie honorários, valores e documentos personalizados.</p></div>
         <div className="welcome-preview-card"><CalendarClock size={21}/><span>Meus vencimentos</span><strong>Calendário</strong><p>Acompanhe prazos e cobranças a vencer.</p></div>
       </div>
       <div className="welcome-main-panel">
         <div className="welcome-main-copy"><span className="welcome-small-title">O PRÓXIMO PASSO É SEU</span>
           <h2>Pronto para experimentar com seus próprios dados?</h2>
           <p>Escolha um plano e ative o período de avaliação quando quiser. Você poderá testar com até {trial.trial_max_clients} clientes e três cobranças.</p>
           {trial.trial_enabled?<div className="welcome-available"><CheckCircle2 size={18}/> {trial.trial_days} {trial.trial_days===1?'dia grátis':'dias grátis'} aguardando você</div>
             :<div className="welcome-available"><ShieldCheck size={18}/> Seu acesso será liberado após avaliação do administrador</div>}
           <button className="welcome-primary" onClick={()=>setStep('activate')}>Conhecer planos e começar <ArrowRight size={18}/></button>
           <small>Escolher um plano agora não realiza nenhuma cobrança e não exige cartão.</small>
         </div>
         <div className="welcome-sample-panel"><div className="welcome-sample-top"><LayoutDashboard size={17}/> Seu painel <small>PRÉVIA</small></div>
           <h3>Visão geral</h3>
           <div className="welcome-sample-numbers"><span>Clientes <b>—</b></span><span>Cobranças <b>—</b></span><span>Próximos prazos <b>—</b></span></div>
           <div className="welcome-sample-row"><FileText size={17}/> Seus documentos aparecerão aqui</div>
           <div className="welcome-sample-row"><Clock3 size={17}/> Seus vencimentos aparecerão aqui</div>
           <p>Visualização ilustrativa: os recursos são liberados depois de iniciar o teste.</p>
         </div>
       </div>
       <button className="welcome-help" onClick={()=>setDetailsOpen(!detailsOpen)} aria-expanded={detailsOpen}>
         <ShieldCheck size={17}/> O que consigo testar? <span>{detailsOpen?'−':'+'}</span>
       </button>
       {detailsOpen&&<div className="welcome-limit-info">Durante a avaliação: {trial.trial_max_clients} clientes cadastrados no máximo, 3 cobranças e geração de PDFs. O disparo automático oficial pelo WhatsApp ainda não está disponível. Após o prazo, o acesso operacional será suspenso até a ativação de um plano.</div>}
     </>:
       <section className="welcome-activation">
         <button className="welcome-back" onClick={()=>setStep('preview')}>← Voltar ao meu painel</button>
         <div className="welcome-activation-head"><span className="welcome-small-title">ATIVAR A AVALIAÇÃO</span><h2>Escolha o tamanho da sua operação.</h2>
           <p>O plano define o limite da assinatura futura. Durante a avaliação você poderá usar até {trial.trial_max_clients} clientes e 3 cobranças.</p></div>
         <form onSubmit={submit}>
           <div className="welcome-plans" role="radiogroup" aria-label="Planos de assinatura">
             {plans.map(p=><label className={'welcome-plan '+(chosen===p.code?'is-selected':'')} key={p.code}>
               <input type="radio" name="selected-plan" checked={chosen===p.code} onChange={()=>setChosen(p.code)} required/>
               <span className="welcome-plan-text"><strong>{p.name}</strong><small>Até {p.client_limit} clientes quando assinar</small></span>
               <span className="welcome-plan-price">{currency(Number(p.monthly_price_brl))}<small>/mês</small></span>
             </label>)}
           </div>
           {plansError&&<p className="welcome-error" role="alert">Não foi possível carregar os planos. Atualize a página antes de iniciar o teste.</p>}
           {!plansError&&!plans.length&&<p>Carregando os planos disponíveis…</p>}
           <div className="welcome-office-field"><label htmlFor="welcome-office">Nome do escritório *</label>
             <input id="welcome-office" minLength={2} maxLength={100} value={office}
               onChange={e=>setOffice(e.target.value)} required placeholder="Ex.: Oliveira Contabilidade"/>
             <small>CNPJ e CRC podem ser preenchidos posteriormente em Configurações.</small>
           </div>
           {error&&<p className="welcome-error" role="alert">{error}</p>}
           <div className="welcome-activate-foot"><div><Clock3 size={19}/><span><strong>{trial.trial_enabled?'Seu teste começa ao confirmar':'Liberação manual após cadastro'}</strong><small>{trial.trial_enabled?trial.trial_days+' dias grátis · sem cartão · sem débito automático':'Sua conta será criada, mas aguarda liberação para usar os recursos'}</small></span></div>
             <button disabled={!chosen||!plans.length||busy} className="welcome-primary" type="submit">{busy?'Preparando seu escritório…':'Ativar meu escritório'} <ArrowRight size={18}/></button></div>
         </form>
       </section>}
   </div>
 </div>;
}
