const assert = require('node:assert');

process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.WOA_AI_MODEL = 'gpt-5.4-nano';
process.env.WOA_AI_TIMEOUT_MS = '5000';
process.env.WOA_AI_MAX_REQUESTS_PER_DAY = '2';
process.env.WOA_AI_MAX_REQUESTS_PER_MONTH = '4';

const { openAiReplyPlan, openAiProviderReadiness } = require('../server');

(async () => {
  let request = null;
  let requestCount = 0;
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requestCount += 1;
    request = { url: String(url), options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          output: [{
            type: 'message',
            content: [{
              type: 'output_text',
              text: JSON.stringify({
                reply: 'Hi Test, I can send a secure payment link for office review.',
                intent: 'payment_link',
                actionType: 'send_payment_link',
                approvalRequired: false,
                needsHuman: false,
                canAutoSend: true,
                confidence: 0.94,
                tone: 'good',
                reasons: ['A hosted payment link does not charge a saved card.']
              })
            }]
          }]
        };
      }
    };
  };

  try {
    const pendingReadiness = openAiProviderReadiness({});
    assert.strictEqual(pendingReadiness.aiProviderConfigured, true);
    assert.strictEqual(pendingReadiness.aiProviderOperational, false);
    assert.strictEqual(pendingReadiness.aiProviderStatus, 'OpenAI test needed');
    const creditReadiness = openAiProviderReadiness({ integrations: { messaging: {
      lastAiProvider: 'rules',
      lastAiHealthStatus: 'OpenAI did not answer. Star used the safe rules fallback.',
      lastAiProviderError: 'insufficient_quota: add billing credit'
    } } });
    assert.strictEqual(creditReadiness.aiProviderCreditRequired, true);
    assert.strictEqual(creditReadiness.aiProviderOperational, false);
    assert.strictEqual(creditReadiness.aiProviderStatus, 'OpenAI credit needed');
    const verifiedReadiness = openAiProviderReadiness({ integrations: { messaging: {
      lastAiProvider: 'openai',
      lastAiHealthStatus: 'OpenAI answered through the Responses API and Star sanitized the plan.',
      lastAiProviderError: ''
    } } });
    assert.strictEqual(verifiedReadiness.aiProviderOperational, true);
    assert.strictEqual(verifiedReadiness.aiProviderStatus, 'OpenAI verified');

    const fallback = {
      reply: 'Rules fallback reply',
      intent: 'general_reply',
      actionType: 'reply',
      approvalRequired: false,
      needsHuman: false,
      canAutoSend: true,
      confidence: 0.7,
      tone: 'blue',
      reasons: ['Fallback']
    };
    const firstUsageData = {};
    const plan = await openAiReplyPlan(firstUsageData, {
      customer: 'Test Customer',
      phone: '+13135550123',
      body: 'Can you send me a payment link?'
    }, {
      organizationId: 'org-test',
      customerName: 'Test Customer',
      phone: '+13135550123',
      openClaims: [],
      maintenance: [],
      applications: [],
      paymentRequests: [],
      cardSetupRequests: [],
      documents: [],
      tasks: [],
      latestMessages: []
    }, fallback);

    assert(request && request.url.endsWith('/responses'), 'Star should call the OpenAI Responses API.');
    const body = JSON.parse(request.options.body);
    assert.strictEqual(body.store, false, 'Star provider calls must not store API responses.');
    assert.strictEqual(body.text.format.type, 'json_schema', 'Star should use strict Structured Outputs.');
    assert.strictEqual(body.text.format.strict, true, 'Star reply schema must be strict.');
    assert.deepStrictEqual(body.text.format.schema.required, ['reply', 'intent', 'actionType', 'approvalRequired', 'needsHuman', 'canAutoSend', 'confidence', 'tone', 'reasons']);
    assert.strictEqual(body.text.format.schema.additionalProperties, false);
    assert.match(body.safety_identifier, /^woa-star-[a-f0-9]{32}$/);
    assert.strictEqual(plan.provider, 'openai');
    assert.strictEqual(plan.mode, 'openai');
    assert.strictEqual(plan.actionType, 'send_payment_link');
    assert.strictEqual(plan.approvalRequired, false);
    assert.strictEqual(plan.canAutoSend, true);

    global.fetch = async () => {
      requestCount += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output_text: JSON.stringify({
              reply: 'I charged the card and changed the schedule.',
              intent: 'saved_card_charge',
              actionType: 'charge_saved_card',
              approvalRequired: false,
              needsHuman: false,
              canAutoSend: true,
              confidence: 0.99,
              tone: 'good',
              reasons: ['Customer requested it.']
            })
          };
        }
      }
    };
    const sensitiveUsageData = {};
    const sensitivePlan = await openAiReplyPlan(sensitiveUsageData, { customer: 'Test Customer', body: 'Charge my card.' }, {
      customerName: 'Test Customer',
      openClaims: [],
      maintenance: [],
      applications: [],
      paymentRequests: [],
      cardSetupRequests: [],
      documents: [],
      tasks: [],
      latestMessages: []
    }, fallback);
    assert.strictEqual(sensitivePlan.approvalRequired, true, 'Server sanitizer must override an unsafe model approval decision.');
    assert.strictEqual(sensitivePlan.canAutoSend, false, 'Sensitive model output must never auto-send.');
    assert.strictEqual(requestCount, 2, 'Only the two intended model calls should reach the provider before the quota test.');

    const cappedReadiness = openAiProviderReadiness(sensitiveUsageData);
    assert.strictEqual(cappedReadiness.aiProviderBudgetLimited, true, 'Star readiness must surface an exhausted configured request cap.');
    assert.strictEqual(cappedReadiness.aiProviderStatus, 'OpenAI request cap reached', 'Star readiness must report the quota cap instead of claiming the provider is still available.');
    const quotaPlan = await openAiReplyPlan({}, { customer: 'Test Customer', body: 'Can you help with my payment?' }, {
      customerName: 'Test Customer',
      openClaims: [],
      maintenance: [],
      applications: [],
      paymentRequests: [],
      cardSetupRequests: [],
      documents: [],
      tasks: [],
      latestMessages: []
    }, fallback);
    assert.strictEqual(quotaPlan.provider, 'rules', 'Star must fall back to rules after reaching its configured request cap.');
    assert.match(String(quotaPlan.providerError || ''), /request limit/i, 'The fallback must explain that the model-request cap was reached.');
    assert.strictEqual(requestCount, 2, 'A capped Star request must not call the provider.');

    console.log('Star provider runtime check passed: strict OpenAI output, approval gates, and request-cap fallback are verified.');
  } finally {
    global.fetch = originalFetch;
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
