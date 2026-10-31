import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,ExternalLink,Loader2,MessageCircle,ShieldAlert,Unplug,XCircle} from 'lucide-react';
import {supabase} from './lib/supabase';

type ConnectionState={
  display_phone_number:string;
  verified_name:string;
  connection_status:'connected'|'pending'|'error';
  last_error?:string|null;
};
type MetaLoginResponse={
  authResponse?:{code?:string;accessToken?:string};
  code?:string;
  status?:string;
};
type MetaSdk={
  init:(options:Record<string,unknown>)=>void;
  login:(callback:(r:MetaLoginResponse)=>void,options:Record<string,unknown>)=>void;
};
declare global{interface Window{FB?:MetaSdk;}}
const appId=import.meta.env.VITE_META_APP_ID||'';
const configId=import.meta.env.VITE_META_CONFIG_ID||'';
const MAX_SIGNUP_MS=180_000;
const ALLOWED_META_EVENTS=new Set([
  'FINISH','FINISH_ONLY_WABA','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_OBO_MIGRATION','FINISH_GRANT_ONLY_API_ACCESS'
]);

async function invokeErrorMessage(error:unknown,fallback:string):Promise<string>{
  const err=error as {context?:{json?:()=>Promise<unknown>};message?:string}|null;
  if(err?.context?.json){
    try{
      const response=await err.context.json() as {error?:unknown};
      if(typeof response?.error==='string'&&response.error.length>0){
        return response.error.slice(0,350);
      }
    }catch{ /* resposta do servidor não disponível */ }
  }
  return fallback;
}

export default function WhatsAppConnectionPanel({
  orgId,onStatusChange
}:{
  orgId:string|null;
  onStatusChange?:(connected:boolean)=>void;
}){
  const [sdkReady,setSdkReady]=useState(false);
  const [serverReady,setServerReady]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const [status,setStatus]=useState<ConnectionState|null>(null);
  const [error,setError]=useState('');
  const [existingBusinessApp,setExistingBusinessApp]=useState(false);
  const [testPhone,setTestPhone]=useState('');
  const [testConsent,setTestConsent]=useState(false);
  const [testSending,setTestSending]=useState(false);
  const [testFeedback,setTestFeedback]=useState<{ok:boolean;message:string}|null>(null);
  const [testChecking,setTestChecking]=useState(false);
  const [testDelivery,setTestDelivery]=useState<{status:string;error_code?:string|null;recipient_last4?:string}|null>(null);
  const [testDeliveryNotice,setTestDeliveryNotice]=useState('');
  const info=useRef<{code?:string;waba?:string;phone?:string}>({});
  const submitting=useRef(false);
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const sessionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const flowId=useRef(0);
  const manualOAuthState=useRef('');
  const configured=Boolean(appId&&configId&&supabase);

  const clearTimer=useCallback(()=>{
    if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}
  },[]);
  const clearSessionTimer=useCallback(()=>{
    if(sessionTimer.current!==null){clearTimeout(sessionTimer.current);sessionTimer.current=null;}
  },[]);
  const stopFlow=useCallback((message='')=>{
    flowId.current+=1;
    clearTimer();
    clearSessionTimer();
    info.current={};
    manualOAuthState.current='';
    submitting.current=false;
    setBusy(false);
    setProgress('');
    if(message)setError(message);
  },[clearSessionTimer,clearTimer]);

  useEffect(()=>()=>{flowId.current+=1;clearTimer();clearSessionTimer();},[clearSessionTimer,clearTimer]);

  const refresh=useCallback(async()=>{
    if(!supabase||!orgId)return;
    const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
      body:{action:'status',org_id:orgId}
    });
    if(e||data?.error){
      setServerReady(null);
      setError(data?.error||await invokeErrorMessage(e,
        'Não foi possível consultar a conexão. Confira sua sessão e o responsável pelo escritório.'));
      onStatusChange?.(false);
      return;
    }
    const missing=Array.isArray(data?.configuration?.missing)
      ?(data.configuration.missing as unknown[]).filter((name):name is string=>typeof name==='string')
      :[];
    setServerReady(missing.length===0);
    setError(missing.length
      ?'Credenciais pendentes no Supabase: '+missing.join(', ')+'. Corrija em Edge Functions > Secrets.'
      :'');
    const connection=(data?.connection||null) as ConnectionState|null;
    setStatus(connection);
    onStatusChange?.(connection?.connection_status==='connected');
  },[orgId,onStatusChange]);

  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!configured)return;
    let disposed=false;
    const scriptId='contabflow-facebook-sdk';
    const init=()=>{
      if(disposed||!window.FB)return;
      window.FB.init({appId,autoLogAppEvents:false,xfbml:false,version:'v26.0'});
      setSdkReady(true);
    };
    if(window.FB){init();return;}
    let script=document.getElementById(scriptId) as HTMLScriptElement|null;
    if(!script){
      script=document.createElement('script');
      script.id=scriptId;
      script.src='https://connect.facebook.net/pt_BR/sdk.js';
      script.async=true;
      document.body.appendChild(script);
    }
    script.addEventListener('load',init);
    return()=>{disposed=true;script?.removeEventListener('load',init);};
  },[configured]);

  const attemptComplete=useCallback(async()=>{
    const {code,waba='',phone=''}=info.current;
    if(!code||!orgId||!supabase||submitting.current)return;
    submitting.current=true;
    const activeFlow=flowId.current;
    setProgress('Autorização recebida. Registrando o número com segurança...');
    try{
      const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
        body:{action:'connect',org_id:orgId,code,...(manualOAuthState.current?{oauth_flow:'manual'}:{}),waba_id:waba,phone_number_id:phone}
      });
      if(e||data?.error)throw Error(data?.error||
        await invokeErrorMessage(e,'O servidor não conseguiu finalizar a conexão. Confira sua conta no Supabase.'));
      if(activeFlow!==flowId.current)return;
      setStatus(data.connection as ConnectionState);
      onStatusChange?.(data.status==='connected');
      stopFlow();
      if(data.status!=='connected'){
        setError('O número foi autorizado, mas a assinatura de webhooks ainda está pendente. Confira o aviso acima.');
      }else{
        setError('');
      }
    }catch(e){
      if(activeFlow===flowId.current)stopFlow(
        e instanceof Error?e.message:'Falha na conexão. Tente novamente.'
      );
    }finally{
      if(activeFlow===flowId.current)submitting.current=false;
    }
  },[orgId,onStatusChange,stopFlow]);

  useEffect(()=>{
    const onMessage=(event:MessageEvent)=>{
      // OAuth explícito: o callback retorna ao domínio do ContabFlow e informa o código com state.
      if(event.origin===window.location.origin){
        const msg=event.data as {type?:string;code?:string;state?:string;error?:string}|null;
        if(msg?.type!=='CONTABFLOW_META_OAUTH'||!busy||!manualOAuthState.current)return;
        if(msg.state!==manualOAuthState.current){stopFlow('A verificação de segurança do login não corresponde à solicitação.');return;}
        if(msg.error){stopFlow('A Meta não concluiu a autorização: '+String(msg.error).slice(0,120));return;}
        if(!msg.code){stopFlow('A Meta não retornou o código de autorização.');return;}
        info.current={...info.current,code:msg.code};
        setProgress('Autorização recebida. Validando a conta WhatsApp no servidor...');
        void attemptComplete();
        return;
      }
      let host='';
      try{host=new URL(event.origin).hostname;}catch{return;}
      if(host!=='facebook.com'&&!host.endsWith('.facebook.com'))return;
      let payload:unknown;
      try{payload=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
      if(!payload||typeof payload!=='object')return;
      const data=payload as {type?:string;event?:string;data?:Record<string,unknown>};
      if(data.type!=='WA_EMBEDDED_SIGNUP'||!busy)return;
      if(data.event==='CANCEL'||data.event==='ERROR'){
        stopFlow(data.event==='CANCEL'?
          'A autorização foi cancelada na Meta. Nenhum número foi conectado.':
          'A Meta informou um problema no cadastro do WhatsApp. Revise a conta e tente novamente.');
        return;
      }
      if(!ALLOWED_META_EVENTS.has(String(data.event)))return;
      const waba=String(data.data?.waba_id||'');
      const phone=String(data.data?.phone_number_id||'');
      clearSessionTimer();
      info.current={...info.current,waba,phone};
      setProgress(info.current.code?
        'Número e autorização recebidos. Concluindo conexão...':
        'Número selecionado. Aguardando confirmação final da Meta...');
      void attemptComplete();
    };
    window.addEventListener('message',onMessage);
    return()=>window.removeEventListener('message',onMessage);
  },[attemptComplete,busy,clearSessionTimer,stopFlow]);

  function connect(){
    if(!appId||!configId||busy||!orgId)return;
    if(!window.FB||!sdkReady){
      setError('O SDK oficial da Meta ainda não carregou. Atualize a página e confira se o navegador está bloqueando o Facebook.');
      return;
    }
    flowId.current+=1;
    const activeFlow=flowId.current;
    manualOAuthState.current='';
    info.current={};
    submitting.current=false;
    setError('');
    setBusy(true);
    setProgress('Conclua o cadastro WhatsApp na janela oficial da Meta, selecionando o portfólio e o número.');
    clearTimer();
    clearSessionTimer();
    timer.current=setTimeout(()=>{
      if(activeFlow!==flowId.current)return;
      stopFlow('O prazo de autorização terminou. Feche a janela da Meta e tente novamente.');
    },MAX_SIGNUP_MS);
    // Embedded Signup v4 precisa do Facebook Login for Business iniciado via JS SDK.
    // Código OAuth e evento FINISH chegam por canais distintos.
    try{
      window.FB.login(response=>{
        if(activeFlow!==flowId.current)return;
        const code=String(response.authResponse?.code||response.code||'');
        if(!code){
          stopFlow('A Meta não retornou o código de autorização. Escolha Editar configurações e conclua o cadastro do WhatsApp Business.');
          return;
        }
        info.current={...info.current,code};
        setProgress(info.current.waba
          ?'Conta WhatsApp e autorização recebidas. Finalizando vínculo...'
          :'Autorização recebida. Confirmando a conta WhatsApp Business...');
        // Aguarda brevemente o evento FINISH para priorizar o WABA exato;
        // o servidor possui fallback seguro se a Meta não enviar o evento.
        clearSessionTimer();
        sessionTimer.current=setTimeout(()=>{
          if(activeFlow===flowId.current)void attemptComplete();
        },1200);
      },{
        config_id:configId,
        auth_type:'rerequest',
        response_type:'code',
        override_default_response_type:true,
        extras:{
          setup:{},
          ...(existingBusinessApp?{featureType:'whatsapp_business_app_onboarding'}:{})
        }
      });
    }catch(e){
      stopFlow('Não foi possível iniciar o cadastro da Meta. Confira se Entrar com o SDK do JavaScript está habilitado.');
    }
  }

  async function checkTestDelivery(){
    if(!supabase||!orgId||testChecking||busy)return;
    setTestChecking(true);
    setTestDeliveryNotice('');
    try{
      const {data,error:e}=await supabase.functions.invoke('whatsapp-test-send',{
        body:{action:'status',org_id:orgId}
      });
      if(e||data?.error)throw Error(data?.error||await invokeErrorMessage(e,'Falha ao consultar o status do teste.'));
      const last=data?.test;
      if(!last){setTestDelivery(null);setTestDeliveryNotice('Ainda não existe teste de envio registrado.');return;}
      setTestDelivery({status:String(last.status||''),error_code:last.error_code||null,recipient_last4:String(last.recipient_last4||'')});
    }catch(e){
      setTestDeliveryNotice(e instanceof Error?e.message:'Não foi possível consultar a entrega.');
    }finally{
      setTestChecking(false);
    }
  }

  async function sendTest(){
    if(!supabase||!orgId||status?.connection_status!=='connected'||testSending)return;
    setTestFeedback(null);
    setTestDelivery(null);
    setTestDeliveryNotice('');
    const digits=testPhone.replace(/\D/g,'');
    const normalized=digits.length===10||digits.length===11?'55'+digits:digits;
    if(!/^55\d{10,11}$/.test(normalized)){
      setTestFeedback({ok:false,message:'Informe um WhatsApp brasileiro válido com DDD. Exemplo: (68) 99999-9999.'});
      return;
    }
    if(!testConsent){
      setTestFeedback({ok:false,message:'Confirme que o destinatário autorizou esse teste.'});
      return;
    }
    setTestSending(true);
    try{
      const {data,error:e}=await supabase.functions.invoke('whatsapp-test-send',{
        body:{org_id:orgId,phone:normalized,consent_confirmed:true}
      });
      if(e||data?.error){
        throw Error(data?.error||await invokeErrorMessage(e,'Não foi possível enviar o teste.'));
      }
      setTestFeedback({ok:true,message:String(data?.message||'Mensagem aceita pela Meta. Confira a entrega no destinatário.')});
      setTestConsent(false);
    }catch(e){
      setTestFeedback({ok:false,message:e instanceof Error?e.message:'O envio de teste não pôde ser concluído.'});
    }finally{
      setTestSending(false);
    }
  }

  async function disconnect(){
    if(!orgId||!supabase||busy)return;
    if(!window.confirm('Desconectar este WhatsApp do ContabFlow? Os próximos lembretes serão interrompidos.'))return;
    setBusy(true);setError('');
    const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
      body:{action:'disconnect',org_id:orgId}
    });
    setBusy(false);
    if(e||data?.error){
      setError(data?.error||await invokeErrorMessage(e,'Não foi possível desconectar'));
      return;
    }
    setStatus(null);onStatusChange?.(false);
  }

  return <div className="stack gap-lg">
    <div className="integration-status">
      <span className="integration-icon"><MessageCircle size={20}/></span>
      <div><strong>WhatsApp próprio de cada escritório</strong>
        <p>O contador autoriza seu número pela Meta. As mensagens são enviadas pelo servidor, sem WhatsApp Web ou computador ligado.</p>
      </div>
    </div>
    {status?.connection_status==='connected'?<div className="integration-status">
      <CheckCircle2 color="#45d8ad" size={24}/>
      <div><strong>Conexão autorizada: {status.display_phone_number}</strong>
        <p>{status.verified_name||'Número do escritório'} · API da Meta vinculada. O envio exige template aprovado, assinatura ativa e agendamento configurado.</p>
      </div>
    </div>:status?<div className="integration-status">
      <ShieldAlert size={23}/><div><strong>Conexão pendente: {status.display_phone_number}</strong>
        <p>{status.last_error||'Verifique registro do número e assinatura de webhooks na Meta.'}</p>
      </div>
    </div>:<p className="subtle small">Nenhum WhatsApp conectado a este escritório.</p>}
    {!configured&&<p className="subtle small">O Admin Master deve cadastrar o App ID e Configuration ID na publicação GitHub Pages. A Meta também exige autorização para conectar números de outros escritórios.</p>}
    {configured&&!sdkReady&&<p className="subtle small" role="status">Carregando conexão oficial da Meta. Se não habilitar, confira bloqueadores do Facebook no navegador.</p>}
    <label className="check-card">
      <input type="checkbox" checked={existingBusinessApp} onChange={e=>setExistingBusinessApp(e.target.checked)} disabled={busy}/>
      <span><strong>Este número já usa o aplicativo WhatsApp Business</strong>
        <small>Tentar coexistência quando permitida pela Meta. Não exclua a conta do aplicativo.</small>
      </span>
    </label>
    <button type="button" className="btn primary" onClick={connect} disabled={!configured||!sdkReady||busy||!orgId||serverReady===false}>
      {busy?<Loader2 size={16}/>:<MessageCircle size={16}/>}
      {busy?'Conectando com a Meta...':status?'Reconectar meu WhatsApp Business':'Conectar meu WhatsApp Business'}
    </button>
    {busy&&<div className="stack" style={{gap:8}}>
      <p className="subtle small" role="status">{progress}</p>
      <button className="btn ghost" type="button" onClick={()=>stopFlow('Conexão cancelada no ContabFlow. Se a janela da Meta continuar aberta, feche-a antes de tentar novamente.')}>
        <XCircle size={16}/> Cancelar conexão
      </button>
    </div>}

    {status?.connection_status==='connected'&&<section className="stack" style={{gap:12,padding:16,border:'1px solid #325368',borderRadius:14,background:'rgba(11,33,52,.6)'}}>
      <div><strong>Enviar mensagem de teste</strong>
        <p className="subtle small" style={{marginTop:4}}>Teste o número conectado acima usando o modelo oficial hello_world. Não envia cobranças nem PDFs.</p>
      </div>
      <label htmlFor="whatsapp-test-phone">Número destinatário com DDD</label>
      <input id="whatsapp-test-phone" type="tel" inputMode="tel" autoComplete="tel"
        value={testPhone} disabled={testSending||busy}
        placeholder="(68) 99999-9999" onChange={e=>{setTestPhone(e.target.value);setTestFeedback(null);}}/>
      <label className="check-card" style={{margin:0}}>
        <input type="checkbox" checked={testConsent} disabled={testSending||busy} onChange={e=>setTestConsent(e.target.checked)}/>
        <span><strong>Confirmo que este número autorizou receber o teste</strong>
          <small>O contato precisa estar cadastrado em Clientes com consentimento de WhatsApp. Se estiver usando o número de teste da Meta, ele também precisa ser verificado como destinatário na Meta.</small>
        </span>
      </label>
      <button type="button" className="btn primary" onClick={()=>void sendTest()} disabled={testSending||busy||!testPhone.trim()||!testConsent}>
        {testSending?<Loader2 size={16}/>:<MessageCircle size={16}/>}
        {testSending?'Enviando teste...':'Enviar mensagem de teste'}
      </button>
      {testFeedback&&<p role="status" style={{color:testFeedback.ok?'#57e3b0':'#ff9a9a',margin:0}}>{testFeedback.message}</p>}
      <button type="button" className="btn soft" onClick={()=>void checkTestDelivery()} disabled={testChecking||testSending||busy}>
        {testChecking?<Loader2 size={16}/>:<CheckCircle2 size={16}/>}
        {testChecking?'Consultando...':'Consultar entrega do último teste'}
      </button>
      {testDelivery&&<p role="status" style={{margin:0,color:testDelivery.status==='failed'?'#ff9a9a':testDelivery.status==='delivered'||testDelivery.status==='read'?'#57e3b0':'#bed2e5'}}>
        {testDelivery.status==='read'?'Mensagem lida pelo destinatário.':
         testDelivery.status==='delivered'?'Mensagem entregue ao WhatsApp do destinatário.':
         testDelivery.status==='sent'?'Mensagem enviada pela Meta; aguardando confirmação de entrega.':
         testDelivery.status==='failed'?'A Meta informou falha na entrega'+(testDelivery.error_code?' (código '+testDelivery.error_code+')':'')+'.':
         testDelivery.status==='accepted'?'Mensagem aceita pela Meta; ainda sem confirmação de envio ou entrega.':
         'Teste em processamento.'}
        {' Número final '+(testDelivery.recipient_last4||'----')+'.'}
      </p>}
      {testDeliveryNotice&&<p className="subtle small" role="status" style={{margin:0}}>{testDeliveryNotice}</p>}
      <p className="subtle small">Limite de segurança: 3 testes por dia e intervalo mínimo de 5 minutos. A Meta pode restringir o número de teste a destinatários previamente verificados.</p>
    </section>}
    {status&&!busy&&<button type="button" className="btn ghost" onClick={disconnect}>
      <Unplug size={16}/> Desconectar número
    </button>}
    {error&&<p role="alert" className="error-message">{error}</p>}
    {serverReady===false&&<button type="button" className="btn ghost" onClick={()=>{void refresh();}} disabled={busy}>
      Verificar credenciais novamente
    </button>}
    <p className="subtle small">Nenhum token é exibido no painel. A autorização é individual e não dá acesso a conversas particulares. Se não conseguir conectar, confira as permissões de Provedor de Tecnologia na Meta.</p>
    <a className="external-link" href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">
      Configurar autorização do aplicativo na Meta <ExternalLink size={15}/>
    </a>
  </div>;
}
