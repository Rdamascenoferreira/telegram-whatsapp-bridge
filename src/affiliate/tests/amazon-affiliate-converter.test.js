import test from 'node:test';
import assert from 'node:assert/strict';
import { convertAmazonLink } from '../converters/amazon-affiliate-converter.js';

test('convertAmazonLink canonicalizes /dp/ links with user tag', () => {
  const result = convertAmazonLink(
    'https://www.amazon.com.br/Monitor-Gamer-LG-UltraGear/dp/B0ABC12345/ref=sr_1_1?tag=old-20',
    'meuteste-20'
  );

  assert.equal(result.success, true);
  assert.equal(result.affiliateUrl, 'https://www.amazon.com.br/dp/B0ABC12345?tag=meuteste-20');
});

test('convertAmazonLink handles /gp/product/ links', () => {
  const result = convertAmazonLink('https://amazon.com/gp/product/B012345678?psc=1', 'tag-20');

  assert.equal(result.affiliateUrl, 'https://amazon.com/dp/B012345678?tag=tag-20');
});

test('convertAmazonLink adds tag when ASIN is not found', () => {
  const result = convertAmazonLink('https://www.amazon.com.br/s?k=monitor&tag=old-20', 'tag-20');

  assert.equal(result.success, true);
  assert.equal(result.affiliateUrl, 'https://www.amazon.com.br/s?k=monitor&tag=tag-20');
});

test('convertAmazonLink returns controlled errors', () => {
  assert.equal(convertAmazonLink('not-a-url', 'tag-20').success, false);
  assert.equal(convertAmazonLink('https://amazon.com/dp/B012345678', '').error, 'Amazon affiliate tag is empty');
});
