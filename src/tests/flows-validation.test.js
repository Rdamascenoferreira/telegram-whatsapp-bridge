import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAffiliateAutomationFieldErrors } from '../bridgeApp.js';

test('computeAffiliateAutomationFieldErrors returns required field errors', () => {
  const fieldErrors = computeAffiliateAutomationFieldErrors({
    payload: {
      telegramSourceGroupId: '',
      destinations: []
    },
    runtimeTelegramStatus: 'auth_required',
    automations: []
  });

  assert.equal(fieldErrors.telegram, 'Conclua o login do Telegram antes de salvar o fluxo.');
  assert.equal(fieldErrors.telegramSourceGroupId, 'Escolha uma origem do Telegram para este fluxo.');
  assert.equal(fieldErrors.destinations, 'Selecione ao menos um grupo de destino no WhatsApp.');
});

test('computeAffiliateAutomationFieldErrors detects duplicate source in another flow', () => {
  const fieldErrors = computeAffiliateAutomationFieldErrors({
    payload: {
      telegramSourceGroupId: '-100123',
      destinations: [{ whatsappGroupId: 'group-a' }]
    },
    runtimeTelegramStatus: 'listening',
    automations: [
      {
        id: 'flow-1',
        name: 'Fluxo VIP',
        telegramSourceGroupId: '-100123'
      }
    ]
  });

  assert.match(String(fieldErrors.telegramSourceGroupId || ''), /Fluxo VIP/);
  assert.equal(fieldErrors.telegram, undefined);
  assert.equal(fieldErrors.destinations, undefined);
});

test('computeAffiliateAutomationFieldErrors allows same source for current flow id', () => {
  const fieldErrors = computeAffiliateAutomationFieldErrors({
    payload: {
      id: 'flow-1',
      telegramSourceGroupId: '-100123',
      destinations: [{ whatsappGroupId: 'group-a' }]
    },
    runtimeTelegramStatus: 'listening',
    automations: [
      {
        id: 'flow-1',
        name: 'Fluxo VIP',
        telegramSourceGroupId: '-100123'
      }
    ]
  });

  assert.deepEqual(fieldErrors, {});
});
