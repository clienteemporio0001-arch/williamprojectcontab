import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  BellRing, CalendarClock, Check, CheckCircle2, ChevronDown, CircleHelp,
  ClipboardList, Clock3, FileText, LayoutDashboard, LogOut, Menu, MessageCircle, Mail,
  MoreHorizontal, Plus, Repeat2, Search, Send, Settings2, ShieldCheck,
  Sparkles, TrendingUp, Users, Wallet, X, AlertTriangle, ArrowUpRight, Building2, Eye, EyeOff
} from 'lucide-react';
import { supabase } from './lib/supabase';
import MasterAdmin from './MasterAdmin';
import MarketingLanding from './MarketingLanding';
import ProspectWelcome from './ProspectWelcome';
import UpgradePlansModal,{type UpgradePlan} from './UpgradePlansModal';
import WhatsAppSupport from './WhatsAppSupport';
import WhatsAppConnectionPanel from './WhatsAppConnectionPanel';
import {DEFAULT_TRIAL,type TrialSettings,isWorkspaceAllowed,remainingTrialDays} from './lib/trial';
import {leadWorkspaceName,normalizeBrazilPhone,signupErrorMessage} from './lib/registration';
import {
  type Client, type Obligation, type ReminderLog, DEFAULT_TEMPLATE,
  demoClients, demoObligations, dateISO, daysUntil, money, formatDate,
  phoneDigits, renderMessage
} from './lib/types';

type Page = 'overview' | 'clients' | 'obligations' | 'automations' | 'settings' | 'whatsapp';
type SignupPlan={code:string;name:string;client_limit:number;monthly_price_brl:number};
type Workspace = {id:string;name:string;plan_code?:string;email_reminders_enabled?:boolean;whatsapp_reminders_enabled?:boolean;message_template:string;tax_id:string;pix_key:string;billing_contact:string;access_status?:'active'|'suspended';billing_status?:'active'|'trialing'|'pending';trial_ends_at?:string|null;trial_started_at?:string|null};
type ClientDraft = Omit<Client, 'id'> & { id?: string };
type ObligationDraft = Omit<Obligation, 'id'> & { id?: string };

const nav: {id:Page; name:string; icon:typeof LayoutDashboard}[] = [
  {id:'overview',name:'Visão geral',icon:LayoutDashboard},
  {id:'clients',name:'Clientes',icon:Users},
  {id:'obligations',name:'Cobranças',icon:FileText},
  {id:'automations',name:'Automações',icon:BellRing},
  {id:'settings',name:'Configurações',icon:Settings2},
  {id:'whatsapp',name:'Integração WhatsApp',icon:MessageCircle}
];

function readDemo<T>(key:string, fallback:T):T {
  try { const raw=localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; }
  catch { return fallback; }
}
const blankClient = ():ClientDraft => ({
  name:'', company:'', phone:'', email:'', email_opt_in:false, email_opt_in_at:null, email_consent_source:null, opt_in:false, opt_in_at:null, consent_source:null, active:true
});
const blankObligation = (clientId=''):ObligationDraft => ({
  client_id:clientId,title:'Honorários contábeis',amount:null,due_date:dateISO(7),
  status:'pending',document_url:null,recurring:true,series_id:null,due_day:null,reminder_offsets:[7,3,1,0]
});
const eventLabel = (days:number) => days < 0 ? Math.abs(days)+' dia(s) em atraso' :
  days === 0 ? 'Vence hoje' : days === 1 ? 'Vence amanhã' : 'Em '+days+' dias';
function statusFor(item:Obligation) {
  if (item.status==='paid') return {text:'Pago',className:'paid'};
  if (item.status==='cancelled') return {text:'Cancelado',className:'muted'};
  const d=daysUntil(item.due_date);
  if(d<0) return {text:'Atrasado',className:'late'};
  if(d<=3) return {text:d===0?'Vence hoje':'Próximo',className:'soon'};
  return {text:'Pendente',className:'neutral'};
}

export default function App() {
  const demo = !supabase;
  const [page,setPage] = useState<Page>('overview');
  const [menuOpen,setMenuOpen] = useState(false);
  const [trialGuideOpen,setTrialGuideOpen] = useState(true);
  const [upgradeOpen,setUpgradeOpen] = useState(false);
  const [search,setSearch] = useState('');
  const [filter,setFilter] = useState('all');
  const [clients,setClients] = useState<Client[]>(() => demo?readDemo('contabflow_clients_v1',demoClients):[]);
  const [obligations,setObligations] = useState<Obligation[]>(() => demo?readDemo('contabflow_obligations_v1',demoObligations):[]);
  const [logs,setLogs] = useState<ReminderLog[]>([]);
  const [messageTemplate,setMessageTemplate] = useState(() => readDemo('contabflow_message_v1',DEFAULT_TEMPLATE));
  const [workspaceName,setWorkspaceName] = useState(() => readDemo('contabflow_name_v1','Meu escritório'));
  const [officeTaxId,setOfficeTaxId] = useState(() => readDemo('contabflow_tax_v2',''));
  const [pixKey,setPixKey] = useState(() => readDemo('contabflow_pix_v2',''));
  const [billingContact,setBillingContact] = useState(() => readDemo('contabflow_contact_v2',''));
  const [emailRemindersEnabled,setEmailRemindersEnabled] = useState(false);
  const [whatsappRemindersEnabled,setWhatsappRemindersEnabled] = useState(false);
  const [whatsappConnected,setWhatsappConnected] = useState(false);
  const [session,setSession] = useState<Session|null>(null);
  const [checkingAuth,setCheckingAuth] = useState(!demo);
  const [workspace,setWorkspace] = useState<Workspace|null>(null);
  const [workspaceChecking,setWorkspaceChecking] = useState(!demo);
  const [passwordSetupOpen,setPasswordSetupOpen] = useState(false);
  const [newPassword,setNewPassword] = useState('');
  const [confirmNewPassword,setConfirmNewPassword] = useState('');
  const [passwordSetupBusy,setPasswordSetupBusy] = useState(false);
  const [passwordSetupError,setPasswordSetupError] = useState('');
  const [publicScreen,setPublicScreen] = useState<'landing'|'auth'>('landing');
  const [trialSettings,setTrialSettings] = useState<TrialSettings>(DEFAULT_TRIAL);
  const [nowTick,setNowTick] = useState(Date.now());
  const [masterStatus,setMasterStatus] = useState<'checking'|'yes'|'no'>(supabase?'checking':'no');
  const [masterView,setMasterView] = useState(true);
  const [loading,setLoading] = useState(false);
  const [authEmail,setAuthEmail] = useState('');
  const [authPassword,setAuthPassword] = useState('');
  const [showPassword,setShowPassword] = useState(false);
  const [signupPlans,setSignupPlans] = useState<SignupPlan[]>([]);
  const [signupPlansError,setSignupPlansError] = useState(false);
  const [authNotice,setAuthNotice] = useState('');
  const [emailLoginBusy,setEmailLoginBusy] = useState(false);
  const [newWorkspace,setNewWorkspace] = useState('');
  const [modal,setModal] = useState<'client'|'obligation'|null>(null);
  const [clientDraft,setClientDraft] = useState<ClientDraft>(blankClient());
  const [obligationDraft,setObligationDraft] = useState<ObligationDraft>(blankObligation());
  const [saving,setSaving] = useState(false);
  const [toast,setToast] = useState('');
  const [error,setError] = useState('');

  useEffect(()=>{
    const timer=window.setInterval(()=>setNowTick(Date.now()),60000);
    return()=>window.clearInterval(timer);
  },[]);
  useEffect(()=>{
    if(!supabase)return;
    let live=true;
    void supabase.from('subscription_plans').select('code,name,client_limit,monthly_price_brl')
      .order('client_limit',{ascending:true}).then(({data,error:e})=>{
        if(!live)return;
        if(e){setSignupPlansError(true);return;}
        setSignupPlansError(false);setSignupPlans((data||[]) as SignupPlan[]);
      });
    return()=>{live=false;};
  },[]);
  // Oferta discreta: no máximo uma abertura automática a cada 72 horas,
  // apenas dentro da visão geral durante um teste vigente.
  useEffect(()=>{
    if(!workspace||workspace.billing_status!=='trialing'||page!=='overview'||!session||demo||upgradeOpen)return;
    let shown=0;
    try{shown=Number(localStorage.getItem('contabflow_plan_offer_'+workspace.id)||0);}catch{ /* armazenamento indisponível */ }
    if(Date.now()-shown<72*60*60*1000)return;
    const timer=window.setTimeout(()=>{
      try{localStorage.setItem('contabflow_plan_offer_'+workspace.id,String(Date.now()));}catch{ /* privado */ }
      setUpgradeOpen(true);
    },42000);
    return()=>window.clearTimeout(timer);
  },[workspace?.id,workspace?.billing_status,page,session?.user.id,demo,upgradeOpen]);
  function openUpgrade(){
    if(workspace){
      try{localStorage.setItem('contabflow_plan_offer_'+workspace.id,String(Date.now()));}catch{ /* privado */ }
    }
    setUpgradeOpen(true);
  }
  async function requestUpgrade(plan:UpgradePlan):Promise<string>{
    if(!supabase||!session||!workspace)throw new Error('Faça login e entre em seu escritório para contratar.');
    const {data,error:e}=await supabase.rpc('request_saas_upgrade',{p_org_id:workspace.id,p_plan_code:plan.code});
    if(e)throw new Error(e.message);
    if(typeof data!=='string')throw new Error('O pedido não foi confirmado no banco. Tente novamente.');
    return data;
  }
  useEffect(()=>{
    if(!supabase)return;
    let live=true;
    void supabase.from('saas_trial_settings')
      .select('trial_enabled,trial_days,trial_max_clients,trial_title,trial_description')
      .eq('id',1).single().then(({data,error:e})=>{
        if(live&&!e&&data)setTrialSettings(data as TrialSettings);
      });
    return()=>{live=false;};
  },[]);
  useEffect(() => {
    if(!demo) return;
    localStorage.setItem('contabflow_clients_v1',JSON.stringify(clients));
    localStorage.setItem('contabflow_obligations_v1',JSON.stringify(obligations));
    localStorage.setItem('contabflow_message_v1',JSON.stringify(messageTemplate));
    localStorage.setItem('contabflow_name_v1',JSON.stringify(workspaceName));
    localStorage.setItem('contabflow_tax_v2',JSON.stringify(officeTaxId));
    localStorage.setItem('contabflow_pix_v2',JSON.stringify(pixKey));
    localStorage.setItem('contabflow_contact_v2',JSON.stringify(billingContact));
  },[clients,obligations,messageTemplate,workspaceName,officeTaxId,pixKey,billingContact,demo]);

  useEffect(() => {
    if(!supabase) return;
    const s=supabase;
    void s.auth.getSession().then(({data}) => {setSession(data.session);setCheckingAuth(false);});
    const {data:{subscription}}=s.auth.onAuthStateChange((_event,next) => setSession(next));
    return () => subscription.unsubscribe();
  },[]);

  useEffect(() => {
    if(!supabase)return;
    if(!session){setMasterStatus('no');setMasterView(true);return;}
    let valid=true;setMasterStatus('checking');
    void supabase.rpc('is_master_admin').then(({data,error:e})=>{
      if(valid)setMasterStatus(!e&&data===true?'yes':'no');
    });
    return()=>{valid=false;};
  },[session?.user.id]);

  // Sincroniza a liberação feita pelo Admin Master sem exigir novo login.
  useEffect(()=>{
    if(!supabase||!session||!workspace?.id||demo)return;
    const client=supabase;
    let live=true;
    const poll=async()=>{
      const {data,error:e}=await client.from('organizations')
        .select('plan_code,billing_status,access_status,trial_started_at,trial_ends_at')
        .eq('id',workspace.id).single();
      if(!live||e||!data)return;
      if(workspace.billing_status!=='active'&&data.billing_status==='active'){
        setToast('Seu plano foi liberado! Os limites de teste foram removidos.');
      }
      setWorkspace(prev=>prev?.id===workspace.id?{...prev,...data}:prev);
    };
    const timer=window.setInterval(()=>{void poll();},30000);
    return()=>{live=false;window.clearInterval(timer);};
  },[session?.user.id,workspace?.id,workspace?.billing_status,demo]);

  // Login por e-mail: provisiona o escritório com o teste vigente no Admin Master.
  // Não libera assinatura paga nem remove os limites operacionais.
  useEffect(()=>{
    if(!supabase)return;
    if(!session){
      setWorkspace(null);setWorkspaceChecking(false);
      setClients([]);setObligations([]);setLogs([]);setPasswordSetupOpen(false);
      return;
    }
    const s=supabase;
    let valid=true;
    setWorkspaceChecking(true);
    void (async()=>{
      try{
        const {data:membership,error:lookupError}=await s.from('organization_members')
          .select('org_id').eq('user_id',session.user.id).limit(1).maybeSingle();
        if(lookupError)throw lookupError;
        let orgId=membership?.org_id;
        if(!orgId){
          const suggested=leadWorkspaceName(session.user.user_metadata);
          if(!suggested){if(valid)setWorkspace(null);return;}
          const {data:created,error:creationError}=await s.rpc('create_workspace',{workspace_name:suggested});
          if(creationError){
            // Se outra aba criou o escritório simultaneamente, retoma a conta já existente.
            const {data:after,error:afterError}=await s.from('organization_members')
              .select('org_id').eq('user_id',session.user.id).limit(1).maybeSingle();
            if(afterError||!after?.org_id)throw new Error('Não foi possível preparar seu escritório: '+creationError.message);
            orgId=after.org_id;
          }else{
            orgId=created as string;
            if(valid){setToast('Seu painel está pronto! Explore seu teste grátis.');setPage('overview');}
          }
        }
        if(!orgId)throw new Error('O escritório ainda não está disponível.');
        const {data:org,error:orgError}=await s.from('organizations').select('*').eq('id',orgId).single();
        if(orgError||!org)throw orgError||new Error('Escritório não encontrado');
        if(valid){
          setWorkspace(org as Workspace);setWorkspaceName(org.name);
          setMessageTemplate(org.message_template);setOfficeTaxId(org.tax_id||'');
          setPixKey(org.pix_key||'');setBillingContact(org.billing_contact||'');
          setEmailRemindersEnabled(Boolean(org.email_reminders_enabled));
          setWhatsappRemindersEnabled(Boolean(org.whatsapp_reminders_enabled));setError('');
        }
      }catch(err){if(valid){setWorkspace(null);setError(err instanceof Error?err.message:String(err));}}
      finally{if(valid)setWorkspaceChecking(false);}
    })();
    return()=>{valid=false;};
  },[session?.user.id]);

  // Convite de definição de senha no primeiro acesso de um lead.
  useEffect(()=>{
    if(!session||!workspace||demo||session.user.user_metadata?.password_configured)return;
    if(!leadWorkspaceName(session.user.user_metadata))return;
    const key='contabflow_password_prompt_'+session.user.id;
    try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'shown');}
    catch{ /* sessão privada */ }
    setPasswordSetupOpen(true);
  },[session?.user.id,session?.user.user_metadata?.password_configured,workspace?.id,demo]);

  useEffect(() => {
    if(!session)return;
    const office=session.user.user_metadata?.office_name;
    if(typeof office==='string'&&office.trim())setNewWorkspace(previous=>previous||office.trim());
  },[session?.user.id]);

  useEffect(() => {
    if(!supabase || !workspace) return;
    void loadCloud(workspace.id);
  },[workspace?.id]);

  async function loadCloud(id:string) {
    if(!supabase) return;
    setLoading(true);
    const [c,o,l]=await Promise.all([
      supabase.from('clients').select('*').eq('org_id',id).order('name'),
      supabase.from('obligations').select('*').eq('org_id',id).order('due_date'),
      supabase.from('reminder_logs').select('*').eq('org_id',id).order('created_at',{ascending:false}).limit(100)
    ]);
    if(c.error || o.error || l.error) setError(String(c.error || o.error || l.error));
    else {setClients(c.data as Client[]);setObligations(o.data as Obligation[]);setLogs(l.data as ReminderLog[]);}
    setLoading(false);
  }
  function notify(msg:string) {setToast(msg);setError('');}
  function showClient(client?:Client) {setClientDraft(client?{...client}:blankClient());setModal('client');setError('');}
  function showObligation(obligation?:Obligation) {
    setObligationDraft(obligation?{...obligation}:blankObligation(clients[0]?.id||''));setModal('obligation');setError('');
  }
  function closeModal(){setModal(null);setError('');}
  async function saveClient(e:FormEvent) {
    e.preventDefault();
    if(!demo&&workspace?.billing_status==='trialing'&&!clientDraft.id&&clients.length>=trialSettings.trial_max_clients){
      setError('Seu teste grátis permite cadastrar até '+trialSettings.trial_max_clients+' clientes. Contrate um plano para cadastrar mais.');return;
    }
    const number=phoneDigits(clientDraft.phone);
    const phone=number.startsWith('55')?number:'55'+number;
    if(!/^55\d{10,11}$/.test(phone)) {setError('Informe um WhatsApp válido com DDD. Exemplo: 68 99999-9999.');return;}
    if(clientDraft.opt_in && !clientDraft.consent_source?.trim()) {setError('Registre a origem da autorização para WhatsApp.');return;}
    const recipientEmail=clientDraft.email?.trim().toLowerCase()||'';
    if(recipientEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)){
      setError('Informe um e-mail válido.');return;
    }
    if(clientDraft.email_opt_in&&(!recipientEmail||!clientDraft.email_consent_source?.trim())){
      setError('Para ativar e-mail, informe o endereço e registre a origem da autorização.');return;
    }
    setSaving(true);setError('');
    const payload:Client = {
      id:clientDraft.id || crypto.randomUUID(),name:clientDraft.name.trim(),
      company:clientDraft.company.trim(),tax_id:clientDraft.tax_id?.trim()||null,phone,
      opt_in:clientDraft.opt_in, active:clientDraft.active,
      opt_in_at:clientDraft.opt_in?clientDraft.opt_in_at || new Date().toISOString():null,
      consent_source:clientDraft.opt_in?clientDraft.consent_source?.trim()||null:null,
      email:recipientEmail||null,
      email_opt_in:clientDraft.email_opt_in===true,
      email_opt_in_at:clientDraft.email_opt_in?(clientDraft.email_opt_in_at||new Date().toISOString()):null,
      email_consent_source:clientDraft.email_opt_in?(clientDraft.email_consent_source?.trim()||null):null
    };
    if(demo) setClients(prev=>clientDraft.id?prev.map(x=>x.id===payload.id?payload:x):[payload,...prev]);
    else if(supabase && workspace) {
      const {error:e}=await supabase.from('clients').upsert({...payload,org_id:workspace.id});
      if(e){setError(e.message);setSaving(false);return;} await loadCloud(workspace.id);
    }
    setSaving(false);closeModal();notify(clientDraft.id?'Cliente atualizado.':'Cliente cadastrado.');setPage('clients');
  }
  async function saveObligation(e:FormEvent) {
    e.preventDefault();
    if(!demo&&workspace?.billing_status==='trialing'&&!obligationDraft.id&&obligations.length>=3){
      setError('Durante o teste grátis, você pode criar até 3 cobranças. Contrate um plano para continuar.');return;
    }
    if(obligationDraft.amount===null||!Number.isFinite(obligationDraft.amount)||obligationDraft.amount<0){setError('Informe o valor dos honorários para gerar a cobrança.');return;}
    if(!obligationDraft.reminder_offsets?.length){setError('Escolha pelo menos um dia de envio.');return;}
    if(!obligationDraft.client_id) {setError('Selecione um cliente.');return;}
    if(obligationDraft.document_url && !/^https:\/\//i.test(obligationDraft.document_url)){
      setError('O link do documento deve começar com https://');return;
    }
    setSaving(true);setError('');
    const base=obligations.find(o=>o.id===obligationDraft.id);
    const payload:Obligation = {
      id:obligationDraft.id||crypto.randomUUID(),
      client_id:obligationDraft.client_id, title:obligationDraft.title.trim(),
      amount:obligationDraft.amount === null ? null : Number(obligationDraft.amount),
      due_date:obligationDraft.due_date, status:obligationDraft.status,
      document_url:obligationDraft.document_url?.trim() || null,
      recurring:obligationDraft.recurring,
      series_id:obligationDraft.recurring ? (base?.series_id || crypto.randomUUID()) : null,
      due_day:obligationDraft.recurring ? Number(obligationDraft.due_date.split('-')[2]) : null,
      reminder_offsets:obligationDraft.reminder_offsets||[7,3,1,0]
    };
    if(demo)setObligations(prev=>obligationDraft.id?prev.map(x=>x.id===payload.id?payload:x):[payload,...prev]);
    else if(supabase && workspace){
      const {error:e}=await supabase.from('obligations').upsert({...payload,org_id:workspace.id});
      if(e){setError(e.message);setSaving(false);return;}await loadCloud(workspace.id);
    }
    setSaving(false);closeModal();notify(obligationDraft.id?'Obrigação atualizada.':'Obrigação criada.');setPage('obligations');
  }
  async function changeStatus(item:Obligation) {
    const newStatus=item.status==='paid'?'pending':'paid';
    if(demo)setObligations(prev=>prev.map(x=>x.id===item.id?{...x,status:newStatus}:x));
    else if(supabase&&workspace){
      const {error:e}=await supabase.from('obligations').update({status:newStatus}).eq('id',item.id).eq('org_id',workspace.id);
      if(e){setError(e.message);return;}await loadCloud(workspace.id);
    }
    notify(newStatus==='paid'?'Marcado como pago.':'Marcado como pendente.');
  }
  async function saveSettings(e:FormEvent) {
    e.preventDefault();
    if(supabase&&workspace) {
      const {error:e}=await supabase.from('organizations').update({name:workspaceName,message_template:messageTemplate,
        tax_id:officeTaxId,pix_key:pixKey,billing_contact:billingContact,
        email_reminders_enabled:workspace.billing_status==='active'&&emailRemindersEnabled,
        whatsapp_reminders_enabled:workspace.billing_status==='active'&&whatsappRemindersEnabled
      }).eq('id',workspace.id);
      if(e){setError(e.message);return;}
      setWorkspace({...workspace,name:workspaceName,message_template:messageTemplate,tax_id:officeTaxId,
        pix_key:pixKey,billing_contact:billingContact,
        email_reminders_enabled:workspace.billing_status==='active'&&emailRemindersEnabled,
        whatsapp_reminders_enabled:workspace.billing_status==='active'&&whatsappRemindersEnabled});
    }
    notify('Preferências salvas.');
  }
  async function submitEmailLead(lead:{name:string;email:string;phone:string}):Promise<string>{
    if(!supabase)throw Error('O cadastro está temporariamente indisponível.');
    const phone=normalizeBrazilPhone(lead.phone);
    if(lead.name.trim().length<3)throw Error('Informe seu nome completo.');
    if(!phone)throw Error('Informe um WhatsApp com DDD válido.');
    const email=lead.email.trim().toLowerCase();
    const {error:e}=await supabase.auth.signInWithOtp({
      email,options:{
        shouldCreateUser:true,
        data:{full_name:lead.name.trim(),office_phone:phone},
        emailRedirectTo:new URL(import.meta.env.BASE_URL,window.location.origin).toString()
      }
    });
    if(e)throw Error(signupErrorMessage(e.message));
    return 'Link de acesso enviado para '+email+'. Confira a caixa de entrada ou Spam.';
  }
  async function saveFirstPassword(e:FormEvent){
    e.preventDefault();
    if(!supabase||!session)return;
    setPasswordSetupError('');
    if(newPassword.length<8){setPasswordSetupError('A senha precisa ter pelo menos 8 caracteres.');return;}
    if(newPassword!==confirmNewPassword){setPasswordSetupError('As senhas não coincidem.');return;}
    setPasswordSetupBusy(true);
    try{
      const {data,error:e}=await supabase.auth.updateUser({password:newPassword,data:{password_configured:true}});
      if(e)throw new Error(signupErrorMessage(e.message));
      if(data.user)setSession(previous=>previous?{...previous,user:data.user}:previous);
      setNewPassword('');setConfirmNewPassword('');setPasswordSetupOpen(false);
      setToast('Senha criada! Você já pode entrar com e-mail e senha pelo celular.');
    }catch(err){setPasswordSetupError(err instanceof Error?err.message:String(err));}
    finally{setPasswordSetupBusy(false);}
  }
  async function submitAuth(e:FormEvent){
    e.preventDefault();
    if(!supabase)return;
    setError('');setAuthNotice('');setSaving(true);
    try{
      const {error:e}=await supabase.auth.signInWithPassword({email:authEmail.trim().toLowerCase(),password:authPassword});
      if(e)setError(signupErrorMessage(e.message));
    }catch(e){setError('Não foi possível entrar: '+String(e));}
    finally{setSaving(false);}
  }
  async function sendEmailLogin(){
    if(!supabase)return;
    setError('');setAuthNotice('');setEmailLoginBusy(true);
    try{
      if(!authEmail.trim())throw Error('Informe seu e-mail para receber o link.');
      const email=authEmail.trim().toLowerCase();
      const {error:e}=await supabase.auth.signInWithOtp({
        email,options:{shouldCreateUser:false,emailRedirectTo:new URL(import.meta.env.BASE_URL,window.location.origin).toString()}
      });
      if(e)throw Error(signupErrorMessage(e.message));
      setAuthNotice('Link de acesso enviado para '+email+'. Confira o e-mail e o Spam.');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setEmailLoginBusy(false);}
  }
  async function activateWorkspace(planCode:string,officeName:string){
    if(!supabase||!session)return;
    if(!signupPlans.some(p=>p.code===planCode)){setError('Selecione um plano válido.');return;}
    setSaving(true);setError('');
    try{
      const name=officeName.trim();
      if(name.length<2||name.length>100)throw Error('Informe o nome do escritório.');
      const {error:profileError}=await supabase.auth.updateUser({data:{selected_plan_code:planCode,office_name:name}});
      if(profileError)throw Error('Não foi possível registrar o plano: '+profileError.message);
      const {data:newId,error:workspaceError}=await supabase.rpc('create_workspace',{workspace_name:name});
      if(workspaceError)throw Error(workspaceError.message);
      const phone=session.user.user_metadata?.office_phone;
      if(newId&&typeof phone==='string'&&phone){
        const {error:contactError}=await supabase.from('organizations').update({billing_contact:phone}).eq('id',newId);
        if(contactError)console.warn('Contato opcional não atualizado',contactError.code);
      }
      const {data:org,error:fetchError}=await supabase.from('organizations')
        .select('*')
        .eq('id',newId).single();
      if(fetchError||!org)throw Error('Escritório criado. Atualize a página: '+(fetchError?.message||'não encontrado'));
      setWorkspace(org as Workspace);setWorkspaceName(org.name);setMessageTemplate(org.message_template);
      setOfficeTaxId(org.tax_id||'');setPixKey(org.pix_key||'');setBillingContact(org.billing_contact||'');
      setEmailRemindersEnabled(Boolean(org.email_reminders_enabled));
      setWhatsappRemindersEnabled(Boolean(org.whatsapp_reminders_enabled));
      setPage('overview');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setSaving(false);}
  }
  async function downloadCharge(item:Obligation){
    if(item.status!=='pending'){setError('O documento de cobrança só pode ser gerado para uma obrigação pendente.');return;}
    if(item.amount===null){setError('Cadastre o valor antes de gerar o PDF.');return;}
    const client=clients.find(c=>c.id===item.client_id);
    if(!client){setError('Cliente não encontrado.');return;}
    setLoading(true);setError('');
    try{
      let pdf:Blob;
      if(demo){
        const {makeDemoChargePdf}=await import('./lib/demo-pdf');
        const data=await makeDemoChargePdf({
          officeName:workspaceName,officeTaxId,pixKey,billingContact,
          clientName:client.name,company:client.company,clientTaxId:client.tax_id||'',
          service:item.title,amount:item.amount,dueDate:item.due_date
        });
        pdf=new Blob([new Uint8Array(data)],{type:'application/pdf'});
      }else{
        if(!supabase)throw new Error('Supabase não conectado');
        const {data,error:e}=await supabase.functions.invoke('generate-charge',{body:{obligation_id:item.id}});
        if(e)throw e;
        pdf=data instanceof Blob?data:new Blob([data],{type:'application/pdf'});
      }
      const link=URL.createObjectURL(pdf);
      const a=document.createElement('a');
      a.href=link;a.download='cobranca-'+item.due_date+'.pdf';
      document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(link),10000);
      notify('PDF de cobrança gerado. Não é comprovante de pagamento.');
    }catch(err){setError('Não foi possível gerar a cobrança: '+String(err));}
    finally{setLoading(false);}
  }
  function manualWhatsApp(item:Obligation){
    const client=clients.find(c=>c.id===item.client_id);
    if(!client) {setError('Cliente não encontrado.');return;}
    if(!client.opt_in){setError('O cliente precisa autorizar o recebimento de mensagens antes do envio.');return;}
    if(demo && client.id.startsWith('demo-')){setError('Contato fictício: cadastre um cliente real e autorizado para abrir o WhatsApp.');return;}
    const text=renderMessage(messageTemplate,client,item);
    window.open('https://wa.me/'+phoneDigits(client.phone)+'?text='+encodeURIComponent(text),'_blank','noopener,noreferrer');
  }
  const pending=obligations.filter(o=>o.status==='pending');
  const upcoming=pending.filter(o=>daysUntil(o.due_date)>=0&&daysUntil(o.due_date)<=7);
  const overdue=pending.filter(o=>daysUntil(o.due_date)<0);
  const paid=obligations.filter(o=>o.status==='paid');
  const clientById=(id:string)=>clients.find(c=>c.id===id);
  const ordered=useMemo(()=>[...obligations].sort((a,b)=>a.due_date.localeCompare(b.due_date)),[obligations]);
  const visibleObligations=ordered.filter(o=>{
    const client=clients.find(c=>c.id===o.client_id);
    const found=[o.title,client?.name,client?.company].join(' ').toLowerCase().includes(search.toLowerCase());
    return found && (filter==='all' || (filter==='late'?o.status==='pending'&&daysUntil(o.due_date)<0:
      filter==='soon'?o.status==='pending'&&daysUntil(o.due_date)>=0&&daysUntil(o.due_date)<=7:o.status===filter));
  });
  const visibleClients=clients.filter(c=>[c.name,c.company,c.phone].join(' ').toLowerCase().includes(search.toLowerCase()));
  const nextFive=ordered.filter(o=>o.status==='pending').slice(0,5);
  const orgLabel=workspace?.name || workspaceName;
  const workspaceAllowed=demo||!workspace||(!workspace.billing_status&&workspace.access_status!=='suspended')||
    isWorkspaceAllowed(workspace.access_status,workspace.billing_status,workspace.trial_ends_at||null,nowTick);
  const trialDaysLeft=workspace?.billing_status==='trialing'?remainingTrialDays(workspace.trial_ends_at||null,nowTick):0;
  const isTrial=!demo&&workspace?.billing_status==='trialing';
  const trialClientLimit=trialSettings.trial_max_clients||3;
  const canAddTrialClient=!isTrial||clients.length<trialClientLimit;
  const canAddTrialCharge=!isTrial||obligations.length<3;
  if(checkingAuth)return <div className="splash"><div className="logo-mark"><CalendarClock size={30}/></div><p>Preparando seu painel…</p></div>;
  if(!demo&&!session&&publicScreen==='landing')return <>
    <MarketingLanding trial={trialSettings} onLogin={()=>{setPublicScreen('auth');setError('');}}
      onLead={submitEmailLead}/>
    <WhatsAppSupport/>
  </>;
  if(!demo&&!session)return <><div className="auth-wrap"><div className="auth-card">
    <div className="brand"><span className="logo-mark"><CalendarClock size={24}/></span>
      <span>contab<span className="brand-accent">flow</span><small>GESTÃO CONTÁBIL INTELIGENTE</small></span></div>
    <div className="auth-kicker">SEU ESCRITÓRIO MAIS PRODUTIVO</div>
    <h1>Entre no seu painel</h1><p className="subtle">Use sua senha atual ou receba um link seguro por e-mail.</p>
    <form onSubmit={submitAuth} className="stack gap-lg">
      <label>E-mail *<input type="email" autoComplete="email" required value={authEmail}
        onChange={e=>setAuthEmail(e.target.value)} placeholder="voce@escritorio.com.br"/></label>
      <label>Senha <span className="password-field">
        <input type={showPassword?'text':'password'} autoComplete="current-password" required minLength={6}
          value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="Sua senha"/>
        <button type="button" className="password-toggle" onClick={()=>setShowPassword(v=>!v)}
          aria-label={showPassword?'Ocultar senha':'Mostrar senha'}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button>
      </span></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {authNotice&&<div className="auth-notice" role="status"><CheckCircle2 size={18}/><span>{authNotice}</span></div>}
      <button disabled={saving} className="btn primary block">{saving?'Entrando…':'Entrar na plataforma'}</button>
      <button type="button" className="btn soft block" onClick={()=>void sendEmailLogin()} disabled={emailLoginBusy}>
        {emailLoginBusy?'Enviando link…':'Entrar com link por e-mail'}</button>
    </form>
    <p className="auth-toggle">Primeiro acesso? <button type="button" className="link-button"
      onClick={()=>{setPublicScreen('landing');setError('');}}>Criar meu acesso</button></p>
    <button type="button" className="public-back" onClick={()=>setPublicScreen('landing')}>← Voltar à página inicial</button>
    <p style={{textAlign:'center',fontSize:13,marginTop:15}}><a href={`${import.meta.env.BASE_URL}privacidade.html`} target="_blank" rel="noopener noreferrer">Política de Privacidade</a></p>
  </div></div><WhatsAppSupport/></>;
  if(!demo&&session&&masterStatus==='checking')return <div className="splash"><div className="logo-mark"><ShieldCheck size={30}/></div><p>Verificando permissões…</p></div>;
  if(!demo&&session&&masterStatus==='yes'&&masterView)return <MasterAdmin canOpenOffice={!!workspace} onOpenOffice={()=>setMasterView(false)}/>;
  if(!demo&&session&&workspaceChecking)return <div className="splash"><div className="logo-mark"><CalendarClock size={30}/></div><p>Preparando sua dashboard…</p></div>;
  if(!demo&&!workspace)return <>
    <ProspectWelcome
      name={typeof session?.user.user_metadata?.full_name==='string'?session.user.user_metadata.full_name:'contador'}
      plans={signupPlans} plansError={signupPlansError} trial={trialSettings}
      initialOffice={newWorkspace} busy={saving} error={error}
      onActivate={activateWorkspace}
      onLogout={()=>{if(supabase)void supabase.auth.signOut();}}/>
    <WhatsAppSupport/>
  </>;

  if(!demo&&workspace&&!workspaceAllowed&&masterStatus!=='yes')return <>
    <div className="access-locked"><div className="access-locked-card">
      <ShieldCheck size={37}/>
      <h1>{workspace.access_status==='suspended'?'Escritório temporariamente suspenso':
        workspace.billing_status==='pending'?'Aguardando liberação do seu escritório':'Seu teste grátis terminou'}</h1>
      <p>Os dados do seu escritório continuam armazenados. Para retomar o acesso e as cobranças, entre em contato e solicite a ativação do plano.</p>
      <button type="button" onClick={openUpgrade} className="btn primary">Conhecer planos e contratar</button>
      <button className="btn soft" onClick={()=>{if(supabase)void supabase.auth.signOut();}}>Sair</button>
    </div></div>
    {upgradeOpen&&<UpgradePlansModal plans={signupPlans} currentPlan={workspace.plan_code||''}
      officeName={workspace.name} isTrial={isTrial} onClose={()=>setUpgradeOpen(false)} onRequest={requestUpgrade}/>}
    <WhatsAppSupport/>
  </>;
  const title={overview:'Visão geral',clients:'Clientes',obligations:'Cobranças',automations:'Automações',settings:'Configurações',whatsapp:'Integração WhatsApp'}[page];
  return <div className="app-shell">
    <aside className={'sidebar '+(menuOpen?'mobile-open':'')}>
      <div className="brand"><span className="logo-mark"><CalendarClock size={22}/></span><span>contab<span className="brand-accent">flow</span><small>AUTOMAÇÃO CONTÁBIL</small></span></div>
      <div className="nav-label">PLATAFORMA</div>
      <nav className="nav-list">{nav.map(n=><button key={n.id} className={'nav-item '+(n.id==='whatsapp'?'nav-item-child ':'')+(page===n.id?'active':'')} onClick={()=>{setPage(n.id);setSearch('');setFilter('all');setMenuOpen(false);}}>
        <n.icon size={19} strokeWidth={1.9}/>{n.name}{page===n.id&&<span className="nav-active-dot"/>}</button>)}</nav>
      <div className="sidebar-footer">{masterStatus==='yes'&&<button className="btn soft block" style={{marginBottom:12}} onClick={()=>setMasterView(true)}><ShieldCheck size={16}/>Abrir Admin Master</button>}<div className="sidebar-note"><Sparkles size={16}/><strong>Mais tempo para seu escritório</strong><span>Automatize tarefas repetitivas e foque em seus clientes.</span></div>
        <div className="sidebar-profile"><span className="avatar">{orgLabel.slice(0,2).toUpperCase()}</span><span className="profile-text"><strong>{orgLabel}</strong><small>{demo?'Ambiente demonstrativo':'Espaço do escritório'}</small></span>
          {supabase&&<button className="icon-button" title="Sair" onClick={()=>{if(supabase)void supabase.auth.signOut();}}><LogOut size={18}/></button>}
        </div></div>
    </aside>
    {menuOpen&&<button className="sidebar-backdrop" aria-label="Fechar navegação" onClick={()=>setMenuOpen(false)}/>}
    <main className={'main'+(page==='overview'?' overview-main':'')}>
      <header className="topbar"><button className="icon-button menu-toggle" title="Abrir menu" onClick={()=>setMenuOpen(true)}><Menu size={22}/></button>
        <div className="crumb"><span>Área de trabalho</span><span className="crumb-arrow">/</span><strong>{title}</strong></div>
        <div className="top-right"><span className="today-pill"><Clock3 size={15}/>{new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date())}</span><span className="mini-avatar">{orgLabel[0]?.toUpperCase()||'C'}</span></div>
      </header>
      <div className={'main-content'+(page==='overview'?' overview-dense':'')}>
        {!demo&&session&&!session.user.user_metadata?.password_configured&&
          <div className="password-reminder" role="note">
            <LockKeyhole size={19}/><span><strong>Proteja seu acesso</strong><small>Crie uma senha para entrar pelo celular sem depender de novos links.</small></span>
            <button type="button" onClick={()=>{setPasswordSetupError('');setPasswordSetupOpen(true);}}>Definir senha</button>
          </div>}
        {isTrial&&trialDaysLeft>0&&<div className="trial-banner" role="status">
          <Clock3 size={20}/><span><strong>Sua conta está no período de teste gratuito.</strong>
          <span className="trial-subline">Faltam {trialDaysLeft} {trialDaysLeft===1?'dia':'dias'} para o término. Você pode cadastrar até {trialClientLimit} clientes e criar até 3 cobranças, com PDFs personalizados. Os disparos automáticos via WhatsApp não estão disponíveis neste período.</span></span>
          <button type="button" className="trial-upgrade-button" onClick={openUpgrade}>Desbloquear plano</button>
        </div>}
        {demo&&<div className="demo-banner"><div><CircleHelp size={18}/><span><strong>Modo demonstração.</strong> Os exemplos são fictícios; alterações ficam apenas neste navegador. Para usar em produção, conecte o Supabase.</span></div><span className="demo-tag">DEMO</span></div>}
        {(toast||error)&&<div className={'notice '+(error?'danger':'ok')}><span>{error||toast}</span><button onClick={()=>{setToast('');setError('');}} aria-label="Dispensar"><X size={16}/></button></div>}
        {loading&&<div className="loadingbar"/>}
        <div className="page-header"><div><p className="eyebrow">SUA OPERAÇÃO, SOB CONTROLE</p><h1>{title}</h1>
          <p className="page-intro">{page==='overview'?'Acompanhe seus clientes e vencimentos sem perder nenhum prazo.':
            page==='clients'?'Organize sua carteira de clientes e suas autorizações de contato.':
            page==='obligations'?'Gere PDFs individuais de cobrança com valor, vencimento e dados do cliente.':
            page==='automations'?'Configure seu fluxo de lembretes e acompanhe as notificações.':
            page==='whatsapp'?'Conecte o número do seu escritório à API oficial da Meta.':
            'Gerencie seus dados e preferências de cobrança.'}</p></div>
          {page==='clients'&&<button className="btn primary" onClick={()=>showClient()} disabled={!canAddTrialClient} title={!canAddTrialClient?'Limite do período de teste atingido':''}><Plus size={17}/>Novo cliente</button>}
          {(page==='overview'||page==='obligations')&&<button className="btn primary" onClick={()=>showObligation()} disabled={!clients.length||!canAddTrialCharge} title={!canAddTrialCharge?'Limite de 3 cobranças do teste atingido':''}><Plus size={17}/>Nova cobrança</button>}
        </div>

        {page==='overview'&&isTrial&&<section className="trial-guide" aria-label="Progresso da avaliação">
          <div className="trial-guide-heading">
            <div className="trial-guide-title">
              <span className="trial-guide-kicker">APROVEITE SEU TESTE</span>
              <h2>Comece em 3 passos</h2>
            </div>
            <div className="trial-guide-actions">
              <span className="trial-guide-countdown"><Clock3 size={13}/> {trialDaysLeft} {trialDaysLeft===1?'dia restante':'dias restantes'}</span>
              <button type="button" className="trial-guide-toggle" aria-expanded={trialGuideOpen} aria-controls="trial-guide-content"
                onClick={()=>setTrialGuideOpen(v=>!v)}>
                {trialGuideOpen?'Recolher':'Mostrar passos'} <ChevronDown size={15} className={trialGuideOpen?'turn':''}/>
              </button>
            </div>
          </div>
          {trialGuideOpen&&<div id="trial-guide-content">
            <div className="trial-guide-grid">
              <div className="trial-step">
                <div className="trial-step-heading"><span className="trial-step-icon"><Users size={16}/></span><strong>1. Cadastre clientes</strong><b>{clients.length}/{trialClientLimit}</b></div>
                <p>Monte sua carteira de contatos</p>
                <progress aria-label="Clientes cadastrados no teste" value={Math.min(clients.length,trialClientLimit)} max={trialClientLimit}/>
                <button type="button" onClick={()=>setPage('clients')}>Ir para clientes <ArrowUpRight size={13}/></button>
              </div>
              <div className="trial-step">
                <div className="trial-step-heading"><span className="trial-step-icon"><FileText size={16}/></span><strong>2. Crie cobranças</strong><b>{obligations.length}/3</b></div>
                <p>Experimente os PDFs personalizados</p>
                <progress aria-label="Cobranças criadas no teste" value={Math.min(obligations.length,3)} max={3}/>
                <button type="button" onClick={()=>setPage('obligations')}>Ir para cobranças <ArrowUpRight size={13}/></button>
              </div>
              <div className="trial-step">
                <div className="trial-step-heading"><span className="trial-step-icon"><Sparkles size={16}/></span><strong>3. Explore o painel</strong></div>
                <p>Conheça os vencimentos e os recursos disponíveis</p>
                <button type="button" onClick={openUpgrade}>Ver planos <ArrowUpRight size={13}/></button>
              </div>
            </div>
          </div>}
        </section>}
        {page==='overview'&&<>
          <div className="metric-grid">
            <div className="metric-card"><span className="metric-head">Clientes ativos <Users size={19}/></span><strong>{clients.filter(c=>c.active).length}</strong><span className="metric-foot"><span className="small-green"><TrendingUp size={14}/></span>Na sua carteira</span></div>
            <div className="metric-card"><span className="metric-head">Próximos 7 dias <CalendarClock size={19}/></span><strong>{upcoming.length}</strong><span className="metric-foot">Vencimentos a acompanhar</span></div>
            <div className="metric-card"><span className="metric-head">Em atraso <AlertTriangle size={19}/></span><strong className="text-danger">{overdue.length}</strong><span className="metric-foot">Precisam de atenção</span></div>
            <div className="metric-card"><span className="metric-head">Pagamentos registrados <CheckCircle2 size={19}/></span><strong>{paid.length}</strong><span className="metric-foot">Marcados como pagos</span></div>
          </div>
          <div className="overview-layout">
            <section className="panel"><div className="panel-heading"><div><h2>Próximos vencimentos</h2><p>Acompanhe o que precisa de atenção</p></div><button className="subtle-action" onClick={()=>setPage('obligations')}>Ver todos <ArrowUpRight size={16}/></button></div>
              <div className="schedule-list">{nextFive.length?nextFive.map(item=><div className="schedule-row" key={item.id}><div className="doc-icon"><FileText size={19}/></div>
                <div className="schedule-content"><strong>{item.title}</strong><span>{clientById(item.client_id)?.company||clientById(item.client_id)?.name||'Cliente removido'}</span></div>
                <div className="schedule-date"><strong>{formatDate(item.due_date)}</strong><span className={daysUntil(item.due_date)<0?'text-danger':''}>{eventLabel(daysUntil(item.due_date))}</span></div>
                <span className={'status '+statusFor(item).className}>{statusFor(item).text}</span></div>):<div className="empty"><CheckCircle2/><strong>Nenhum vencimento pendente</strong><p>Cadastre uma obrigação para começar.</p></div>}</div></section>
            <section className="panel quick-panel"><div className="panel-heading"><div><h2>Ações rápidas</h2><p>Ganhe tempo no dia a dia</p></div><MoreHorizontal size={19}/></div>
              <button className="quick-action" onClick={()=>showClient()}><span className="quick-icon teal"><Users size={19}/></span><span><strong>Cadastrar cliente</strong><small>Adicione um contato à carteira</small></span><ArrowUpRight size={17}/></button>
              <button className="quick-action" disabled={!clients.length} onClick={()=>showObligation()}><span className="quick-icon blue"><FileText size={19}/></span><span><strong>Criar obrigação</strong><small>Registre o próximo vencimento</small></span><ArrowUpRight size={17}/></button>
              <button className="quick-action" onClick={()=>setPage('automations')}><span className="quick-icon purple"><BellRing size={19}/></span><span><strong>Lembretes automáticos</strong><small>Entenda e configure o fluxo</small></span><ArrowUpRight size={17}/></button>
              <div className="highlight-panel"><span className="highlight-title"><ShieldCheck size={16}/> Comunicação responsável</span><p>Somente clientes que autorizaram o contato recebem lembretes pela API oficial.</p></div>
            </section>
          </div>
          <section className="bottom-stats"><div><span className="stat-icon"><Wallet size={20}/></span><div><strong>{money(upcoming.reduce((sum,o)=>sum+(o.amount||0),0))}</strong><span>Total informado com vencimento nos próximos 7 dias</span></div></div><button className="subtle-action" onClick={()=>setPage('obligations')}>Gerenciar obrigações <ArrowUpRight size={15}/></button></section>
        </>}

        {page==='clients'&&<section className="panel table-panel">
          <div className="table-toolbar"><div className="searchbox"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente, empresa ou WhatsApp…"/></div><span className="row-counter">{visibleClients.length} cliente(s)</span></div>
          <div className="table-wrap"><table><thead><tr><th>CLIENTE / EMPRESA</th><th>WHATSAPP</th><th>AUTORIZAÇÃO</th><th>SITUAÇÃO</th><th>AÇÕES</th></tr></thead><tbody>
          {visibleClients.map(c=><tr key={c.id}><td><div className="person"><span className="person-avatar">{c.name[0]?.toUpperCase()}</span><div><strong>{c.name}</strong><span>{c.company||'Pessoa física'}</span></div></div></td><td>{c.phone}</td>
            <td><span className={'status '+(c.opt_in?'paid':'neutral')}>{c.opt_in?'Autorizado':'Sem autorização'}</span></td><td><span className={'status '+(c.active?'neutral':'muted')}>{c.active?'Ativo':'Inativo'}</span></td>
            <td><div className="actions"><button className="btn tiny soft" onClick={()=>showClient(c)}>Editar</button><button className="icon-button" title="Criar obrigação" onClick={()=>{setObligationDraft(blankObligation(c.id));setModal('obligation');}}><Plus size={17}/></button></div></td></tr>)}
          {!visibleClients.length&&<tr><td colSpan={5}><div className="empty"><Users/><strong>Nenhum cliente encontrado</strong><p>Cadastre ou ajuste sua pesquisa.</p></div></td></tr>}</tbody></table></div></section>}

        {page==='obligations'&&<section className="panel table-panel"><div className="table-toolbar">
          <div className="searchbox"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar obrigação ou cliente…"/></div>
          <div className="select-wrap"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos os status</option><option value="soon">Próximos 7 dias</option><option value="late">Atrasados</option><option value="pending">Pendentes</option><option value="paid">Pagos</option><option value="cancelled">Cancelados</option></select><ChevronDown size={15}/></div>
        </div><div className="table-wrap"><table><thead><tr><th>DOCUMENTO / CLIENTE</th><th>VENCIMENTO</th><th>VALOR</th><th>STATUS</th><th>AÇÕES</th></tr></thead><tbody>
          {visibleObligations.map(o=><tr key={o.id}><td><div className="person"><span className="doc-icon"><FileText size={18}/></span><div><strong>{o.title} {o.recurring&&<Repeat2 size={13} className="inline-icon"/>}</strong><span>{clientById(o.client_id)?.company||clientById(o.client_id)?.name||'—'}</span></div></div></td>
            <td><div className="date-col"><strong>{formatDate(o.due_date)}</strong><small>{eventLabel(daysUntil(o.due_date))}</small></div></td><td className="money-cell">{money(o.amount)}</td><td><span className={'status '+statusFor(o).className}>{statusFor(o).text}</span></td>
            <td><div className="actions"><button className="icon-button" title="Abrir WhatsApp manualmente" onClick={()=>manualWhatsApp(o)}><MessageCircle size={17}/></button><button className="btn tiny soft" title="Gerar PDF individual" disabled={o.status!=='pending'||o.amount===null} onClick={()=>void downloadCharge(o)}><FileText size={15}/> PDF</button><button className="btn tiny soft" onClick={()=>showObligation(o)}>Editar</button><button className="icon-button" title={o.status==='paid'?'Reabrir':'Marcar como pago'} onClick={()=>void changeStatus(o)}>{o.status==='paid'?<Clock3 size={17}/>:<Check size={17}/>}</button></div></td></tr>)}
          {!visibleObligations.length&&<tr><td colSpan={5}><div className="empty"><ClipboardList/><strong>Nenhuma obrigação encontrada</strong><p>Adicione uma obrigação para começar.</p></div></td></tr>}</tbody></table></div></section>}

        {page==='automations'&&<div className="automation-layout"><section className="panel"><div className="panel-heading"><div><h2>Régua de cobranças</h2><p>Os dias são configurados individualmente em cada cobrança</p></div><span className="status neutral">Padrão inicial</span></div>
          <div className="flow-line">{[{n:'7',t:'7 dias antes',d:'Exemplo de aviso'},{n:'3',t:'3 dias antes',d:'Reforço do prazo'},{n:'1',t:'1 dia antes',d:'Último lembrete'},{n:'0',t:'No vencimento',d:'Aviso no dia'},{n:'+',t:'1 dia depois',d:'Em atraso'}].map((v,i)=><div className="flow-step" key={i}><span className="flow-circle">{v.n}</span><div><strong>{v.t}</strong><small>{v.d}</small></div></div>)}</div>
          <div className="info-note"><ShieldCheck size={19}/><p><strong>Automação no servidor:</strong> cada cobrança segue seus dias programados, com e-mail e WhatsApp separados. Exige autorização por canal, credenciais e agendamento. Durante o teste não há envios automáticos.</p></div>
        </section><section className="panel"><div className="panel-heading"><div><h2>Histórico de envios</h2><p>Histórico separado por e-mail e WhatsApp (aceitação da API, não leitura ou entrega)</p></div><Send size={18}/></div>
          {logs.length?<div className="log-list">{logs.slice(0,15).map(log=><div className="log-row" key={log.id}><div><strong>{log.channel==='email'?'E-mail':'WhatsApp'} · {obligations.find(o=>o.id===log.obligation_id)?.title||'Obrigação'}</strong><span>{new Date(log.created_at).toLocaleString('pt-BR')}</span></div><span className={'status '+(log.status==='sent'?'paid':log.status==='failed'?'late':'neutral')}>{log.status==='sent'?'Aceito pela API':log.status==='failed'?'Falhou':'Processando'}</span></div>)}</div>:<div className="empty"><BellRing/><strong>Nenhum envio registrado</strong><p>O histórico aparecerá após os disparos reais da API.</p></div>}
        </section></div>}

        {page==='settings'&&<div className="settings-layout settings-layout--compact">
          <section className="panel settings-card">
            <div className="panel-heading"><div><h2><Building2 size={17}/> Identidade do escritório</h2><p>Dados exibidos nos seus documentos de cobrança.</p></div></div>
            <form onSubmit={saveSettings} className="stack gap-lg">
              <div className="settings-fields-grid">
                <label>Nome do escritório<input required value={workspaceName} onChange={e=>setWorkspaceName(e.target.value)} maxLength={100}/></label>
                <label>CPF/CNPJ do favorecido<input value={officeTaxId} onChange={e=>setOfficeTaxId(e.target.value)} placeholder="Identificação do favorecido no PDF"/></label>
                <label>Chave Pix para pagamento<input value={pixKey} onChange={e=>setPixKey(e.target.value)} placeholder="CPF, CNPJ, e-mail ou chave aleatória"/></label>
                <label>Contato para dúvidas<input value={billingContact} onChange={e=>setBillingContact(e.target.value)} placeholder="WhatsApp ou e-mail do escritório"/></label>
              </div>
              <button className="btn primary"><Check size={16}/> Salvar dados do escritório</button>
            </form>
          </section>
          <section className="panel settings-card">
            <div className="panel-heading"><div><h2><BellRing size={17}/> Preferências de cobrança</h2><p>Escolha canais e personalize o texto de apoio.</p></div></div>
            <form onSubmit={saveSettings} className="stack gap-lg">
              <div className="settings-toggles">
                <label className="check-card"><input type="checkbox" disabled={workspace?.billing_status!=='active'}
                  checked={emailRemindersEnabled} onChange={e=>setEmailRemindersEnabled(e.target.checked)}/>
                  <span><strong><Mail size={15}/> Lembretes por e-mail</strong><small>Exige Resend configurado e autorização do cliente.</small></span>
                </label>
                <label className="check-card"><input type="checkbox" disabled={workspace?.billing_status!=='active'||!whatsappConnected}
                  checked={whatsappRemindersEnabled} onChange={e=>setWhatsappRemindersEnabled(e.target.checked)}/>
                  <span><strong><MessageCircle size={15}/> Lembretes por WhatsApp</strong><small>Requer número conectado, plano ativo e modelo aprovado.</small></span>
                </label>
              </div>
              <button className="settings-connection-shortcut" type="button" onClick={()=>setPage('whatsapp')}>
                <span className="shortcut-icon"><MessageCircle size={18}/></span>
                <span><strong>Integração WhatsApp</strong><small>Conectar número ou consultar o status</small></span>
                <ArrowUpRight size={17}/>
              </button>
              <div className="field"><label htmlFor="template">Mensagem para envio manual</label>
                <textarea id="template" rows={3} value={messageTemplate} onChange={e=>setMessageTemplate(e.target.value)}/>
                <p className="field-hint">O automático usa um modelo aprovado pela Meta. Variáveis: <code>{'{nome}'}</code>, <code>{'{documento}'}</code>, <code>{'{vencimento}'}</code>, <code>{'{valor}'}</code> e <code>{'{link}'}</code>.</p>
              </div>
              <button className="btn primary"><Check size={16}/> Salvar preferências</button>
            </form>
          </section>
        </div>}
        {page==='whatsapp'&&<div className="whatsapp-page-layout">
          <section className="panel settings-card whatsapp-main-card">
            <div className="panel-heading"><div><h2><MessageCircle size={18}/> Conectar WhatsApp Business</h2><p>Autorize o número que enviará os lembretes deste escritório.</p></div>
              <button type="button" className="btn soft tiny" onClick={()=>setPage('settings')}><Settings2 size={15}/> Configurações</button>
            </div>
            <div className="whatsapp-connect-body">
              <WhatsAppConnectionPanel orgId={workspace?.id||null} onStatusChange={setWhatsappConnected}/>
            </div>
          </section>
          <aside className="panel settings-card whatsapp-guide-card">
            <div className="panel-heading"><div><h2><ShieldCheck size={17}/> Como funciona</h2><p>Conexão exclusiva do seu escritório.</p></div></div>
            <div className="whatsapp-mini-steps">
              <div><span>01</span><p><strong>Autorize na Meta</strong><small>Conecte uma conta empresarial e selecione seu número.</small></p></div>
              <div><span>02</span><p><strong>Configure as cobranças</strong><small>Defina valores, vencimentos e autorizações dos destinatários.</small></p></div>
              <div><span>03</span><p><strong>Envio no servidor</strong><small>Com plano ativo e modelo aprovado, a automação executa sem navegador aberto.</small></p></div>
            </div>
            <p className="field-hint whatsapp-help-note">Durante o teste grátis, os disparos automáticos permanecem bloqueados. A integração exige credenciais e permissões liberadas pela Meta.</p>
            <a className="external-link" href="https://business.whatsapp.com/" target="_blank" rel="noreferrer">Documentação oficial <ArrowUpRight size={15}/></a>
          </aside>
        </div>}
      </div>
    </main>

    {upgradeOpen&&workspace&&<UpgradePlansModal plans={signupPlans}
      currentPlan={workspace.plan_code||''}
      officeName={workspace.name} isTrial={isTrial} onClose={()=>setUpgradeOpen(false)}
      onRequest={requestUpgrade}/>}
    {!demo&&session&&passwordSetupOpen&&<div className="modal-overlay">
      <div className="modal first-password-modal" role="dialog" aria-modal="true" aria-labelledby="password-setup-title">
        <div className="modal-head"><div><p className="eyebrow">PRIMEIRO ACESSO</p><h2 id="password-setup-title">Crie sua senha de acesso</h2></div>
          <button type="button" className="icon-button" aria-label="Agora não" onClick={()=>setPasswordSetupOpen(false)}><X size={21}/></button></div>
        <form className="modal-body stack gap-lg" onSubmit={saveFirstPassword}>
          <p className="subtle">Seu painel já está liberado. Defina uma senha para entrar diretamente no ContabFlow pelo celular e computador.</p>
          <label>Nova senha *<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Pelo menos 8 caracteres"/></label>
          <label>Confirme a senha *<input type="password" autoComplete="new-password" minLength={8} required value={confirmNewPassword} onChange={e=>setConfirmNewPassword(e.target.value)} placeholder="Repita sua senha"/></label>
          {passwordSetupError&&<p role="alert" className="form-error">{passwordSetupError}</p>}
          <div className="modal-actions">
            <button type="button" className="btn soft" onClick={()=>setPasswordSetupOpen(false)}>Agora não</button>
            <button type="submit" className="btn primary" disabled={passwordSetupBusy}>{passwordSetupBusy?'Salvando…':'Salvar minha senha'}</button>
          </div>
        </form>
      </div>
    </div>}
    {modal&&<div className="modal-overlay" onMouseDown={e=>{if(e.currentTarget===e.target)closeModal();}}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-head"><div><p className="eyebrow">CONTABFLOW</p><h2 id="modal-title">{modal==='client'?(clientDraft.id?'Editar cliente':'Novo cliente'):(obligationDraft.id?'Editar cobrança':'Nova cobrança')}</h2></div><button className="icon-button" aria-label="Fechar" onClick={closeModal}><X size={21}/></button></div>
      {modal==='client'?<form onSubmit={saveClient} className="modal-body stack gap-lg"><div className="form-row"><label>Nome completo *<input autoFocus required value={clientDraft.name} onChange={e=>setClientDraft({...clientDraft,name:e.target.value})} placeholder="Ex.: Maria Silva"/></label><label>Empresa<input value={clientDraft.company} onChange={e=>setClientDraft({...clientDraft,company:e.target.value})} placeholder="Razão social ou fantasia"/></label></div>
        <label>CPF/CNPJ (opcional)<input value={clientDraft.tax_id||''} onChange={e=>setClientDraft({...clientDraft,tax_id:e.target.value})} placeholder="Identificação no documento"/></label><label>WhatsApp com DDD *<input required value={clientDraft.phone} onChange={e=>setClientDraft({...clientDraft,phone:e.target.value})} placeholder="68 99999-9999"/></label>
        <label>E-mail para lembretes<input type="email" value={clientDraft.email||''} onChange={e=>setClientDraft({...clientDraft,email:e.target.value})} placeholder="cliente@empresa.com.br"/></label>
        <label className="check-card"><input type="checkbox" checked={clientDraft.email_opt_in===true}
          onChange={e=>setClientDraft({...clientDraft,email_opt_in:e.target.checked,email_opt_in_at:e.target.checked?new Date().toISOString():null,
            email_consent_source:e.target.checked?clientDraft.email_consent_source:null})}/>
          <span><strong>O cliente autorizou lembretes por e-mail</strong><small>Registre a autorização específica. Informe como ela foi obtida.</small></span></label>
        {clientDraft.email_opt_in&&<label>Origem da autorização para e-mail *
          <input required value={clientDraft.email_consent_source||''}
            onChange={e=>setClientDraft({...clientDraft,email_consent_source:e.target.value})}
            placeholder="Ex.: contrato assinado, formulário de autorização"/></label>}
        <label className="check-card"><input type="checkbox" checked={clientDraft.opt_in} onChange={e=>setClientDraft({...clientDraft,opt_in:e.target.checked,opt_in_at:e.target.checked?new Date().toISOString():null,consent_source:e.target.checked?clientDraft.consent_source:null})}/><span><strong>O cliente autorizou lembretes pelo WhatsApp</strong><small>Marque apenas com autorização realmente obtida. Ter o contato salvo não é consentimento.</small></span></label>
        {clientDraft.opt_in&&<label>Como a autorização foi obtida? *<input required value={clientDraft.consent_source||''} onChange={e=>setClientDraft({...clientDraft,consent_source:e.target.value})} placeholder="Ex.: contrato de prestação de serviços, 10/10/2026"/></label>}
        <label className="check-card"><input type="checkbox" checked={clientDraft.active} onChange={e=>setClientDraft({...clientDraft,active:e.target.checked})}/><span><strong>Cliente ativo</strong><small>Clientes inativos não recebem lembretes automáticos.</small></span></label>
        {error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="btn soft" onClick={closeModal}>Cancelar</button><button disabled={saving} className="btn primary">{saving?'Salvando…':'Salvar cliente'}</button></div></form>:
        <form onSubmit={saveObligation} className="modal-body stack gap-lg"><label>Cliente *<select required value={obligationDraft.client_id} onChange={e=>setObligationDraft({...obligationDraft,client_id:e.target.value})}><option value="">Selecione um cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name} — {c.company||'PF'}</option>)}</select></label>
          <label>Descrição dos honorários *<input required value={obligationDraft.title} onChange={e=>setObligationDraft({...obligationDraft,title:e.target.value})} placeholder="Ex.: DAS — Simples Nacional"/></label>
          <div className="form-row"><label>Vencimento *<input type="date" required value={obligationDraft.due_date} onChange={e=>setObligationDraft({...obligationDraft,due_date:e.target.value})}/></label><label>Valor dos honorários *<input required type="number" min="0" step="0.01" value={obligationDraft.amount??''} onChange={e=>setObligationDraft({...obligationDraft,amount:e.target.value===''?null:Number(e.target.value)})} placeholder="0,00"/></label></div>
          <p className="field-hint">O PDF será gerado automaticamente com este valor e vencimento. Ele não será um recibo de quitação.</p>
          <label className="check-card"><input type="checkbox" checked={obligationDraft.recurring} onChange={e=>setObligationDraft({...obligationDraft,recurring:e.target.checked})}/><span><strong>Repetir mensalmente</strong><small>O servidor gera uma nova competência a cada mês, sem duplicar o documento anterior. Links e valores devem ser atualizados quando necessário.</small></span></label>
          <div className="field"><label>Dias para enviar os lembretes por e-mail e WhatsApp</label>
            <p className="field-hint">A mesma régua vale para os canais autorizados e ativados no escritório. 0 = no dia. Cada canal registra seu próprio disparo.</p>
            <div className="offset-grid">{[30,15,7,5,3,1,0,-1,-3,-7].map(n=><label className="offset-item" key={n}>
              <input type="checkbox" checked={(obligationDraft.reminder_offsets||[]).includes(n)} onChange={e=>setObligationDraft({...obligationDraft,reminder_offsets:e.target.checked?[...(obligationDraft.reminder_offsets||[]),n].sort((a,b)=>b-a):(obligationDraft.reminder_offsets||[]).filter(v=>v!==n)})}/>
              {n>0?n+'d antes':n<0?Math.abs(n)+'d depois':'No dia'}
            </label>)}</div></div>
          {error&&<p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="btn soft" onClick={closeModal}>Cancelar</button><button disabled={saving} className="btn primary">{saving?'Salvando…':'Salvar obrigação'}</button></div></form>}
      </div>
    </div>}
    <WhatsAppSupport/>
  </div>;
}
