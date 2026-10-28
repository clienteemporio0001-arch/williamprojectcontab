import {useState} from 'react';
import {ArrowRight,Check,CheckCircle2,Clock3,FileText,LockKeyhole,MessageCircle,ShieldCheck,Users,Wallet,X} from 'lucide-react';
import './upgrade.css';
export type UpgradePlan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Props={
  plans:UpgradePlan[];
  currentPlan:string;
  officeName:string;
  isTrial:boolean;
  onClose:()=>void;
  onRequest:(plan:UpgradePlan)=>Promise<string>;
};
const currency=(amount:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(amount);
const whatsapp='5568992097927';
export default function UpgradePlansModal({plans,currentPlan,officeName,isTrial,onClose,onRequest}:Props){
  const [selected,setSelected]=useState('');
  const [requestId,setRequestId]=useState('');
  const [chosen,setChosen]=useState<UpgradePlan|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const picked=plans.find(p=>p.code===selected);
  async function requestPlan(){
    if(!picked||busy)return;
    setBusy(true);setError('');
    try{
      const id=await onRequest(picked);
      setChosen(picked);setRequestId(id);
    }catch(err){
      const message=err instanceof Error?err.message:String(err);
      setError(/request_saas_upgrade|schema cache|not find the function|PGRST202/i.test(message)
        ?'A contratação ainda não está ativada no Supabase. Peça ao administrador para instalar a etapa de pedidos antes de prosseguir.'
        :message);
    }finally{setBusy(false);}
  }
  const note=chosen?
    'Olá! Quero concluir a contratação do ContabFlow. Escritório: '+officeName+
    '. Plano: '+chosen.name+'. Valor mensal exibido: '+currency(Number(chosen.monthly_price_brl))+
    '. Pedido: '+requestId+'. Como posso confirmar o pagamento?':'';
  return <div className="upgrade-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
    <section className="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
      <header className="upgrade-dialog-head">
        <div className="upgrade-dialog-icon"><Wallet size={21}/></div>
        <div><span>CONTABFLOW • PLANOS SAAS</span><h2 id="upgrade-title">{requestId?'Seu pedido foi registrado':'Leve seu escritório para o próximo nível'}</h2></div>
        <button type="button" aria-label="Fechar ofertas" onClick={onClose} className="upgrade-close"><X size={20}/></button>
      </header>
      {requestId&&chosen?<div className="upgrade-confirmation">
        <CheckCircle2 size={38}/>
        <h3>Plano {chosen.name} solicitado</h3>
        <p>Recebemos seu pedido <strong>#{requestId.slice(0,8).toUpperCase()}</strong>. A escolha do plano não realiza cobranças nem libera a assinatura automaticamente.</p>
        <p>Conclua o pagamento com a equipe. Após a confirmação financeira, o administrador libera o acesso correspondente, mantendo seus clientes e documentos.</p>
        <a className="upgrade-contact-link" href={'https://wa.me/'+whatsapp+'?text='+encodeURIComponent(note)}
          target="_blank" rel="noopener noreferrer"><MessageCircle size={18}/> Concluir contratação pelo WhatsApp <ArrowRight size={17}/></a>
        <button type="button" className="upgrade-secondary" onClick={onClose}>Voltar ao painel</button>
      </div>:<>
        <p className="upgrade-lead">{isTrial?'Seu teste continua disponível até o vencimento. Escolha o plano ideal para continuar sem os limites da avaliação.':'Escolha o plano de acordo com a quantidade de clientes que seu escritório precisa atender.'} Os valores são definidos pelo Admin Master.</p>
        <div className="upgrade-plan-grid">
          {plans.map((plan,i)=><article key={plan.code} className={'upgrade-plan '+(selected===plan.code?'selected ':'')+(i===1?'featured':'')}>
            {i===1&&<span className="upgrade-popular">MAIS CAPACIDADE</span>}
            <div className="upgrade-plan-head"><div><Wallet size={19}/><h3>{plan.name}</h3></div>
              {currentPlan===plan.code&&<span className="upgrade-current">Plano do seu teste</span>}</div>
            <div className="upgrade-price">{currency(Number(plan.monthly_price_brl))}<small>/mês</small></div>
            <div className="upgrade-benefits">
              <span><Users size={15}/> Até <strong>{plan.client_limit} clientes ativos</strong></span>
              <span><FileText size={15}/> Cobranças e PDFs personalizados</span>
              <span><Clock3 size={15}/> Vencimentos organizados</span>
              <span><Check size={15}/> Sem limites do teste grátis</span>
            </div>
            <button className={selected===plan.code?'upgrade-selected-btn':'upgrade-plan-btn'}
              type="button" disabled={busy} onClick={()=>{setSelected(plan.code);setError('');}}>
              {selected===plan.code?'Plano selecionado':'Escolher '+plan.name} <ArrowRight size={15}/>
            </button>
          </article>)}
        </div>
        {!plans.length&&<p className="upgrade-error">Não foi possível carregar os planos. Atualize a página e tente novamente.</p>}
        <div className="upgrade-summary">
          <div className="upgrade-summary-info"><ShieldCheck size={21}/>
            <span><strong>{picked?'Plano '+picked.name+' · '+currency(Number(picked.monthly_price_brl))+'/mês':'Selecione um dos planos acima'}</strong>
              <small>Solicitação sem cobrança imediata. O acesso só muda após confirmação do pagamento.</small></span>
          </div>
          <button type="button" className="upgrade-primary" disabled={!picked||busy} onClick={()=>void requestPlan()}>
            {busy?'Registrando…':'Solicitar contratação'} <ArrowRight size={16}/>
          </button>
        </div>
        {error&&<p className="upgrade-error" role="alert">{error}</p>}
        <p className="upgrade-disclaimer"><LockKeyhole size={13}/> Contratação acompanhada pelo administrador. Automatização do checkout e pagamentos recorrentes ainda não estão habilitados.</p>
      </>}
    </section>
  </div>;
}
