import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaileysWhatsAppClient } from '../services/whatsapp/baileysClient.js';

test('Baileys adapter sends images using Baileys media payloads', async () => {
  const sent = [];
  const client = createReadyClient(sent);

  await client.sendMediaMessage('123@g.us', {
    base64: Buffer.from('image-bytes').toString('base64'),
    mimeType: 'image/png',
    caption: 'Oferta'
  });

  assert.equal(sent[0].jid, '123@g.us');
  assert.equal(Buffer.isBuffer(sent[0].content.image), true);
  assert.equal(sent[0].content.mimetype, 'image/png');
  assert.equal(sent[0].content.caption, 'Oferta');
});

test('Baileys adapter sends GIFs as playable video messages', async () => {
  const sent = [];
  const client = createReadyClient(sent);

  await client.sendMediaMessage('123@g.us', {
    base64: Buffer.from('gif-bytes').toString('base64'),
    mimeType: 'image/gif',
    caption: 'Oferta animada'
  });

  assert.equal(Buffer.isBuffer(sent[0].content.video), true);
  assert.equal(sent[0].content.mimetype, 'image/gif');
  assert.equal(sent[0].content.gifPlayback, true);
});

test('Baileys adapter sends unknown media as documents', async () => {
  const sent = [];
  const client = createReadyClient(sent);

  await client.sendMediaMessage('123@g.us', {
    base64: Buffer.from('document-bytes').toString('base64'),
    mimeType: 'application/pdf',
    filename: 'manual.pdf',
    caption: 'Manual'
  });

  assert.equal(Buffer.isBuffer(sent[0].content.document), true);
  assert.equal(sent[0].content.mimetype, 'application/pdf');
  assert.equal(sent[0].content.fileName, 'manual.pdf');
  assert.equal(sent[0].content.caption, 'Manual');
});

function createReadyClient(sent) {
  const client = new BaileysWhatsAppClient({});
  client.ready = true;
  client.sock = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
    }
  };
  return client;
}
