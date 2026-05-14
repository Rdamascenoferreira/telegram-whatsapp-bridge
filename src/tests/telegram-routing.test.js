import test from 'node:test';
import assert from 'node:assert/strict';
import { __telegramRoutingTestUtils } from '../services/telegram/routing.js';

const {
  buildTelegramChatRefCandidates,
  getTelegramUserMessageChatRefs,
  normalizeTelegramChatRef
} = __telegramRoutingTestUtils;

test('getTelegramUserMessageChatRefs extracts ids from GramJS peer-like objects', () => {
  const refs = getTelegramUserMessageChatRefs({
    peerId: {
      className: 'PeerChannel',
      channelId: {
        value: 1124239751n,
        toString() {
          return '1124239751';
        }
      }
    },
    chatId: {
      value: -1001124239751n,
      toString() {
        return '-1001124239751';
      }
    }
  });

  assert.deepEqual(refs, ['1124239751', '-1001124239751']);
});

test('buildTelegramChatRefCandidates expands Telegram channel ids across saved formats', () => {
  assert.deepEqual(buildTelegramChatRefCandidates('1124239751'), [
    '1124239751',
    '-1124239751',
    '-1001124239751'
  ]);
  assert.deepEqual(buildTelegramChatRefCandidates('-1001124239751'), [
    '-1001124239751',
    '1124239751',
    '-1124239751'
  ]);
});

test('normalizeTelegramChatRef treats channel id formats as the same source', () => {
  assert.equal(normalizeTelegramChatRef('-1001124239751'), '1124239751');
  assert.equal(normalizeTelegramChatRef('-1124239751'), '1124239751');
  assert.equal(normalizeTelegramChatRef('1124239751'), '1124239751');
});
