import assert from 'node:assert/strict';
import {remainingTrialDays,isWorkspaceAllowed} from '../src/lib/trial.ts';

const start=Date.parse('2026-10-27T12:00:00Z');
assert.equal(remainingTrialDays('2026-11-03T12:00:00Z',start),7);
assert.equal(remainingTrialDays('2026-10-27T11:59:00Z',start),0);
assert.equal(remainingTrialDays(null,start),0);
assert.equal(isWorkspaceAllowed('active','trialing','2026-11-03T12:00:00Z',start),true);
assert.equal(isWorkspaceAllowed('active','trialing','2026-10-26T12:00:00Z',start),false);
assert.equal(isWorkspaceAllowed('active','pending',null,start),false);
assert.equal(isWorkspaceAllowed('suspended','active',null,start),false);
assert.equal(isWorkspaceAllowed('active','active',null,start),true);
console.log('OK: períodos de avaliação, expiração e bloqueio de acesso.');
