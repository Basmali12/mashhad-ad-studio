import test from 'node:test';
import assert from 'node:assert/strict';
import {textBudgetExposure} from '../engine/film-money.mjs';
test('settled text usage replaces its estimate while outstanding and ambiguous calls retain their hold',()=>{
 const r={id:'r',projectId:'p',calls:2,reservedMicroUSD:500000};
 assert.equal(textBudgetExposure([r],[]),500000);
 const first={id:'r-0',projectId:'p',status:'completed',usage:{computedUSD:.005}};
 assert.equal(textBudgetExposure([r],[first]),255000);
 assert.equal(textBudgetExposure([r],[first,{...first,id:'r-1',usage:{computedUSD:.003}}]),8000);
 for(const bad of [{...first,projectId:'other'},{...first,status:'uncertain'},{...first,usage:null},{...first,usage:{computedUSD:-1}},{...first,id:'r-0-extra'}])assert.equal(textBudgetExposure([r],[bad]),500000);
 assert.equal(textBudgetExposure([r],[first,{...first,id:'r-1',usage:{computedUSD:1}}]),1005000);
 assert.equal(r.reservedMicroUSD,500000);
});
