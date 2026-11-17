import assert from 'node:assert/strict';
import { buildMonthlyRenewalPlan } from '../src/lib/monthly-billing.ts';

const active = [{id:'a',active:true},{id:'b',active:true},{id:'c',active:false}];
const charge = (extra={}) => ({
  id:'1',client_id:'a',title:'Honorários contábeis',amount:300,due_date:'2026-11-30',
  status:'paid',document_url:null,recurring:true,series_id:'series-a',
  due_day:30,reminder_offsets:[7,3,1,0],...extra
});

const december=buildMonthlyRenewalPlan([charge()],active,'2026-12');
assert.equal(december.candidates.length,1);
assert.equal(december.candidates[0].due_date,'2026-12-30');
assert.equal(december.candidates[0].status,'pending');
assert.equal(december.candidates[0].amount,300);
assert.equal(december.candidates[0].document_url,null);
assert.equal(december.candidates[0].series_id,'series-a');

const february=buildMonthlyRenewalPlan([charge({due_day:31,due_date:'2027-01-31'})],active,'2027-02');
assert.equal(february.candidates[0].due_date,'2027-02-28');
const leap=buildMonthlyRenewalPlan([charge({due_day:31,due_date:'2028-01-31'})],active,'2028-02');
assert.equal(leap.candidates[0].due_date,'2028-02-29');

const duplicated=buildMonthlyRenewalPlan([
  charge(),
  charge({id:'2',due_date:'2026-12-30',status:'pending'})
],active,'2026-12');
assert.equal(duplicated.candidates.length,0);
assert.equal(duplicated.alreadyCreated,1);

const onlyLatest=buildMonthlyRenewalPlan([
  charge({amount:200,due_date:'2026-10-30'}),
  charge({id:'3',amount:340,due_date:'2026-11-30'})
],active,'2026-12');
assert.equal(onlyLatest.candidates.length,1);
assert.equal(onlyLatest.candidates[0].amount,340);

const filters=buildMonthlyRenewalPlan([
  charge({id:'a1',status:'cancelled'}),
  charge({id:'b1',client_id:'b',series_id:'series-b',amount:null}),
  charge({id:'c1',client_id:'c',series_id:'series-c',status:'pending'}),
  charge({id:'d1',client_id:'b',series_id:null,recurring:false}),
  charge({id:'e1',client_id:'a',series_id:'series-e',due_date:'2027-01-10'})
],active,'2026-12');
assert.equal(filters.candidates.length,0);
assert.equal(filters.cancelledSeries,1);
assert.equal(filters.invalidSeries,1);
assert.equal(filters.inactiveClients,1);
assert.equal(filters.futureSeries,1);

assert.throws(()=>buildMonthlyRenewalPlan([],active,'2026-13'));
console.log('OK: geração mensal, mês curto, fevereiro bissexto, duplicidade, pagamentos, cancelamentos e elegibilidade.');
