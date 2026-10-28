import { jest, test, expect } from '@jest/globals';
import { allowance, enforceAllowance, reserveAdmission, assertCaseInactive } from '../services/interviewAdmission.service.js';
function fixture(row = {}, paused = false) {
  return { query: jest.fn(async sql => {
    if (sql.startsWith('SELECT paused')) return { rows: [{ paused }] };
    if (sql.startsWith('WITH moment')) return { rows: [{ daily:0, weekly:0, platform:0, ...row }] };
    return { rows: [] };
  }) };
}
test.each([
  [{daily:5,daily_retry:'2030-01-01Z'}, false, 'daily_limit',429,'INTERVIEW_DAILY_LIMIT'],
  [{weekly:25,weekly_retry:'2030-01-01Z'}, false, 'weekly_limit',429,'INTERVIEW_WEEKLY_LIMIT'],
  [{platform:100,platform_retry:'2030-01-01Z'}, false, 'platform_limit',429,'INTERVIEW_PLATFORM_LIMIT'],
  [{ledger_active:'2030-01-01Z'}, false, 'active_interview',409,'INTERVIEW_ALREADY_ACTIVE'],
  [{binding_active:'2030-01-01Z'}, false, 'active_interview',409,'INTERVIEW_ALREADY_ACTIVE'],
  [{}, true, 'paused',503,'INTERVIEWS_PAUSED'],
])('allowance maps durable policy/window/active rejection %j', async (row, paused, reason, status, code) => {
  const value = await allowance(fixture(row,paused),42,true);
  expect(value).toMatchObject({canStart:false,reason});
  expect(() => enforceAllowance(value)).toThrow(expect.objectContaining({status,code}));
});
test.each([{daily:4},{weekly:24},{platform:99},{daily:2,weekly:5,platform:25}])('counts below the new limits remain eligible %j',async row=>{
  expect(await allowance(fixture(row),42)).toEqual({canStart:true,reason:null,retryAt:null});
});
test.each([
  [{daily:6,daily_retry:'2030-01-01Z'},'daily_limit'],
  [{weekly:26,weekly_retry:'2030-01-01Z'},'weekly_limit'],
  [{platform:101,platform_retry:'2030-01-01Z'},'platform_limit'],
])('counts above the new limits stay blocked %j',async(row,reason)=>{
  expect(await allowance(fixture(row),42)).toMatchObject({canStart:false,reason});
});
test('retry queries select the admission whose expiry restores the new allowance',async()=>{
  const db=fixture();await allowance(db,42);
  const sql=db.query.mock.calls[1][0];
  expect(sql).toContain('OFFSET 4 LIMIT 1) q) AS daily_retry');
  expect(sql).toContain('OFFSET 24 LIMIT 1) q) AS weekly_retry');
  expect(sql).toContain('OFFSET 99 LIMIT 1) q) AS platform_retry');
});
test('reservation locks policy before checking repeat history and inserting', async () => {
  const db=fixture();
  await reserveAdmission(db,{id:42},{id:101},'intent','hash',{});
  expect(db.query.mock.calls[0][0]).toContain('FOR UPDATE');
  expect(db.query.mock.calls.at(-1)[0]).toContain("clock_timestamp()+INTERVAL '10 minutes'");
});
test('selected summary requires deliberate repeat and never reserves on omission', async () => {
  const db=fixture();
  await expect(reserveAdmission(db,{id:42},{id:101,selected_intake_revision_id:'old'},'intent','hash',{})).rejects.toMatchObject({status:409,code:'NEW_INTERVIEW_CONFIRMATION_REQUIRED'});
  expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false);
});
test('case review fence includes old live bindings as well as ambiguous ledger', async () => {
  const db={query:jest.fn(async()=>({rows:[{exists:1}]}))};
  await expect(assertCaseInactive(db,{id:101})).rejects.toMatchObject({code:'INTERVIEW_ALREADY_ACTIVE'});
  expect(db.query.mock.calls[0][0]).toContain('case_intake_live_sessions');
});
test('missing singleton disables new admissions without breaking saved review reads',async()=>{
  const value=await allowance({query:async()=>({rows:[]})},42);
  expect(value).toEqual({canStart:false,reason:'paused',retryAt:null});
  expect(()=>enforceAllowance(value)).toThrow(expect.objectContaining({status:503,code:'INTERVIEWS_PAUSED'}));
});
test('retry time covers every blocking window, not just the first limit',async()=>{
  const value=await allowance(fixture({ledger_active:'2030-01-01T00:05:00Z',daily:5,daily_retry:'2030-01-02T00:00:00Z',weekly:25,weekly_retry:'2030-01-07T00:00:00Z'}),42);
  expect(value).toEqual({canStart:false,reason:'weekly_limit',retryAt:'2030-01-07T00:00:00.000Z'});
});
