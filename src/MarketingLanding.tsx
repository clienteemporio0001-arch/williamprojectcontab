import {useEffect,useState,type FormEvent} from 'react';
import {
  ArrowRight,ArrowUpRight,CalendarClock,Check,CheckCircle2,FileText,
  MessageCircle,ShieldCheck,Users,Wallet,Repeat2,Sparkles,LockKeyhole,Mail,
  CircleHelp,TimerReset
} from 'lucide-react';
import {supabase} from './lib/supabase';
import type {TrialSettings} from './lib/trial';
import './landing.css';

type Plan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Lead={name:string;email:string;phone:string};
type Props={onLogin:()=>void;onLead:(lead:Lead)=>Promise<string>;trial:TrialSettings};
const brl=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n);

const QUESTIONS=[
  {q:'Preciso informar CNPJ para conhecer?',a:'Não. Primeiro, basta seu nome, WhatsApp e e-mail. Você escolhe o plano e informa o nome do escritório somente quando decidir iniciar a avaliação.'},
  {q:'O teste começa assim que cadastro meu e-mail?',a:'Não. Você pode entrar e conhecer seu painel. O prazo da avaliação só começa quando você escolhe um plano e ativa seu escritório.'},
  {q:'O teste exige cartão de crédito?',a:'Não. O ContabFlow não solicita cartão para ativar a avaliação e não faz cobrança automática ao seu término.'},
  {q:'O ContabFlow envia WhatsApp sozinho?',a:'O produto prepara mensagens e organiza lembretes. O envio automático depende de ativação da API oficial do WhatsApp, modelos aprovados e autorização do destinatário; não está disponível na avaliação.'},
  {q:'O ContabFlow substitui meu sistema contábil?',a:'Não. O foco inicial é organizar honorários, gerar documentos de cobrança e acompanhar vencimentos, complementando a operação do escritório.'}
];

export default function MarketingLanding({onLogin,onLead,trial}:Props){
  const [plans,setPlans]=useState<Plan[]>([]);
  const [name,setName]=useState('');
  const [phone,setPhone]=useState('');
  const [email,setEmail]=useState('');
  const [submitting,setSubmitting]=useState(false);
  const [notice,setNotice]=useState('');
  const [failure,setFailure]=useState('');
  const [opened,setOpened]=useState<number|null>(0);
  const [customers,setCustomers]=useState(50);
  const [minutes,setMinutes]=useState(6);
  const hoursPerMonth=Number((customers*minutes/60).toFixed(1));

  useEffect(()=>{
    if(!supabase)return;
    let live=true;
    void supabase.from('subscription_plans')
      .select('code,name,client_limit,monthly_price_brl')
      .order('client_limit',{ascending:true}).then(({data,error})=>{
        if(live&&!error)setPlans((data||[]) as Plan[]);
      });
    return()=>{live=false;};
  },[]);

  async function submit(e:FormEvent){
    e.preventDefault();setFailure('');setNotice('');
    if(!name.trim()||!phone.trim()||!email.trim())return;
    setSubmitting(true);
    try{setNotice(await onLead({name:name.trim(),phone:phone.trim(),email:email.trim().toLowerCase()}));}
    catch(err){setFailure(err instanceof Error?err.message:'Não foi possível enviar seu acesso. Tente novamente.');}
    finally{setSubmitting(false);}
  }

  const focusForm=()=>{
    document.getElementById('começar')?.scrollIntoView({behavior:'smooth',block:'center'});
    window.setTimeout(()=>document.getElementById('lead-name')?.focus(),500);
  };

  return <div className="landing">
    <header className="landing-header">
      <a className="landing-brand" href="#inicio" aria-label="ContabFlow, início"><span className="landing-logo"><CalendarClock size={23}/></span>
        <span>contab<span>flow</span><small>AUTOMAÇÃO PARA CONTADORES</small></span></a>
      <nav className="landing-nav" aria-label="Navegação">
        <a href="#como-funciona">Como funciona</a><a href="#economia">Economia de tempo</a><a href="#precos">Planos</a>
        <button type="button" onClick={onLogin} className="landing-login">Entrar</button>
        <button type="button" className="landing-nav-primary" onClick={focusForm}>Começar grátis <ArrowRight size={15}/></button>
      </nav>
    </header>
    <main>
      <section id="inicio" className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow"><span/> FEITO PARA ESCRITÓRIOS CONTÁBEIS</div>
          <h1>Todo mês as mesmas cobranças.<br/><em>Seu tempo vale mais.</em></h1>
          <p>Chega de trocar nomes, valores e vencimentos manualmente. Organize os honorários dos seus clientes, gere PDFs individuais e acompanhe prazos em um painel simples.</p>
          <div className="landing-benefit-chips"><span><Check size={15}/> PDFs personalizados</span><span><Check size={15}/> Cobranças recorrentes</span><span><Check size={15}/> Mais organização</span></div>
          <button type="button" className="landing-text-cta" onClick={focusForm}>Quero conhecer minha plataforma <ArrowRight size={18}/></button>
          <div className="landing-proof"><ShieldCheck size={17}/><span>Sem cartão de crédito • Sem cobrança automática • Seus dados são separados dos de outros escritórios</span></div>
        </div>
        <div id="começar" className="landing-lead-card">
          <div className="landing-lead-top"><span className="landing-lead-icon"><Sparkles size={20}/></span><span>SEU PRIMEIRO PASSO</span></div>
          <h2>Seu escritório mais leve começa aqui.</h2>
          <p>Três informações. Um acesso ao seu painel. O plano você escolhe lá dentro.</p>
          <form onSubmit={submit} className="landing-lead-form">
            <label htmlFor="lead-name">Seu nome</label>
            <input id="lead-name" autoComplete="name" minLength={3} maxLength={120} required value={name}
              onChange={e=>setName(e.target.value)} placeholder="Como podemos chamar você?"/>
            <label htmlFor="lead-phone">WhatsApp com DDD</label>
            <input id="lead-phone" type="tel" autoComplete="tel" required value={phone}
              onChange={e=>setPhone(e.target.value)} placeholder="(68) 99999-9999"/>
            <label htmlFor="lead-email">Seu melhor e-mail</label>
            <input id="lead-email" type="email" autoComplete="email" required value={email}
              onChange={e=>setEmail(e.target.value)} placeholder="voce@seuescritorio.com.br"/>
            {failure&&<p className="landing-form-error" role="alert">{failure}</p>}
            {notice&&<p className="landing-form-success" role="status"><CheckCircle2 size={17}/>{notice}</p>}
            <button type="submit" className="landing-cta" disabled={submitting}>
              {submitting?'Enviando acesso…':'Conhecer meu painel'} <ArrowRight size={18}/>
            </button>
            <small><LockKeyhole size={13}/> Enviaremos um link seguro de entrada por e-mail. O teste só começa quando você ativá-lo.</small>
          </form>
        </div>
      </section>

      <section className="landing-trust-strip" aria-label="Principais vantagens"><div><FileText/>Documento de cobrança individual</div><div><CalendarClock/>Vencimentos sob controle</div><div><Repeat2/>Organização mês após mês</div></section>

      <section id="como-funciona" className="landing-section landing-work">
        <div className="landing-center"><span className="landing-section-kicker">A DOR DO SEU ESCRITÓRIO</span>
          <h2>Você foi contratado para cuidar de empresas.<br/><span>Não para editar a mesma cobrança 80 vezes.</span></h2>
          <p>Quando cada cliente tem seu valor e sua data, uma rotina simples vira horas de tarefas repetitivas.</p></div>
        <div className="landing-pain-grid">
          <div><span className="landing-pain-tag">ANTES</span><h3>Processo manual</h3>
            <p>Copiar documento, trocar nome, conferir valor, alterar vencimento e repetir para o próximo cliente.</p>
            <div className="landing-pain-example"><span>01. Abrir modelo</span><span>02. Trocar os dados</span><span>03. Salvar PDF</span><span>04. Repetir tudo...</span></div></div>
          <div className="landing-after"><span className="landing-pain-tag">COM CONTABFLOW</span><h3>Uma rotina mais organizada</h3>
            <p>Cadastre o cliente, configure os honorários e gere o aviso com os dados certos. Acompanhe as cobranças em um lugar só.</p>
            <div className="landing-pain-example"><span><CheckCircle2 size={16}/> Cadastro centralizado</span><span><CheckCircle2 size={16}/> Dados personalizados</span><span><CheckCircle2 size={16}/> PDF individual</span><span><CheckCircle2 size={16}/> Vencimentos visíveis</span></div></div>
        </div>
      </section>

      <section className="landing-section landing-features">
        <div className="landing-center"><span className="landing-section-kicker">TUDO O QUE VOCÊ PRECISA PARA COMEÇAR</span><h2>O fim do retrabalho começa com organização.</h2></div>
        <div className="landing-feature-grid">
          <article><div><Users/></div><h3>Seus clientes num só lugar</h3><p>Carteira organizada com contatos, informações e autorização para comunicação.</p></article>
          <article><div><FileText/></div><h3>Cobranças em PDF</h3><p>Gere avisos personalizados com o nome do cliente, serviço, valor e vencimento.</p></article>
          <article><div><Repeat2/></div><h3>Competências recorrentes</h3><p>Organize honorários que voltam mês após mês, sem perder os registros anteriores.</p></article>
          <article><div><CalendarClock/></div><h3>Prazos sob controle</h3><p>Visualize o que está próximo do vencimento, pendente e em atraso.</p></article>
          <article><div><Wallet/></div><h3>Uma solução acessível</h3><p>Planos proporcionais ao número de clientes do seu escritório.</p></article>
          <article><div><MessageCircle/></div><h3>Comunicação planejada</h3><p>Prepare mensagens de lembrete. Envios oficiais automáticos exigem integração e ativação.</p></article>
        </div>
      </section>

      <section id="economia" className="landing-section landing-roi">
        <div className="landing-roi-text"><span className="landing-section-kicker">SEU TEMPO TEM VALOR</span>
          <h2>Quanto do seu mês vai embora em tarefas repetidas?</h2>
          <p>Faça uma simulação simples para dimensionar o tempo gasto ao preparar manualmente as cobranças.</p>
          <p className="landing-roi-disclaimer">É uma estimativa da rotina manual, não uma promessa de horas efetivamente economizadas pelo ContabFlow.</p></div>
        <div className="landing-roi-card">
          <label>Clientes com cobrança mensal <strong>{customers}</strong></label>
          <input type="range" min="10" max="300" step="10" value={customers} onChange={e=>setCustomers(Number(e.target.value))}/>
          <label>Minutos gastos por documento <strong>{minutes} min</strong></label>
          <input type="range" min="2" max="15" step="1" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/>
          <div className="landing-roi-result"><TimerReset size={27}/><div><span>Tempo mensal estimado no processo manual</span><strong>{hoursPerMonth.toLocaleString('pt-BR')} horas</strong></div></div>
          <small>Fórmula: clientes × minutos informados ÷ 60. Compare com seu processo real após experimentar.</small>
        </div>
      </section>

      <section className="landing-section landing-experience">
        <div><span className="landing-section-kicker">EXPLORE ANTES DE DECIDIR</span><h2>Entre. Conheça. Escolha o momento de testar.</h2>
          <p>Seu primeiro acesso leva você a um painel próprio. Veja como funciona e, quando estiver pronto, escolha o plano e inicie a avaliação.</p>
          <div className="landing-experience-steps"><span><b>01</b> Nome, WhatsApp e e-mail</span><span><b>02</b> Confirmação de acesso</span><span><b>03</b> Seu painel de boas-vindas</span><span><b>04</b> Escolha do plano e ativação do teste</span></div>
          <button className="landing-cta" onClick={focusForm}>Quero conhecer <ArrowRight size={18}/></button></div>
        <div className="landing-ui-preview">
          <div className="landing-ui-top"><span className="landing-ui-dot"/><span>contabflow</span><small>PRÉVIA ILUSTRATIVA</small></div>
          <div className="landing-ui-title">Visão geral do escritório</div>
          <div className="landing-ui-stats"><div><small>Clientes</small><strong>50</strong></div><div><small>Próximos 7 dias</small><strong>12</strong></div><div><small>Em atraso</small><strong>3</strong></div></div>
          <div className="landing-ui-list"><span><FileText size={17}/> Honorários de outubro <b>Próximo</b></span><span><FileText size={17}/> Competência mensal <b>Pendente</b></span><span><FileText size={17}/> Cobrança personalizada <b>PDF</b></span></div>
        </div>
      </section>

      <section id="precos" className="landing-section landing-pricing">
        <div className="landing-center"><span className="landing-section-kicker">PLANOS ACESSÍVEIS</span><h2>Comece no tamanho do seu escritório.</h2>
          <p>Conheça o painel primeiro. Escolha o plano somente quando decidir ativar o teste.</p></div>
        <div className="landing-pricing-grid">
          {plans.length?plans.map((p,index)=><article className={'landing-price-card '+(index===1?'landing-featured':'')} key={p.code}>
            {index===1&&<div className="landing-popular">PARA QUEM ESTÁ CRESCENDO</div>}
            <h3>{p.name}</h3><strong>{brl(Number(p.monthly_price_brl))}<small>/mês</small></strong>
            <p><CheckCircle2 size={16}/> Até {p.client_limit} clientes no plano</p>
            <p><CheckCircle2 size={16}/> PDFs e gestão de cobranças</p>
            <p><CheckCircle2 size={16}/> Vencimentos organizados</p>
            {trial.trial_enabled&&<div className="landing-price-trial">Avaliação por {trial.trial_days} {trial.trial_days===1?'dia':'dias'} · até {trial.trial_max_clients} clientes</div>}
            <button type="button" onClick={focusForm}>Conhecer antes de escolher <ArrowRight size={16}/></button>
          </article>):<p className="landing-price-placeholder">Valores em atualização. Entre para conhecer a plataforma e consultar os planos.</p>}
        </div>
        <p className="landing-price-disclaimer">A assinatura não é cobrada automaticamente. Envios automáticos por WhatsApp dependem de integração separada.</p>
      </section>

      <section className="landing-section landing-faq">
        <div className="landing-center"><span className="landing-section-kicker">PERGUNTAS FREQUENTES</span><h2>Sem complicação. Sem surpresas.</h2></div>
        <div className="landing-faq-list">{QUESTIONS.map((x,i)=><div key={x.q}>
          <button type="button" aria-expanded={opened===i} onClick={()=>setOpened(opened===i?null:i)}><span>{x.q}</span><CircleHelp size={18}/></button>
          {opened===i&&<p>{x.a}</p>}
        </div>)}</div>
      </section>

      <section className="landing-final"><div><span className="landing-section-kicker">SEU TEMPO DE VOLTA COMEÇA COM UMA DECISÃO</span>
        <h2>Os honorários voltam todo mês. O trabalho manual não precisa voltar junto.</h2>
        <p>Conheça o ContabFlow com seu próprio acesso e descubra se ele se encaixa na sua rotina.</p>
        <button type="button" className="landing-cta" onClick={focusForm}>Quero conhecer o ContabFlow <ArrowUpRight size={18}/></button></div></section>
    </main>
    <footer className="landing-footer"><div>© ContabFlow · Automação para escritórios contábeis</div>
      <div><button type="button" onClick={onLogin}><Mail size={14}/> Já tenho acesso</button><span>Atendimento: <a href="https://wa.me/5568992097927" target="_blank" rel="noopener noreferrer">WhatsApp <ArrowUpRight size={12}/></a></span></div></footer>
  </div>;
}
