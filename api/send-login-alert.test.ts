import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLoginAlertEmailContent,
  escapeHtml,
  normalizeGmailAppPassword,
  resolveTargetOwnerEmail,
} from './send-login-alert';

test('normalizeGmailAppPassword strips Google 4x4 spacing cleanly', () => {
  assert.equal(normalizeGmailAppPassword('abcd efgh ijkl mnop'), 'abcdefghijklmnop');
  assert.equal(normalizeGmailAppPassword('  xy12  zw34  '), 'xy12zw34');
  assert.equal(normalizeGmailAppPassword(undefined), '');
});

test('resolveTargetOwnerEmail prioritizes OWNER_ALERT_EMAIL, then GMAIL_USER, then default', () => {
  assert.equal(
    resolveTargetOwnerEmail({
      OWNER_ALERT_EMAIL: 'Owner@Coffee.ID',
      GMAIL_USER: 'sender@gmail.com',
    }),
    'owner@coffee.id'
  );
  assert.equal(
    resolveTargetOwnerEmail({
      OWNER_ALERT_EMAIL: '',
      GMAIL_USER: 'noreply@gmail.com',
    }),
    'noreply@gmail.com'
  );
  assert.equal(resolveTargetOwnerEmail({}), 'parisramaproject@gmail.com');
});

test('buildLoginAlertEmailContent escapes HTML safely and formats Indonesian details', () => {
  assert.equal(escapeHtml('<script>"test"</script>'), '&lt;script&gt;&quot;test&quot;&lt;/script&gt;');
  const content = buildLoginAlertEmailContent({
    username: 'kasir_dimas',
    employeeName: 'Dimas <script>',
    employeeEmail: 'dimas@brewflow.id',
    role: 'cashier',
    shopName: 'BrewFlow Coffee',
    deviceInfo: 'Chrome · Windows',
    loggedInAt: '2026-11-27T02:30:00.000Z',
  });
  assert.match(content.subject, /@kasir_dimas/);
  assert.match(content.subject, /Kasir/);
  assert.match(content.text, /@kasir_dimas/);
  assert.ok(!content.html.includes('<script>'));
  assert.ok(content.html.includes('&lt;script&gt;'));
});
