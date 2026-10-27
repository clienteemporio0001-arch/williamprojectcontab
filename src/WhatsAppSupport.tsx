import { MessageCircle } from 'lucide-react';
import './whatsapp.css';

const NUMBER='5568992097927';
export default function WhatsAppSupport(){
  const text='Olá! Preciso de informações sobre o ContabFlow.';
  return <a className="support-float"
    href={'https://wa.me/'+NUMBER+'?text='+encodeURIComponent(text)}
    target="_blank" rel="noopener noreferrer"
    title="Falar com o suporte do ContabFlow pelo WhatsApp"
    aria-label="Abrir WhatsApp do suporte ContabFlow">
    <MessageCircle size={25} fill="none" strokeWidth={2.5}/>
    <span>Fale conosco</span>
  </a>;
}
