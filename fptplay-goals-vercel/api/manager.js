import { router, getBody } from '../lib/http.js';
import { requireManager } from '../lib/auth.js';
import { getWorkspace, savePlan, saveResults, requestPlanEdit } from '../lib/goals.js';

// /api/manager?action=workspace | plan-save | result-save | plan-request-edit
export default router({
  'GET workspace': async (req) => getWorkspace(await requireManager(req)),
  'POST plan-save': async (req) => savePlan(await requireManager(req), getBody(req)),
  'POST result-save': async (req) => saveResults(await requireManager(req), getBody(req)),
  'POST plan-request-edit': async (req) => requestPlanEdit(await requireManager(req), getBody(req).reason),
});
