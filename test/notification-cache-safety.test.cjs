const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationsService } = require('../dist/src/notifications/notifications.service');
const { NotificationRepository } = require('../dist/src/messaging/notification-repository');

test('mark read handles TypeORM returned rows and invalidates cached count', async () => {
  const calls = [];
  const service = new NotificationsService({ enabled: false }, { query: async sql => { assert.match(sql, /RETURNING id/); return [{ id: 'notification' }]; } });
  service.redis = { isOpen: true, del: async key => calls.push(key) };
  await service.markAsRead('notification', { id: 'recipient' });
  assert.deepEqual(calls, ['eru:unread_count:recipient']);
});

test('notification cache changes only after fanout commits and remains untouched on rollback', async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const connection = { release() {}, query: async sql => {
      calls.push(sql);
      if (sql.startsWith('SELECT is_public')) return { rowCount: 1, rows: [{ is_public: true }] };
      if (sql.startsWith('SELECT user_id')) return { rows: [{ user_id: 'recipient' }] };
      if (sql.includes('INSERT INTO notifications')) {
        if (fail) throw new Error('database write failed');
        return { rowCount: 1 };
      }
      return { rows: [] };
    } };
    const repository = new NotificationRepository({ connect: async () => connection });
    const redis = { isOpen: true, del: async key => calls.push(`DEL ${key}`) };
    const event = { templateId: 'template', revision: 2, actorId: 'actor', title: 'Example', version: '2' };
    if (fail) {
      await assert.rejects(repository.deliver(event, 'event', redis), /database write failed/);
      assert.ok(calls.includes('ROLLBACK'));
      assert.equal(calls.some(sql => sql.startsWith('DEL')), false);
    } else {
      await repository.deliver(event, 'event', redis);
      assert.ok(calls.indexOf('COMMIT') < calls.indexOf('DEL eru:unread_count:recipient'));
    }
  }
});
