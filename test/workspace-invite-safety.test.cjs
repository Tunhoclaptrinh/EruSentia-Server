const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkspacesService } = require('../dist/src/workspaces/workspaces.service');
const owner = { id: 'owner', email: 'owner@example.test' };
function fixture(email = owner.email) {
  const writes = [];
  const manager = { query: async (sql, params) => {
    if (sql.startsWith('SELECT')) return [{ id: 'invite', workspace_id: 'workspace', email, role: 'viewer', expires_at: new Date(Date.now() + 60000), accepted_at: null }];
    writes.push({ sql, params });
    return [];
  } };
  return { writes, service: new WorkspacesService({ enabled: false }, { transaction: callback => callback(manager) }) };
}
test('invitation cannot be accepted by a different account', async () => {
  const { service, writes } = fixture('another@example.test');
  await assert.rejects(service.acceptInvite('token', owner), error => error.getStatus() === 403);
  assert.equal(writes.length, 0);
});
test('rejoining through a viewer invite preserves an existing owner role', async () => {
  const { service, writes } = fixture('OWNER@example.test');
  await service.acceptInvite('token', owner);
  assert.match(writes[0].sql, /ON CONFLICT \(workspace_id, user_id\) DO NOTHING/);
  assert.doesNotMatch(writes[0].sql, /UPDATE SET role/);
});
