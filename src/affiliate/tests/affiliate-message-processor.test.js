import test from 'node:test';
import assert from 'node:assert/strict';
import { processAffiliateMessage } from '../affiliate-message-processor.js';
import { convertShopeeLink } from '../converters/shopee-affiliate-converter.js';
import { buildShopeeSubIds, sanitizeSubId } from '../converters/shopee-subids.js';

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
  assert.deepEqual(requestPayload.body.variables.input.subIds, ['u245', 'telegram', 'grupo_de_captacao', 'whatsapp_vip', 'campanha_01']);
  assert.equal(result.affiliateId, '18393040998');
  assert.equal(result.utmContent, 'u245-telegram-grupo_de_captacao-whatsapp_vip-campanha_01');
  assert.match(requestPayload.headers.Authorization, /^SHA256 Credential=app-123, Timestamp=1714500000, Signature=[a-f0-9]{64}$/);
});

test('sanitizeSubId keeps safe tracking values only', () => {
  assert.equal(sanitizeSubId(' Grupo de Captação 01! ', 'origem'), 'grupo_de_captacao_01');
  assert.equal(sanitizeSubId('@@@', 'auto'), 'auto');
  assert.equal(sanitizeSubId('ABC 123_Oferta-VIP', 'auto'), 'abc_123_ofertavip');
  assert.equal(sanitizeSubId('x'.repeat(80), 'auto'), 'x'.repeat(40));
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
    subId3: 'grupo_origem',
    subId4: 'grupo_destino',
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
