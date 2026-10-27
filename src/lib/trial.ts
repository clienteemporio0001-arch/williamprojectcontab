export type TrialSettings={
  trial_enabled:boolean;
  trial_days:number;
  trial_max_clients:number;
  trial_title:string;
  trial_description:string;
};
export const DEFAULT_TRIAL:TrialSettings={
  trial_enabled:false,
  trial_days:7,
  trial_max_clients:10,
  trial_title:'Teste o ContabFlow gratuitamente',
  trial_description:'Automatize seus honorários e conheça a plataforma antes de contratar.'
};
export function remainingTrialDays(expires:string|null,now=Date.now()):number{
  if(!expires)return 0;
  const millis=Date.parse(expires)-now;
  return Number.isFinite(millis)?Math.max(0,Math.ceil(millis/86400000)):0;
}
export function isWorkspaceAllowed(
  accessStatus:string|undefined,billingStatus:string|undefined,expires:string|null,
  now=Date.now()
):boolean{
  if(accessStatus!=='active')return false;
  if(billingStatus==='active')return true;
  return billingStatus==='trialing'&&!!expires&&Date.parse(expires)>now;
}
