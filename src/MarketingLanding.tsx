import { useEffect,useState } from 'react';
import { CalendarClock, FileText, MailCheck, ShieldCheck, Clock3, ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from './lib/supabase';
import { type TrialSettings } from './lib/trial';
import './landing.css';

type PublicPlan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Props={onLogin:()=>void;onSignup:(planCode?:string)=>void;trial:TrialSettings};
const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);
export default function MarketingLanding({onLogin,onSignup,trial}:Props){
  const [plans,setPlans]=useState<PublicPlan[]>([]);
  useEffect(()=>{
    if(!supabase)return;
    let mounted=true;
    void supabase.from('subscription_plans')
      .select('code,name,client_limit,monthly_price_brl')
      .order('client_limit',{ascending:true}).then(({data,error})=>{
        if(mounted&&!error)setPlans((data||[]) as PublicPlan[]);
      });
    return()=>{mounted=false;};
  },[]);
  return <div className="landing">
    <header className="landing-header">
      <div className="landing-brand"><span className="landing-logo"><CalendarClock size={24}/></span>
        <span>contab<span>flow</span><small>AUTOMAÇÃO CONTÁBIL</small></span></div>
      <nav aria-label="Navegação pública" className="landing-nav">
        <a href="#vantagens">Vantagens</a><a href="#precos">Planos</a>
        <button onClick={onLogin}>Entrar</button>
        <button className="landing-nav-primary" onClick={()=>onSignup()}>Criar conta</button>
      </nav>
    </header>
    <main>
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><ShieldCheck size={14}/> MAIS TEMPO PARA SEU ESCRITÓRIO</div>
          <h1>Chega de criar as mesmas cobranças todo mês.</h1>
          <p>Organize honorários contábeis, gere avisos personalizados em PDF e prepare lembretes por cliente. Tudo em um só painel.</p>
          {trial.trial_enabled&&<div className="landing-trial"><Clock3 size={18}/><div><strong>{trial.trial_title}</strong><span>{trial.trial_days} {trial.trial_days===1?'dia':'dias'} grátis para conhecer a plataforma · até {trial.trial_max_clients} clientes no teste.</span></div></div>}
          <div className="landing-actions">
            <button className="landing-cta" onClick={()=>onSignup()}>{trial.trial_enabled?'Começar teste grátis':'Criar conta'} <ArrowRight size={18}/></button>
            <button className="landing-secondary" onClick={onLogin}>Já tenho uma conta</button>
          </div>
          <small>{trial.trial_enabled?trial.trial_description:'Crie sua conta e solicite a liberação do seu escritório.'} {trial.trial_enabled?'Sem cobrança automática no período de teste.':''}</small>
        </div>
        <div className="landing-showcase" aria-label="Exemplo de visualização de cobranças">
          <div className="landing-showcase-top"><span className="landing-showcase-dot"/> Visão da sua operação <span className="landing-showcase-pill">PAINEL</span></div>
          <div className="landing-showcase-stat"><FileText size={22}/><div><strong>Avisos de cobrança</strong><span>Nome, valores e vencimentos personalizados</span></div></div>
          <div className="landing-showcase-item"><span className="landing-showcase-avatar">1</span><span>Honorários de outubro<small>Documento personalizado em PDF</small></span><span className="landing-mini-status">Pendente</span></div>
          <div className="landing-showcase-item"><span className="landing-showcase-avatar">2</span><span>Lembrete de vencimento<small>Escolha os dias de acompanhamento</small></span><span className="landing-mini-status">Agendar</span></div>
          <div className="landing-showcase-foot"><CheckCircle2 size={15}/> Organize os dados uma única vez</div>
          <p className="landing-example-note">Exemplo ilustrativo · WhatsApp automático sujeito à ativação da API oficial.</p>
        </div>
      </section>
      <section id="vantagens" className="landing-benefits">
        <div><FileText size={23}/><h2>Documentos personalizados</h2><p>Crie avisos de cobrança com nome do cliente, valor, vencimento e identificação do escritório.</p></div>
        <div><Clock3 size={23}/><h2>Recorrência mensal</h2><p>Cadastre uma vez e organize os vencimentos de cada competência.</p></div>
        <div><MailCheck size={23}/><h2>Lembretes planejados</h2><p>Determine quando os clientes devem ser lembrados. O envio automático por WhatsApp exige configuração adicional.</p></div>
      </section>
      <section id="precos" className="landing-pricing">
        <div className="landing-section-kicker">PLANOS PARA CADA ESCRITÓRIO</div>
        <h2>Comece pequeno e cresça com a sua carteira.</h2>
        {plans.length>0?<div className="landing-pricing-grid">{plans.map(p=><div key={p.code} className="landing-price-card"><h3>{p.name}</h3><strong>{brl(Number(p.monthly_price_brl))}<small>/mês</small></strong><p>Até {p.client_limit} clientes ativos</p>{trial.trial_enabled&&<p className="landing-plan-trial">Teste grátis de {trial.trial_days} {trial.trial_days===1?'dia':'dias'} · até {trial.trial_max_clients} clientes no teste</p>}<button onClick={()=>onSignup(p.code)}>{trial.trial_enabled?'Testar este plano':'Escolher este plano'} <ArrowRight size={15}/></button></div>)}</div>
        :<p className="landing-price-placeholder">Os planos estão sendo configurados. Consulte nossa equipe para conhecer os valores.</p>}
        <p className="landing-price-disclaimer">Valores informativos. A assinatura e os envios automáticos ainda dependem da ativação dos respectivos serviços.</p>
      </section>
    </main>
    <footer className="landing-footer"><span>© ContabFlow · Automação contábil</span><button onClick={onLogin}>Acessar minha conta</button></footer>
  </div>;
}
