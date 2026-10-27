import assert from 'node:assert/strict';
import {parsePlanPrice,formatPlanPriceInput} from '../src/lib/plan-prices.ts';

assert.equal(parsePlanPrice('69,90'),69.9);
assert.equal(parsePlanPrice('99.90'),99.9);
assert.equal(parsePlanPrice('127'),127);
assert.equal(parsePlanPrice('0,00'),0);
assert.equal(parsePlanPrice('99999,99'),99999.99);
assert.equal(formatPlanPriceInput(127),'127,00');

for(const value of ['-1','69,999','1.000,00','','100000,00','abc','Infinity']){
  assert.equal(parsePlanPrice(value),null,'Preço inválido aceito: '+value);
}
console.log('OK: validação de preços brasileiros concluída.');
