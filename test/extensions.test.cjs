const test = require('node:test');
const assert = require('node:assert/strict');
const { readConfig } = require('../dist/src/config');
const { createApplication } = require('../dist/src/app');

test('Extensions service and marketplace contract', async (t) => {
  const app = await createApplication(
    readConfig({ TEMPLATE_STORE: 'memory' }),
    false,
  );
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();

  // 1. List all extensions
  const listRes = await fetch(`${base}/extensions`);
  assert.equal(listRes.status, 200);
  const items = await listRes.json();
  assert(Array.isArray(items));
  assert(items.length >= 6);
  assert(items.some((item) => item.id === 'resource-gateway'));
  assert(items.some((item) => item.id === 'cornell-notes'));
  assert(items.some((item) => item.id === 'ai-flashcard'));

  // 2. Filter by category
  const pluginRes = await fetch(`${base}/extensions?category=plugin`);
  const plugins = await pluginRes.json();
  assert(plugins.every((item) => item.category === 'plugin'));

  // 3. Search extensions
  const searchRes = await fetch(`${base}/extensions?search=cornell`);
  const searchResults = await searchRes.json();
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].id, 'cornell-notes');

  // 4. Get detail
  const detailRes = await fetch(`${base}/extensions/cornell-notes`);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json();
  assert.equal(detail.name, 'Cornell Note Template');
  assert.equal(detail.installable, true);

  // 5. Install available extension
  const installRes = await fetch(`${base}/extensions/cornell-notes/install`, { method: 'POST' });
  assert.equal(installRes.status, 201);
  const installResult = await installRes.json();
  assert.equal(installResult.success, true);
  assert(installResult.payload);
  assert.equal(installResult.payload.type, 'template');

  // 6. Refuse install on in_development roadmap item
  const roadmapInstallRes = await fetch(`${base}/extensions/ai-flashcard/install`, { method: 'POST' });
  assert.equal(roadmapInstallRes.status, 400);

  // 7. Uninstall extension
  const uninstallRes = await fetch(`${base}/extensions/cornell-notes/uninstall`, { method: 'POST' });
  assert.equal(uninstallRes.status, 200);
  const uninstallResult = await uninstallRes.json();
  assert.equal(uninstallResult.success, true);
  assert.equal(uninstallResult.extensionId, 'cornell-notes');
});
