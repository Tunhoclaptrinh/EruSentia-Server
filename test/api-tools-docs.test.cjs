const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../dist/src/app');
const { readConfig } = require('../dist/src/config');

test('executable documentation and tools are served beside OpenAPI only when docs are enabled', async t => {
  for (const enabled of [true, false]) {
    const app = await createApplication(readConfig({ TEMPLATE_STORE: 'memory', SWAGGER_ENABLED: String(enabled) }), false);
    await app.listen(0, '127.0.0.1');
    t.after(() => app.close());
    const base = await app.getUrl();
    for (const route of ['/docs/week-6', '/docs/tools/api-explorer', '/docs/tools/notifications']) {
      const response = await fetch(base + route);
      assert.equal(response.status, enabled ? 200 : 404);
      if (enabled) {
        assert.match(response.headers.get('content-type'), /text\/html/);
        const html = await response.text();
        assert.match(html, route.endsWith("/notifications") ? /data-eru-tool="notification-feed"/ : /data-eru-tool="api-console"/);
        assert.doesNotMatch(html, /function demoLoadCursor|function appQuickLogin/);
      }
    }
  }
});
