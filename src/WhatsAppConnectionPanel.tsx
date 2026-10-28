import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,ExternalLink,Loader2,MessageCircle,ShieldAlert,Unplug} from 'lucide-react';
import {supabase} from './lib/supabase';

type State={display_phone_number:string;verified_name:string;connection_status:'connected'|'pending'|'error';last_error?:string|null};
type MetaLoginResponse={authResponse?:{code?:string};code?:string};
type MetaSdk={init:(opts:Record<string,unknown>)=>void;login:(cb:(r:MetaLoginResponse)=>void,options:Record<string,unknown>)=>void};
declare global {interface Window { FB?:MetaSdk; }}
const appId=import.meta.env.VITE_META_APP_ID||'';
const configId=import.meta.env.VITE_META_CONFIG_ID||'';

export default function WhatsAppConnectionPanel({orgId,onStatusChange}:{
  orgId:string|null;onStatusChange?:(connected:boolean)=>void
}){
  const [sdkReady,setSdkReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState<State|null>(null);
  const [error,setError]=useState('');
  const [existingBusinessApp,setExistingBusinessApp]=useState(false);
  const info=useRef<{code?:string,waba?:string,phone?:string}>({});
  const submitting=useRef(false);
  const configured=Boolean(appId&&configId&&supabase);

  const refresh=useCallback(async()=>{
    if(!supabase||!orgId)return;
    const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
      body:{action:'status',org_id:orgId}
    });
    if(e||data?.error){
      setError(data?.error||'A função de conexão ainda não foi publicada no Supabase.');
      onStatusChange?.(false);
      return;
    }
    const connection=(data?.connection||null) as State|null;
    setStatus(connection);
    setError('');
    onStatusChange?.(connection?.connection_status==='connected');
  },[orgId,onStatusChange]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!configured)return;
    let cancelled=false;
    const scriptId='contabflow-facebook-sdk';
    const init=()=>{
      if(!cancelled&&window.FB){
        window.FB.init({appId,autoLogAppEvents:false,xfbml:false,version:'v26.0'});
        setSdkReady(true);
      }
    };
    if(window.FB){init();return;}
    let script=document.getElementById(scriptId) as HTMLScriptElement|null;
    if(!script){
      script=document.createElement('script');script.id=scriptId;
      script.src='https://connect.facebook.net/pt_BR/sdk.js';script.async=true;
      document.body.appendChild(script);
    }
    script.addEventListener('load',init);
    return ()=>{cancelled=true;script?.removeEventListener('load',init);};
  },[configured]);

  const attemptComplete=useCallback(async()=>{
    const {code,waba,phone}=info.current;
    if(!code||!waba||!phone||!orgId||!supabase||submitting.current)return;
    submitting.current=true;setBusy(true);setError('');
    try{
      const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
        body:{action:'connect',org_id:orgId,code,waba_id:waba,phone_number_id:phone}
      });
      if(e||data?.error)throw Error(data?.error||'Erro ao concluir conexão na Meta.');
      info.current={};
      setStatus(data.connection as State);
      onStatusChange?.(data.status==='connected');
    }catch(e){setError(e instanceof Error?e.message:'Falha na conexão.');}
    finally{submitting.current=false;setBusy(false);}
  },[orgId,onStatusChange]);

  useEffect(()=>{
    const handle=(event:MessageEvent)=>{
      let host='';
      try{host=new URL(event.origin).hostname;}catch{return;}
      if(host!=='facebook.com'&&!host.endsWith('.facebook.com'))return;
      let data:any;
      try{data=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
      if(data?.type!=='WA_EMBEDDED_SIGNUP')return;
      if(data.event==='CANCEL'||data.event==='ERROR'){
        setBusy(false);
        setError('Cadastro interrompido na Meta. Reabra a conexão para concluir.');
        return;
      }
      if(!['FINISH','FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING','FINISH_ONLY_WABA'].includes(String(data.event)))return;
      const waba=String(data.data?.waba_id||'');
      const phone=String(data.data?.phone_number_id||'');
      if(!waba||!phone){
        setBusy(false);
        setError('A Meta não retornou o número de envio. Conclua a verificação e repita a conexão.');
        return;
      }
      info.current={...info.current,waba,phone};
      void attemptComplete();
    };
    window.addEventListener('message',handle);
    return()=>window.removeEventListener('message',handle);
  },[attemptComplete]);

  function connect(){
    if(!window.FB||!configId||busy)return;
    info.current={};setError('');setBusy(true);
    window.FB.login((response)=>{
      const code=response?.authResponse?.code||response?.code;
      if(!code){
        setBusy(false);setError('Não recebemos a autorização da Meta. Verifique pop-ups e tente novamente.');
        return;
      }
      info.current={...info.current,code};
      void attemptComplete();
      // Não encerra aqui: a Meta também entrega o ID do número por postMessage.
    },{
      config_id:configId,response_type:'code',override_default_response_type:true,
      extras:existingBusinessApp?{setup:{},featureType:'whatsapp_business_app_onboarding'}:{setup:{}}
    });
  }

  async function disconnect(){
    if(!orgId||!supabase||busy)return;
    if(!window.confirm('Desconectar este WhatsApp do ContabFlow? Os próximos lembretes serão interrompidos.'))return;
    setBusy(true);setError('');
    const {data,error:e}=await supabase.functions.invoke('whatsapp-connect',{
      body:{action:'disconnect',org_id:orgId}
    });
    setBusy(false);
    if(e||data?.error){setError(data?.error||'Não foi possível desconectar');return;}
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
        <p>{status.verified_name||'Número do escritório'} · API da Meta vinculada. O envio ainda exige template aprovado, assinatura ativa e agendamento configurado.</p>
      </div>
    </div>:status?<div className="integration-status">
      <ShieldAlert size={23}/><div><strong>Conexão pendente: {status.display_phone_number}</strong>
        <p>{status.last_error||'Verifique registro do número e assinatura de webhooks na Meta.'}</p>
      </div>
    </div>:<p className="subtle small">Nenhum WhatsApp conectado a este escritório.</p>}
    {!configured&&<p className="subtle small">O Admin Master precisa configurar o App ID e o Configuration ID do Embedded Signup no GitHub Pages para habilitar este botão. A Meta também exige autorização para conectar números de outros escritórios.</p>}
    <label className="check-card">
      <input type="checkbox" checked={existingBusinessApp} onChange={e=>setExistingBusinessApp(e.target.checked)}/>
      <span><strong>Este número já usa o aplicativo WhatsApp Business</strong>
        <small>Tentar coexistência, quando habilitada e permitida pela Meta. Não exclua sua conta do aplicativo.</small>
      </span>
    </label>
    <button type="button" className="btn primary" onClick={connect} disabled={!configured||!sdkReady||busy||!orgId}>
      {busy?<Loader2 size={16}/>:<MessageCircle size={16}/>}
      {busy?'Conectando com a Meta...':status?'Reconectar meu WhatsApp Business':'Conectar meu WhatsApp Business'}
    </button>
    {!sdkReady&&configured&&<p className="subtle small">Inicializando login seguro da Meta...</p>}
    {status&&<button type="button" className="btn ghost" onClick={disconnect} disabled={busy}>
      <Unplug size={16}/> Desconectar número
    </button>}
    {error&&<p role="alert" className="error-message">{error}</p>}
    <p className="subtle small">Nenhum token é exibido no painel. A autorização é individual e não dá acesso a conversas particulares. Se não conseguir conectar, confira as permissões de Provedor de Tecnologia na Meta.</p>
    <a className="external-link" href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">
      Configurar autorização do aplicativo na Meta <ExternalLink size={15}/>
    </a>
  </div>;
}
