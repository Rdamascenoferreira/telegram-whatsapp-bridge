import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMessageUrlMatches, rebuildMessageWithUrlReplacements } from '../telegram-message-links.js';

test('extractMessageUrlMatches reads real Telegram text URL entities', () => {
  const text = 'Oferta especial: clique aqui';
  const displayText = 'clique aqui';
  const message = {
    message: text,
    entities: [
      {
        className: 'MessageEntityTextUrl',
        offset: text.indexOf(displayText),
        length: displayText.length,
        url: 'https://s.shopee.com.br/40cnKMds5r'
      }
    ]
  };

  assert.deepEqual(extractMessageUrlMatches({ telegramMessage: message }), [
    {
      rawUrl: 'https://s.shopee.com.br/40cnKMds5r',
      normalizedUrl: 'https://s.shopee.com.br/40cnKMds5r',
      displayText,
      offset: text.indexOf(displayText),
      length: displayText.length,
      source: 'text_url'
    }
  ]);
});

test('rebuildMessageWithUrlReplacements replaces anchor text with affiliate URL', () => {
  const text = 'Oferta especial: clique aqui';
  const displayText = 'clique aqui';
  const matches = [
    {
      rawUrl: 'https://amzn.to/abc',
      normalizedUrl: 'https://amzn.to/abc',
      displayText,
      offset: text.indexOf(displayText),
      length: displayText.length,
      source: 'text_url'
    }
  ];
  const replacements = new Map([
    ['https://amzn.to/abc', 'https://www.amazon.com.br/dp/B0ABC12345?tag=tagdocliente-20']
  ]);

  assert.equal(
    rebuildMessageWithUrlReplacements(text, matches, replacements),
    'Oferta especial: https://www.amazon.com.br/dp/B0ABC12345?tag=tagdocliente-20'
  );
});

