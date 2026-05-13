import test from 'node:test';
import assert from 'node:assert/strict';
import { processAffiliateMessage } from '../affiliate-message-processor.js';
import { convertShopeeLink } from '../converters/shopee-affiliate-converter.js';
import { rewriteAffiliateMessageWithGroq } from '../groq-rewriter.js';
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
  amazonShortenerEnabled: false,
  shopeeEnabled: false
};

test('processAffiliateMessage converts Amazon and removes obvious footer/community links', async () => {
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
  assert.doesNotMatch(result.processedMessage, /https:\/\/linktr\.ee\/mc8mb/);
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

test('processAffiliateMessage ignores footer/community unknown links without dropping the whole message', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: { ...automation, unknownLinkBehavior: 'ignore_message' },
    account,
    dryRun: true,
    message: [
      '[Amazon] Mouse Gamer',
      'Link produto: jogobara.to/abc123',
      'R$ 129,90',
      '',
      'Visite nosso insta:',
      'https://instagram.com/canal.ofertas'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('jogobara.to')
        ? 'https://www.amazon.com.br/dp/B0ABC12345?tag=old-20'
        : url,
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.shouldSend, true);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
  assert.doesNotMatch(result.processedMessage, /instagram\.com/i);
});

test('processAffiliateMessage converts real Telegram entity URLs hidden behind anchor text', async () => {
  const text = 'Oferta especial: clique aqui';
  const displayText = 'clique aqui';
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account,
    dryRun: true,
    message: text,
    telegramMessage: {
      message: text,
      entities: [
        {
          className: 'MessageEntityTextUrl',
          offset: text.indexOf(displayText),
          length: displayText.length,
          url: 'https://amzn.to/abc'
        }
      ]
    },
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.processedMessage, 'Oferta especial: https://www.amazon.com.br/dp/B0ABC12345?tag=tagdocliente-20');
  assert.deepEqual(result.originalUrls, ['https://amzn.to/abc']);
});

test('processAffiliateMessage keeps coupon links and converts the product link', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account,
    dryRun: true,
    message: [
      'Produto em oferta',
      'Resgate todos os cupons:',
      'https://amzn.to/cupom',
      '',
      'Link do Produto',
      'https://amzn.to/produto'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('produto')
        ? 'https://www.amazon.com.br/produto/dp/B0PROD1234?tag=old-20'
        : 'https://www.amazon.com.br/cupons/dp/B0CUPOM123?tag=old-20',
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /https:\/\/amzn\.to\/cupom/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0PROD1234\?tag=tagdocliente-20/);
  assert.doesNotMatch(result.processedMessage, /B0CUPOM123/);
});

test('processAffiliateMessage converts Shopee coupon and product links in the same message', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account: {
      ...account,
      amazonEnabled: false,
      shopeeEnabled: true,
      shopeeAffiliateId: '18393040998',
      shopeeAppId: '18393040998',
      shopeeSecret: 'secret'
    },
    dryRun: true,
    message: [
      'Monitor Gamer Mancer Valak Z3HS',
      '',
      'Resgate todos os cupons desta pagina:',
      'https://s.shopee.com.br/r5Ap5BA6iRH',
      '',
      'Link produto:',
      'https://s.shopee.com.br/2BBTcElWTy'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url,
      success: true
    }),
    convertShopeeLinkFn: async (url) => ({
      success: true,
      marketplace: 'shopee',
      originalExpandedUrl: url,
      affiliateUrl: url.includes('r5Ap5BA6iRH')
        ? 'https://s.shopee.com.br/cupom-convertido'
        : 'https://s.shopee.com.br/produto-convertido',
      affiliateId: '18393040998',
      subIds: {
        subId1: 'u245',
        subId2: 'telegram',
        subId3: 'captacao01',
        subId4: 'whatsapp01',
        subId5: 'auto'
      },
      utmContent: 'u245-telegram-captacao01-whatsapp01-auto'
    })
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /https:\/\/s\.shopee\.com\.br\/cupom-convertido/);
  assert.match(result.processedMessage, /https:\/\/s\.shopee\.com\.br\/produto-convertido/);
  assert.equal(result.convertedUrls.filter((item) => item.status === 'converted').length, 2);
});

test('processAffiliateMessage accepts marketplace provider override for extensibility', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account,
    dryRun: true,
    message: 'Oferta https://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    }),
    marketplaceProviders: {
      amazon: async ({ originalUrl, expandedUrl }) => ({
        originalUrl,
        expandedUrl,
        marketplace: 'amazon',
        status: 'converted',
        affiliateUrl: 'https://short.example/amz'
      })
    }
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.processedMessage, 'Oferta https://short.example/amz');
  assert.equal(result.convertedUrls[0].affiliateUrl, 'https://short.example/amz');
});

test('processAffiliateMessage shortens converted Amazon link when shortener is available', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account: { ...account, amazonShortenerEnabled: true },
    dryRun: true,
    message: 'Oferta https://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    }),
    shortenUrlFn: async () => 'https://is.gd/abc123'
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.processedMessage, 'Oferta https://is.gd/abc123');
  assert.equal(result.convertedUrls[0].affiliateUrl, 'https://is.gd/abc123');
});

test('processAffiliateMessage keeps Amazon affiliate link when shortener fails', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account: { ...account, amazonShortenerEnabled: true },
    dryRun: true,
    message: 'Oferta https://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    }),
    shortenUrlFn: async () => {
      throw new Error('shortener unavailable');
    }
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
  assert.equal(
    result.convertedUrls[0].affiliateUrl,
    'https://www.amazon.com.br/dp/B0ABC12345?tag=tagdocliente-20'
  );
});

test('processAffiliateMessage does not shorten Amazon link when account shortener is disabled', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation,
    account: { ...account, amazonShortenerEnabled: false },
    dryRun: true,
    message: 'Oferta https://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    }),
    shortenUrlFn: async () => 'https://is.gd/abc123'
  });

  assert.equal(result.status, 'converted');
  assert.equal(
    result.convertedUrls[0].affiliateUrl,
    'https://www.amazon.com.br/dp/B0ABC12345?tag=tagdocliente-20'
  );
});

test('processAffiliateMessage removes unsupported marketplace blocks when preserve mode is enabled', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      preserveOriginalTextEnabled: true,
      unknownLinkBehavior: 'remove'
    },
    account: {
      ...account,
      amazonEnabled: false,
      shopeeEnabled: true,
      shopeeAffiliateId: '18393040998',
      shopeeAppId: '18393040998',
      shopeeSecret: 'secret'
    },
    dryRun: true,
    message: [
      'PRAGMATA - Nintendo Switch 2',
      '',
      'Kabum',
      '👉 https://desconto.games/CV5YyB8',
      '🏷 Cupom: PARTYTIME',
      'R$ 292,11 no PIX',
      'R$ 314,10 em até 10x',
      '',
      'Shopee',
      'Resgate o cupom de R$ 40 OFF',
      '👉 https://s.shopee.com.br/8095klGUHF',
      '',
      'Compre aqui:',
      '👉 https://s.shopee.com.br/6VKGPnyEBv',
      'R$ 309,89 em até 6x'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url,
      success: true
    }),
    convertShopeeLinkFn: async (url) => ({
      success: true,
      marketplace: 'shopee',
      originalExpandedUrl: url,
      affiliateUrl: url.includes('8095klGUHF')
        ? 'https://s.shopee.com.br/cupom-convertido'
        : 'https://s.shopee.com.br/produto-convertido',
      affiliateId: '18393040998',
      subIds: {
        subId1: 'u245',
        subId2: 'telegram',
        subId3: 'captacao01',
        subId4: 'whatsapp01',
        subId5: 'auto'
      },
      utmContent: 'u245-telegram-captacao01-whatsapp01-auto'
    })
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /PRAGMATA - Nintendo Switch 2/);
  assert.match(result.processedMessage, /\bShopee\b/);
  assert.doesNotMatch(result.processedMessage, /\bKabum\b/);
  assert.doesNotMatch(result.processedMessage, /PARTYTIME/);
  assert.doesNotMatch(result.processedMessage, /R\$ 292,11 no PIX/);
  assert.match(result.processedMessage, /https:\/\/s\.shopee\.com\.br\/cupom-convertido/);
  assert.match(result.processedMessage, /https:\/\/s\.shopee\.com\.br\/produto-convertido/);
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

test('beautifyAffiliateMessage removes standalone coupon and price labels', () => {
  const result = beautifyAffiliateMessage(
    [
      'Placa Mae Maxsun Challenger B850M-K WIFI, Chipset B850, AMD AM5',
      '',
      'Resgate os cupons',
      'https://s.shopee.com.br/cupom',
      '',
      'Link do Produto',
      'https://s.shopee.com.br/produto',
      '',
      'PRECO:',
      'R$ 573',
      '',
      'Participe do nosso outro grupo de ofertas',
      'Promocoes gerais - https://t.me/huskypromocoes',
      '#anuncio'
    ].join('\n'),
    { style: 'clean' }
  );

  assert.match(result, /Placa Mae Maxsun Challenger/);
  assert.match(result, /R\$ 573/);
  assert.match(result, /Link da oferta:\nhttps:\/\/s\.shopee\.com\.br\/produto/);
  assert.doesNotMatch(result, /Resgate os cupons/);
  assert.doesNotMatch(result, /PRECO:/);
  assert.doesNotMatch(result, /Participe do nosso outro grupo/);
  assert.doesNotMatch(result, /Promocoes gerais/);
  assert.doesNotMatch(result, /#anuncio/);
});

test('beautifyAffiliateMessage builds output only from useful offer fields', () => {
  const result = beautifyAffiliateMessage(
    [
      'Placa Mae Maxsun Challenger B850M-K WIFI, Chipset B850, AMD AM5, mATX, DDR5',
      '',
      'Resgate os cupons',
      'https://s.shopee.com.br/cupom',
      '',
      'Link do Produto',
      'https://s.shopee.com.br/produto',
      '',
      'PRECO:',
      'R$ 573',
      '',
      'Participe do nosso outro grupo de ofertas',
      'Promocoes gerais - https://t.me/huskypromocoes',
      'Promocoes no Whatsapp (https://whatsapp.com/channel/abc)',
      '#anuncio'
    ].join('\n'),
    { style: 'clean' }
  );

  assert.match(result, /Oferta selecionada/);
  assert.match(result, /Placa Mae Maxsun Challenger/);
  assert.match(result, /R\$ 573/);
  assert.match(result, /Link da oferta:\nhttps:\/\/s\.shopee\.com\.br\/produto/);
  assert.match(result, /Cupons:\nhttps:\/\/s\.shopee\.com\.br\/cupom/);
  assert.doesNotMatch(result, /Promocoes gerais/);
  assert.doesNotMatch(result, /Promocoes no Whatsapp/);
  assert.doesNotMatch(result, /t\.me/);
  assert.doesNotMatch(result, /whatsapp\.com/);
  assert.doesNotMatch(result, /#anuncio/);
});

test('beautifyAffiliateMessage keeps pix and installment prices while ignoring source promo footer', () => {
  const result = beautifyAffiliateMessage(
    [
      '[Shopee] Controle Joy-Con 2 (Azul Claro/ Vermelho Claro)',
      '',
      'https://jogobara.to/KNJl4',
      'Cupom: G4NH3H',
      '• R$ 525,53 no pix',
      '• R$ 579,92 em ate 12x (no app)',
      '',
      'Canais de Promocoes do Jogo Barato (https://www.jogobarato.com.br/redes-sociais)',
      '',
      'https://s.shopee.com.br/produto'
    ].join('\n'),
    { style: 'clean' }
  );

  assert.match(result, /Controle Joy-Con 2/);
  assert.doesNotMatch(result, /\[Shopee\]/);
  assert.match(result, /R\$ 525,53 no pix/);
  assert.match(result, /R\$ 579,92 em ate 12x \(no app\)/);
  assert.match(result, /Cupom: G4NH3H/);
  assert.match(result, /Link da oferta:\nhttps:\/\/s\.shopee\.com\.br\/produto/);
  assert.doesNotMatch(result, /Jogo Barato/);
  assert.doesNotMatch(result, /redes-sociais/);
  assert.doesNotMatch(result, /jogobara\.to/);
});

test('beautifyAffiliateMessage extracts the actual coupon code from verbose coupon lines', () => {
  const result = beautifyAffiliateMessage(
    [
      'Cooler Master Hyper 212 Spectrum V3',
      '',
      'R$95',
      'Cupom EXCLUSIVO PRIME: 5D05PRIME -',
      '',
      'https://www.amazon.com.br/dp/B0BRBW94VL?tag=teste-20',
      '',
      'Convide Seus Amigos:',
      'Telegram: https://t.me/achadoshardware'
    ].join('\n'),
    { style: 'clean' }
  );

  assert.match(result, /Cupom: 5D05PRIME/);
  assert.doesNotMatch(result, /Cupom: EXCLUSIVO/);
  assert.doesNotMatch(result, /Convide Seus Amigos/);
});

test('beautifyAffiliateMessage scopes details to the preferred converted offer', () => {
  const amazonUrl = 'https://www.amazon.com.br/dp/B0BP2TGK6W?tag=tagdocliente-20';
  const result = beautifyAffiliateMessage(
    [
      'Playstation VR2',
      '',
      'Amazon - Desconto na Finalizacao',
      amazonUrl,
      'R$ 1.919,20 no Pix',
      'R$ 2.159,10 em ate 12x',
      '',
      'KaBuM!',
      'https://desconto.games/AWvXRVD',
      'Cupom: REALIDADENINJA',
      'R$ 1.934,10 a vista',
      'R$ 2.149,00 em ate 10x'
    ].join('\n'),
    {
      style: 'plain',
      primaryUrl: amazonUrl
    }
  );

  assert.match(result, /Playstation VR2/);
  assert.match(result, /R\$ 1\.919,20 no Pix/);
  assert.match(result, /R\$ 2\.159,10 em ate 12x/);
  assert.match(result, /Link da oferta:\nhttps:\/\/www\.amazon\.com\.br\/dp\/B0BP2TGK6W\?tag=tagdocliente-20/);
  assert.doesNotMatch(result, /REALIDADENINJA/);
  assert.doesNotMatch(result, /KaBuM/);
  assert.doesNotMatch(result, /desconto\.games/);
  assert.doesNotMatch(result, /R\$ 1\.934,10/);
});

test('beautifyAffiliateMessage preserves multiple product variants from the same offer', () => {
  const blackUrl = 'https://www.amazon.com.br/dp/B087CT8PWY?tag=tagdocliente-20';
  const whiteUrl = 'https://www.amazon.com.br/dp/B087CT9W2Y?tag=tagdocliente-20';
  const result = beautifyAffiliateMessage(
    [
      'Mouse Gamer Logitech G203 LIGHTSYNC RGB - (Amazon)',
      '',
      `Preto -> ${blackUrl}`,
      'R$ 91,90 no pix',
      'Frete Gratis Prime',
      '',
      `Branco -> ${whiteUrl}`,
      'R$108,90 em ate 3x',
      'Frete Gratis Prime'
    ].join('\n'),
    { style: 'urgent' }
  );

  assert.match(result, /Mouse Gamer Logitech G203 LIGHTSYNC RGB/);
  assert.match(result, /Opcoes disponiveis:/);
  assert.match(result, /Preto/);
  assert.match(result, /Branco/);
  assert.match(result, /R\$ 91,90 no pix/);
  assert.match(result, /R\$108,90 em ate 3x/);
  assert.match(result, /Frete Gratis Prime/);
  assert.match(result, /https:\/\/www\.amazon\.com\.br\/dp\/B087CT8PWY\?tag=tagdocliente-20/);
  assert.match(result, /https:\/\/www\.amazon\.com\.br\/dp\/B087CT9W2Y\?tag=tagdocliente-20/);
  assert.doesNotMatch(result, /\(Amazon\)/);
});

test('beautifyAffiliateMessage preserves separated multi-offer messages', () => {
  const result = beautifyAffiliateMessage(
    [
      'Jogos de PS5',
      '___',
      '',
      '- Death Stranding 2: On The Beach',
      '',
      '- Resgate o cupom de R$ 40:',
      'https://s.shopee.com.br/cupom',
      '',
      'R$ 236,42 no pix',
      'R$ 249,91 em ate 4x',
      '',
      'https://s.shopee.com.br/produto-1',
      '___',
      '',
      '- Gears of War: Reloaded',
      '',
      '- Resgate o cupom de R$ 40:',
      'https://s.shopee.com.br/cupom',
      '',
      'R$ 273,40 no pix',
      'R$ 289,89 em ate 5x',
      '',
      'https://s.shopee.com.br/produto-2',
      '___',
      '',
      'Grupo de Promocoes do Memory Card:',
      'https://linktr.ee/mc8mb'
    ].join('\n'),
    { style: 'plain' }
  );

  assert.match(result, /Jogos de PS5/);
  assert.match(result, /Death Stranding 2: On The Beach/);
  assert.match(result, /Gears of War: Reloaded/);
  assert.match(result, /R\$ 236,42 no pix/);
  assert.match(result, /R\$ 249,91 em ate 4x/);
  assert.match(result, /R\$ 273,40 no pix/);
  assert.match(result, /R\$ 289,89 em ate 5x/);
  assert.match(result, /Cupom: R\$ 40/);
  assert.match(result, /Link da oferta:\nhttps:\/\/s\.shopee\.com\.br\/produto-1/);
  assert.match(result, /Link da oferta:\nhttps:\/\/s\.shopee\.com\.br\/produto-2/);
  assert.doesNotMatch(result, /Links uteis/);
  assert.doesNotMatch(result, /linktr\.ee/);
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

test('processAffiliateMessage uses deterministic rewrite for multi-offer messages', async () => {
  let rewriteCalled = false;
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      aiRewriteEnabled: true,
      aiRewriteStyle: 'plain',
      messageBeautifierEnabled: true
    },
    account,
    dryRun: true,
    message: [
      'Jogos de PS5',
      '___',
      '',
      '- Produto A',
      'R$ 100 no pix',
      'https://amzn.to/produto-a',
      '___',
      '',
      '- Produto B',
      'R$ 200 no pix',
      'https://amzn.to/produto-b'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('produto-a')
        ? 'https://www.amazon.com.br/produto-a/dp/B0PRODA123?tag=old-20'
        : 'https://www.amazon.com.br/produto-b/dp/B0PRODB123?tag=old-20',
      success: true
    }),
    rewriteAffiliateMessageFn: async () => {
      rewriteCalled = true;
      return {
        success: true,
        provider: 'groq',
        model: 'mock',
        message: 'wrong'
      };
    }
  });

  assert.equal(rewriteCalled, false);
  assert.equal(result.rewriteMode, 'groq_fallback_local');
  assert.match(result.processedMessage, /Produto A/);
  assert.match(result.processedMessage, /Produto B/);
  assert.match(result.processedMessage, /B0PRODA123\?tag=tagdocliente-20/);
  assert.match(result.processedMessage, /B0PRODB123\?tag=tagdocliente-20/);
});

test('processAffiliateMessage can preserve original text and only replace converted links', async () => {
  let rewriteCalled = false;
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      preserveOriginalTextEnabled: true,
      aiRewriteEnabled: true,
      messageBeautifierEnabled: true,
      removeOriginalFooter: true,
      customFooter: 'Meu rodape'
    },
    account,
    dryRun: true,
    message: [
      'Jogos de PS5',
      '___',
      '',
      '- Produto A',
      'R$ 100 no pix',
      'https://amzn.to/produto-a',
      '___',
      '',
      'Grupo de Promocoes do Memory Card:',
      'https://linktr.ee/mc8mb'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('produto-a')
        ? 'https://www.amazon.com.br/produto-a/dp/B0PRODA123?tag=old-20'
        : url,
      success: true
    }),
    rewriteAffiliateMessageFn: async () => {
      rewriteCalled = true;
      return {
        success: true,
        provider: 'groq',
        model: 'mock',
        message: 'wrong'
      };
    }
  });

  assert.equal(rewriteCalled, false);
  assert.equal(result.status, 'converted');
  assert.equal(result.rewriteMode, 'link_replace_only');
  assert.match(result.processedMessage, /Jogos de PS5/);
  assert.match(result.processedMessage, /- Produto A/);
  assert.match(result.processedMessage, /R\$ 100 no pix/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0PRODA123\?tag=tagdocliente-20/);
  assert.match(result.processedMessage, /Meu rodape/);
  assert.doesNotMatch(result.processedMessage, /amzn\.to\/produto-a/);
  assert.doesNotMatch(result.processedMessage, /linktr\.ee\/mc8mb/);
  assert.doesNotMatch(result.processedMessage, /Oferta selecionada/);
});

test('processAffiliateMessage preserve mode removes source promo noise while keeping offer structure', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      preserveOriginalTextEnabled: true,
      removeOriginalFooter: false,
      customFooter: 'Meu rodape'
    },
    account,
    dryRun: true,
    message: [
      'Link produto:',
      'https://amzn.to/produto-a',
      '',
      'anuncio',
      '',
      'Convide Seus Amigos:',
      'Telegram: https://t.me/achadoshardware'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0PRODA123?tag=old-20',
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.rewriteMode, 'link_replace_only');
  assert.match(result.processedMessage, /Link produto:/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0PRODA123\?tag=tagdocliente-20/);
  assert.match(result.processedMessage, /Meu rodape/);
  assert.doesNotMatch(result.processedMessage, /\banuncio\b/i);
  assert.doesNotMatch(result.processedMessage, /Convide Seus Amigos/i);
  assert.doesNotMatch(result.processedMessage, /achadoshardware/i);
  assert.doesNotMatch(result.processedMessage, /t\.me\//i);
});

test('processAffiliateMessage preserve mode keeps only affiliable marketplace block in mixed message', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      preserveOriginalTextEnabled: true,
      customFooter: ''
    },
    account: {
      ...account,
      amazonEnabled: true,
      shopeeEnabled: true,
      shopeeAffiliateId: '18393040998',
      shopeeAppId: '18393040998',
      shopeeSecret: 'secret'
    },
    dryRun: true,
    message: [
      'PRAGMATA - Nintendo Switch 2',
      '',
      'Kabum',
      '👉 https://desconto.games/CV5YyB8',
      '🏷 Cupom: PARTYTIME',
      'R$ 292,11 no PIX',
      'R$ 314,10 em ate 10x',
      '',
      'Shopee',
      'Resgate o cupom de R$ 40 OFF',
      '👉 https://s.shopee.com.br/8095klGUHF',
      '',
      'Compre aqui:',
      '👉 https://s.shopee.com.br/6VKGPnyEBv',
      'R$ 309,89 em ate 6x'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url,
      success: true
    }),
    convertShopeeLinkFn: async (url) => ({
      success: true,
      marketplace: 'shopee',
      originalExpandedUrl: url,
      affiliateUrl: url.includes('8095klGUHF')
        ? 'https://s.shopee.com.br/cupom-afiliado'
        : 'https://s.shopee.com.br/produto-afiliado',
      affiliateId: '18393040998',
      subIds: {
        subId1: 'u245',
        subId2: 'telegram',
        subId3: 'captacao01',
        subId4: 'whatsapp01',
        subId5: 'auto'
      },
      utmContent: 'u245-telegram-captacao01-whatsapp01-auto'
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.rewriteMode, 'link_replace_only');
  assert.match(result.processedMessage, /PRAGMATA - Nintendo Switch 2/);
  assert.match(result.processedMessage, /Shopee/);
  assert.match(result.processedMessage, /Resgate o cupom de R\$ 40 OFF/);
  assert.match(result.processedMessage, /https:\/\/s\.shopee\.com\.br\/cupom-afiliado/);
  assert.match(result.processedMessage, /https:\/\/s\.shopee\.com\.br\/produto-afiliado/);
  assert.match(result.processedMessage, /R\$ 309,89 em ate 6x/);
  assert.doesNotMatch(result.processedMessage, /Kabum/i);
  assert.doesNotMatch(result.processedMessage, /PARTYTIME/);
  assert.doesNotMatch(result.processedMessage, /desconto\.games/i);
  assert.doesNotMatch(result.processedMessage, /R\$ 292,11/i);
});

test('processAffiliateMessage does not mix coupon from another marketplace block', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      messageBeautifierEnabled: true,
      messageBeautifierStyle: 'plain'
    },
    account,
    dryRun: true,
    message: [
      'Playstation VR2',
      '',
      'Amazon - Desconto na Finalizacao',
      'https://amzlink.to/az0UHEN1f86s8',
      'R$ 1.919,20 no Pix',
      'R$ 2.159,10 em ate 12x',
      '',
      'KaBuM!',
      'https://desconto.games/AWvXRVD',
      'Cupom: REALIDADENINJA',
      'R$ 1.934,10 a vista',
      'R$ 2.149,00 em ate 10x'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('amzlink.to')
        ? 'https://www.amazon.com.br/playstation-vr2/dp/B0BP2TGK6W?tag=old-20'
        : url,
      success: true
    })
  });

  assert.equal(result.status, 'converted');
  assert.match(result.processedMessage, /Playstation VR2/);
  assert.match(result.processedMessage, /R\$ 1\.919,20 no Pix/);
  assert.match(result.processedMessage, /R\$ 2\.159,10 em ate 12x/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0BP2TGK6W\?tag=tagdocliente-20/);
  assert.doesNotMatch(result.processedMessage, /REALIDADENINJA/);
  assert.doesNotMatch(result.processedMessage, /KaBuM/);
  assert.doesNotMatch(result.processedMessage, /desconto\.games/);
});

test('processAffiliateMessage uses Groq rewrite when enabled', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      aiRewriteEnabled: true,
      aiRewriteStyle: 'sales'
    },
    account,
    dryRun: true,
    message: 'Monitor Gamer\n\nCupom: QUINTOUU\nR$ 639,00\nhttps://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    }),
    rewriteAffiliateMessageFn: async () => ({
      success: true,
      provider: 'groq',
      model: 'mock',
      message: 'Oferta inteligente\n\nMonitor Gamer\n\nLink da oferta:\nhttps://www.amazon.com.br/dp/B0ABC12345?tag=tagdocliente-20'
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.rewriteMode, 'groq');
  assert.match(result.processedMessage, /Oferta inteligente/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
});

test('processAffiliateMessage keeps all converted Amazon variants after AI fallback', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      aiRewriteEnabled: true,
      aiRewriteStyle: 'urgent'
    },
    account,
    dryRun: true,
    message: [
      'Mouse Gamer Logitech G203 LIGHTSYNC RGB - (Amazon)',
      '',
      'Preto -> https://amzlink.to/preto',
      'R$ 91,90 no pix',
      'Frete Gratis Prime',
      '',
      'Branco -> https://amzlink.to/branco',
      'R$108,90 em ate 3x',
      'Frete Gratis Prime'
    ].join('\n'),
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: url.includes('preto')
        ? 'https://www.amazon.com.br/mouse-preto/dp/B087CT8PWY?tag=old-20'
        : 'https://www.amazon.com.br/mouse-branco/dp/B087CT9W2Y?tag=old-20',
      success: true
    }),
    rewriteAffiliateMessageFn: async () => ({
      success: false,
      provider: 'groq',
      model: 'mock',
      error: 'multiple variants'
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.rewriteMode, 'groq_fallback_local');
  assert.match(result.processedMessage, /Preto/);
  assert.match(result.processedMessage, /Branco/);
  assert.match(result.processedMessage, /R\$ 91,90 no pix/);
  assert.match(result.processedMessage, /R\$108,90 em ate 3x/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B087CT8PWY\?tag=tagdocliente-20/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B087CT9W2Y\?tag=tagdocliente-20/);
});

test('processAffiliateMessage falls back to local beautifier when Groq rewrite fails', async () => {
  const result = await processAffiliateMessage({
    userId: 'user-1',
    automationId: 'automation-1',
    automation: {
      ...automation,
      aiRewriteEnabled: true,
      aiRewriteStyle: 'plain'
    },
    account,
    dryRun: true,
    message: 'Monitor Gamer\n\nCupom: QUINTOUU\nR$ 639,00\nhttps://amzn.to/abc',
    expandUrlFn: async (url) => ({
      originalUrl: url,
      expandedUrl: 'https://www.amazon.com.br/produto/dp/B0ABC12345?tag=old-20',
      success: true
    }),
    rewriteAffiliateMessageFn: async () => ({
      success: false,
      provider: 'groq',
      model: 'mock',
      error: 'timeout'
    })
  });

  assert.equal(result.status, 'converted');
  assert.equal(result.rewriteMode, 'groq_fallback_local');
  assert.equal(result.rewriteError, 'timeout');
  assert.match(result.processedMessage, /Oferta selecionada/);
  assert.match(result.processedMessage, /https:\/\/www\.amazon\.com\.br\/dp\/B0ABC12345\?tag=tagdocliente-20/);
});

test('rewriteAffiliateMessageWithGroq keeps deterministic coupon when AI returns noisy coupon label', async () => {
  const result = await rewriteAffiliateMessageWithGroq({
    apiKey: 'test-key',
    model: 'mock-model',
    style: 'clean',
    message: 'Cooler Master Hyper 212 Spectrum V3\n\nR$95\nCupom EXCLUSIVO PRIME: 5D05PRIME -\n\nhttps://www.amazon.com.br/dp/B0BRBW94VL?tag=teste-20',
    fetchFn: async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: 'Cooler Master Hyper 212 Spectrum V3',
                  priceLine: 'Apenas R$95',
                  installmentLine: '',
                  couponCode: 'Cupom EXCLUSIVO PRIME'
                })
              }
            }
          ]
        })
    })
  });

  assert.equal(result.success, true);
  assert.match(result.message, /Cupom: 5D05PRIME/);
  assert.doesNotMatch(result.message, /Cupom: EXCLUSIVO/);
  assert.match(result.message, /Link da oferta:\nhttps:\/\/www\.amazon\.com\.br\/dp\/B0BRBW94VL\?tag=teste-20/);
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
