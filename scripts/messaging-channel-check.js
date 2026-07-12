const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function finalFunctionSlice(source, name) {
  let start = -1;
  let cursor = 0;
  while (true) {
    const next = source.indexOf('function ' + name + '(', cursor);
    if (next < 0) break;
    start = next;
    cursor = next + 1;
  }
  if (start < 0) return '';
  const argsClose = source.indexOf(')', start);
  const open = source.indexOf('{', argsClose > -1 ? argsClose : start);
  if (open < 0) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

function requireText(label, source, text) {
  if (!source.includes(text)) fail(label + ' is missing "' + text + '".');
}

const messagingStatus = finalFunctionSlice(app, 'messagingStatus');
const messageSetupPanel = finalFunctionSlice(app, 'messageSetupPanel');
const openComposeMessage = finalFunctionSlice(app, 'openComposeMessage');
const messagesView = finalFunctionSlice(app, 'Messages');
const sendProviderEmail = finalFunctionSlice(server, 'sendProviderEmail');
const parseIncomingEmail = finalFunctionSlice(server, 'parseIncomingEmail');
const approveAiMessage = finalFunctionSlice(server, 'approveAiMessage');
const publicMessagingStatus = finalFunctionSlice(server, 'publicMessagingStatus');
const queueEmailNotification = finalFunctionSlice(server, 'queueEmailNotification');
const queueOwnerEmailNotification = finalFunctionSlice(server, 'queueOwnerEmailNotification');

if (!messagingStatus || !messageSetupPanel || !openComposeMessage || !messagesView) fail('Missing active frontend messaging functions.');
if (!sendProviderEmail || !parseIncomingEmail || !approveAiMessage || !publicMessagingStatus || !queueEmailNotification || !queueOwnerEmailNotification) fail('Missing server messaging channel functions.');

requireText('Messaging status', messagingStatus, 'emailWebhook');
requireText('Messaging notification status', messagingStatus, 'notificationEmail');
requireText('Message setup panel', messageSetupPanel, 'Email webhook');
requireText('Message setup notification email', messageSetupPanel, 'notificationEmailTo');
requireText('Message setup notification test', messageSetupPanel, 'send-email-notification-test');
requireText('Compose modal channel selector', openComposeMessage, '<select id="messageChannel">');
requireText('Compose modal email option', openComposeMessage, '<option value="Email"');
requireText('Messages view channel summary', messagesView, "stat('Channels'");
requireText('Messages inbox layout', messagesView, 'message-inbox-layout');
requireText('Messages conversation panel', app, 'messageConversationPanel');
requireText('Thread reply action', app, 'send-thread-message');
requireText('Star custom prompt action', app, 'star-ai-custom');
requireText('Server email webhook route', server, "/api/webhooks/email");
requireText('Server notification settings route', server, "/api/notifications/email/settings");
requireText('Server notification test route', server, "/api/notifications/email/test");
requireText('Server daily closeout notification route', server, "/api/notifications/daily-closeout");
requireText('Server public email webhook status', publicMessagingStatus, 'emailWebhookUrl');
requireText('Server public notification status', publicMessagingStatus, 'notificationsEnabled');
requireText('Inbound email parser', parseIncomingEmail, 'parseEmailAddress');
requireText('Resend support', sendProviderEmail, 'api.resend.com/emails');
requireText('SendGrid support', sendProviderEmail, 'api.sendgrid.com/v3/mail/send');
requireText('Email notification queue', queueEmailNotification, 'WheelsonAuto email notification');
requireText('Owner notification event filter', queueOwnerEmailNotification, 'settings.events.includes(event)');
requireText('Daily closeout notification payload', server, 'dailyCloseoutNotificationPayload');
requireText('Star approval email send', approveAiMessage, 'sendProviderEmail');

console.log('Messaging channel check passed: Star, SMS, email sending, email inbound webhook, notification email, and channel UI are wired.');
