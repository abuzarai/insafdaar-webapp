import { jest, test, expect, beforeEach } from '@jest/globals';
const query = jest.fn();
jest.unstable_mockModule('../db.js', () => ({ default: { query } }));
jest.unstable_mockModule('../services/documentExtraction.service.js', () => ({ enqueueDocumentExtractionJobs: jest.fn() }));
const { getActiveStartCase } = await import('../controllers/clientDashboard/startCase/startCase.controller.js');
const { createFeedback } = await import('../controllers/clientDashboard/feedback/feedback.controller.js');
const { default: profileRouter } = await import('../routes/clientProfile.js');
// Exercise the actual route handler after authenticated owner middleware; DB remains mocked.
const updateProfile = profileRouter.stack.find(layer => layer.route?.methods.put).route.stack.at(-1).handle;
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });
beforeEach(() => query.mockReset());
test('explicit continuation loads only the exact owned case, with no mutation or latest fallback', async () => {
  query.mockResolvedValue({ rows: [{ id: 73, user_id: 42, status: 'INTAKE_STARTED', language: 'Urdu' }] });
  const res = response(); await getActiveStartCase({ user: { id: 42 }, query: { caseId: '73' } }, res);
  expect(query).toHaveBeenCalledTimes(1); expect(query.mock.calls[0]).toEqual([expect.stringContaining('id=$1 AND user_id=$2'), [73, 42]]);
  expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store'); expect(res.json.mock.calls[0][0].case.id).toBe(73);
});
test.each(['0','-1','1.2','1 OR 1=1','9007199254740992','CASE-73',''])('invalid explicit case %s never falls back', async caseId => {
  const res = response(); await getActiveStartCase({ user: { id: 42 }, query: { caseId } }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});
test('foreign or missing case cannot resume another case', async () => {
  query.mockResolvedValue({ rows: [] }); const res = response();
  await getActiveStartCase({ user: { id: 42 }, query: { caseId: '73' } }, res);
  expect(res.status).toHaveBeenCalledWith(404); expect(query).toHaveBeenCalledTimes(1);
});
test('ordinary active-case restoration remains read-only and compatible', async () => {
  query.mockResolvedValue({ rows: [] }); const res = response(); await getActiveStartCase({ user: { id: 42 }, query: {} }, res);
  expect(res.json).toHaveBeenCalledWith({ case: null }); expect(query.mock.calls[0][0]).toContain('ORDER BY updated_at DESC');
});
test('lawyer feedback binds to the assigned lawyer on the owned case, with optional ratings', async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 73, assigned_advocate_id: 99 }] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
  const res = response(); await createFeedback({ user: { id: 42 }, body: { audience: 'Advocate', caseId: 'CASE-73', message: 'Fictional feedback' } }, res);
  expect(query.mock.calls[0][1]).toEqual([73,42]); expect(query.mock.calls[1][1].slice(0,4)).toEqual([42,73,'ADVOCATE',99]);
  expect(query.mock.calls[1][1][6]).toBe('{}'); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Feedback saved' }));
});
test.each([null, 77])('unassigned or mismatched lawyer feedback cannot be inserted (%s)', async assigned => {
  query.mockResolvedValue({ rows: [{ id: 73, assigned_advocate_id: assigned }] }); const res = response();
  await createFeedback({ user: { id: 42 }, body: { audience: 'Advocate', caseId: 73, advocateUserId: 99, message: 'Fictional feedback' } }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(query).toHaveBeenCalledTimes(1);
});
test('partial profile saves use the authenticated owner and cannot assert verification or eligibility', async () => {
  query.mockResolvedValue({ rows: [] }); const res = response();
  await updateProfile({ user: { id: 42 }, body: { profile: { userId: 999, fullName: 'Fictional Client', city: 'Fictional City', cnic: '', phone: '', documentsCompleted: true, identityDocStatus: 'VERIFIED', addressProofStatus: 'VERIFIED' } } }, res);
  expect(query).toHaveBeenCalledTimes(2); expect(query.mock.calls[0][1]).toEqual(['Fictional Client',42]);
  expect(query.mock.calls[1][1]).toEqual([42,'','','Fictional City','','','','','']);
  expect(query.mock.calls[1][0]).not.toMatch(/documents_completed|identity_doc_status|address_proof_status/);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
});
test.each([{ cnic: 'invalid' }, { phone: 'invalid' }, { emergencyContactPhone: 'invalid' }])('provided malformed identity/contact data still cannot be saved (%j)', async profile => {
  const res = response(); await updateProfile({ user: { id: 42 }, body: { profile } }, res); expect(res.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});
test('feedback cannot attach to another client’s case', async () => {
  query.mockResolvedValue({ rows: [] }); const res = response(); await createFeedback({ user: { id: 42 }, body: { audience: 'Advocate', caseId: 73, message: 'Fictional feedback' } }, res);
  expect(res.status).toHaveBeenCalledWith(404); expect(query).toHaveBeenCalledTimes(1);
});
