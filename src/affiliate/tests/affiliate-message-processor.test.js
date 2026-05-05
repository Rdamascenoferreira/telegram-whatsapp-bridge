import test from 'node:test';
import assert from 'node:assert/strict';
import { processAffiliateMessage } from '../affiliate-message-processor.js';
import { convertShopeeLink } from '../converters/shopee-affiliate-converter.js';
import { buildShopeeSubIds, sanitizeSubId } from '../converters/shopee-subids.js';
import { beautifyAffiliateMessage } from '../message-beautifier.js';

const automation = {
  id: 'automation-1',
  name: 'Teste',
  isActive: true,
  unknownLinkBehavior: 'keep',
  customFooter: '',
  removeOriginalFooter: false,
  destinations: []
};

const account = {
  amazonEnabled: true,
  amazonTag: 'tagdocliente-20',
  shopeeEnabled: false
};

test('processAffiliateMessage converts Amazon and keeps unknown links', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account,
    dryRun: true,
    message: 'Oferta\nhttps://amzn.to/abc\n_\nhttps://linktr.ee/mc8mb',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('amzn.to') ? 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20' : url,
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.shouldSend, true);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
  assert.match(result.processedMessage, /https:\/\/linktr\.ee\/mc8mb/);
});

test('processAffiliateMessage ignores messages without links', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account,
    dryRun: true,
    message: 'Oferta sem link'
  });

  assert.equal(result.status, 'ignored');
  assert.equal(result.shouldSend, false);
});

test('processAffiliateMessage respects disabled Amazon conversion', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account: { ...account, amazonEnabled: false },
    dryRun: true,
    message: 'Oferta https://amazon.com.br/dp/B0ABC12345',
    expandUrlFn: async (url) => ({ originalUrl: url, expandedUrl: url, success: true })
  });

  assert.equal(result.status, 'ignored');
  assert.equal(result.processedMessage, 'Oferta https://amazon.com.br/dp/B0ABC12345');
});

test('processAffiliateMessage replaces converted links that were written without protocol', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account,
    dryRun: true,
    message: 'Oferta amzn.to/abc\nMais cupons: nerdofertas.com',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('amzn.to') ? 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20' : url,
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
  assert.doesNotMatch(result.processedMessage, /amzn\.to\/abc/);
  assert.match(result.processedMessage, /nerdofertas\.com/);
});

test('processAffiliateMessage removes unknown links that were written without protocol', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: { ...automation, unknownLinkBehavior: 'remove' },
    account: { ...account, amazonEnabled: false },
    dryRun: true,
    message: 'Mais cupons: nerdofertas.com'
  });

  assert.equal(result.status, 'ignored');
  assert.equal(result.processedMessage, 'Mais cupons:');
});

test('beautifyAffiliateMessage formats offer without changing converted links', () => {
  const result = beautifyAffiliateMessage(
    'Monitor Gamer TGT Altay TS6\n\nCupom: OFERTAOFF\nR$ 446\nhttps://s.shopee.com.br/abc123',
    { style: 'sales' }
  );

  assert.match(result, /Oferta garimpada/);
  assert.match(result, /Monitor Gamer TGT Altay TS6/);
  assert.match(result, /R\$ 446/);
  assert.match(result, /Cupom: OFERTAOFF/);
  assert.match(result, /https:\/\/s\.shopee\.com\.br\/abc123/);
});

test('beautifyAffiliateMessage supports plain style without emojis', () => {
  const result = beautifyAffiliateMessage(
    '🔥 Monitor Gamer TGT Altay TS6 😱\n\nCupom: OFERTAOFF\nR$ 446\nhttps://s.shopee.com.br/abc123',
    { style: 'plain' }
  );

  assert.match(result, /Oferta selecionada/);
  assert.match(result, /Monitor Gamer TGT Altay TS6/);
  assert.match(result, /R\$ 446/);
  assert.match(result, /Cupom: OFERTAOFF/);
  assert.match(result, /https:\/\/s\.shopee\.com\.br\/abc123/);
  assert.doesNotMatch(result, /[\p{Extended_Pictographic}\uFE0F]/u);
});

test('beautifyAffiliateMessage removes promotional footer lines from offer details', () => {
  const result = beautifyAffiliateMessage(
    [
      'Monitor Gamer TGT Altay TS6, 23.8 Pol, IPS, FHD, 1ms, 165Hz',
      '',
      'R$ 446',
      'Resgate todos os cupons desta pagina: s.shopee.com.br/50VePQsPMC',
      '',
      'https://s.shopee.com.br/5q4jmvCvmL',
      '',
      'Mais grupos de ofertas e cupons: nerdofertas.com'
    ].join('\n'),
    { style: 'plain' }
  );

  assert.match(result, /Monitor Gamer TGT Altay TS6/);
  assert.match(result, /R\$ 446/);
  assert.match(result, /Link da oferta:/);
  assert.doesNotMatch(result, /Mais grupos de ofertas e cupons:/);
  assert.doesNotMatch(result, /Resgate todos os cupons desta pagina:/);
});

test('beautifyAffiliateMessage prefers product link and drops loose labels', () => {
  const result = beautifyAffiliateMessage(
    [
      'Micro-ondas Panasonic 27L Prata 220v Mais Rapido Pratico e Limpo',
      '',
      'R$ 348',
      'Resgate todos os cupons desta pagina:',
      'https://s.shopee.com.br/cupom',
      '',
      'Link produto:',
      'https://s.shopee.com.br/produto',
      '',
      'anuncio',
      '',
      'Convide Seus Amigos:',
      'Telegram: https://t.me/achadoshardware'
    ].join('\n'),
    { style: 'clean' }
  );

  assert.match(result, /Micro-ondas Panasonic/);
  assert.match(result, /R\$ 348/);
  assert.match(result, /Link da oferta:\nhttps:\/\/s\.shopee\.com\.br\/produto/);
  assert.doesNotMatch(result, /Link produto:\s*anuncio/);
  assert.doesNotMatch(result, /\banuncio\b/);
  assert.doesNotMatch(result, /Convide Seus Amigos/);
});

test('processAffiliateMessage applies beautifier after link conversion', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      messageBeautifierEnabled: true,
      messageBeautifierStyle: 'urgent'
    },
    account,
    dryRun: true,
    message: 'Monitor Gamer\n\nCupom: QUINTOUU\nR$ 639,00\nhttps://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /Oferta relampago/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
  assert.doesNotMatch(result.processedMessage, /amzn\.to\/abc/);
});

test('convertShopeeLink requires Shopee API credentials', async () => {
  const result = await convertShopeeLink('https://www.shopee.com.br/produto', {
    affiliateId: 'abc'
  });

  assert.equal(result.success, false);
  assert.equal(result.error, 'Shopee App ID and Secret are required');
});

test('convertShopeeLink returns official short link from Shopee API', async () => {
  let requestPayload = null;
  const result = await convertShopeeLink('https://www.shopee.com.br/produto-i.123.456', {
    affiliateId: '18393040998',
    appId: 'app-123',
    secret: 'secret-123',
    userId: '245',
    sourceGroupName: 'Grupo de Captação',
    destinationGroupName: 'WhatsApp VIP',
    campaign: 'campanha_01',
    endpoint: 'https://open-api.affiliate.shopee.com.br/graphql',
    nowFn: () => 1714500000,
    fetchFn: async (_url, request) => {
      requestPayload = {
        headers: request.headers,
        body: JSON.parse(request.body)
      };

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            generateShortLink: {
              shortLink: 'https://s.shopee.com.br/8V5NST2cSf'
            }
          }
        })
      };
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.affiliateUrl, 'https://s.shopee.com.br/8V5NST2cSf');
  assert.match(requestPayload.body.query, /ShortLinkInput!/);
  assert.doesNotMatch(requestPayload.body.query, /GenerateShortLinkInput/);
  assert.equal(requestPayload.body.variables.input.originUrl, 'https://www.shopee.com.br/produto-i.123.456');
  assert.deepEqual(requestPayload.body.variables.input.subIds, ['u245', 'telegram', 'grupodecaptacao', 'whatsappvip', 'campanha01']);
  assert.equal(result.affiliateId, '18393040998');
  assert.equal(result.utmContent, 'u245-telegram-grupodecaptacao-whatsappvip-campanha01');
  assert.match(requestPayload.headers.Authorization, /^SHA256 Credential=app-123, Timestamp=1714500000, Signature=[a-f0-9]{64}$/);
});

test('sanitizeSubId keeps safe tracking values only', () => {
  assert.equal(sanitizeSubId(' Grupo de Captação 01! ', 'origem'), 'grupodecaptacao01');
  assert.equal(sanitizeSubId('@@@', 'auto'), 'auto');
  assert.equal(sanitizeSubId('ABC 123_Oferta-VIP', 'auto'), 'abc123ofertavip');
  assert.equal(sanitizeSubId('x'.repeat(80), 'auto'), 'x'.repeat(32));
});

test('buildShopeeSubIds does not repeat affiliate id by default', () => {
  const subIds = buildShopeeSubIds({
    userId: '245',
    sourceChannel: 'telegram',
    sourceGroupId: 'Grupo Origem',
    destinationGroupId: 'Grupo Destino',
    campaign: ''
  });

  assert.deepEqual(subIds, {
    subId1: 'u245',
    subId2: 'telegram',
    subId3: 'grupoorigem',
    subId4: 'grupodestino',
    subId5: 'auto'
  });
  assert.ok(!Object.values(subIds).includes('18393040998'));
});

test('convertShopeeLink works with generated fallback subids', async () => {
  let requestPayload = null;
  const result = await convertShopeeLink('https://www.shopee.com.br/produto-i.123.456', {
    affiliateId: '18393040998',
    appId: 'app-123',
    secret: 'secret-123',
    endpoint: 'https://open-api.affiliate.shopee.com.br/graphql',
    nowFn: () => 1714500000,
    fetchFn: async (_url, request) => {
      requestPayload = JSON.parse(request.body);

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            generateShortLink: {
              shortLink: 'https://s.shopee.com.br/fallback'
            }
          }
        })
      };
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.affiliateUrl, 'https://s.shopee.com.br/fallback');
  assert.deepEqual(requestPayload.variables.input.subIds, ['user', 'telegram', 'origem', 'destino', 'auto']);
});
