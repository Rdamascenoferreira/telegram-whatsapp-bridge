import crypto from 'node:crypto';
import pkg from 'whatsapp-web.js';

const { MessageMedia } = pkg;

export async function sendAffiliateMessageToWhatsAppGroups(runtime, whatsAppPayload, targetGroupIds, options = {}) {
  const messageText = whatsAppPayload.type === 'text' ? whatsAppPayload.text : whatsAppPayload.caption || '';
  const sourceKey = `affiliate:${options.automationId || 'automation'}:${options.telegramMessageId || hashText(messageText)}`;

  return await runtime.whatsAppDeliveryQueue.enqueue('affiliate-message', async ({ sendWithRetry, waitBetweenDeliveries }) => {
    const sent = [];
    const failed = [];
    const skipped = [];

    for (const groupId of targetGroupIds) {
      const deliveryKey = buildDeliveryKey({
        flow: 'affiliate',
        sourceKey,
        groupId,
        messageType: whatsAppPayload.type
      });

      if (runtime.hasRecentDelivery(deliveryKey)) {
        skipped.push({ groupId, reason: 'duplicate_delivery_key' });
        runtime.deliveryStats.skippedDuplicates += 1;
        continue;
      }

      const delivery = await sendWithRetry(async () => {
        if (whatsAppPayload.type === 'text') {
          await runtime.whatsAppClient.sendMessage(groupId, whatsAppPayload.text);
          return;
        }

        const media = new MessageMedia(whatsAppPayload.mimeType, whatsAppPayload.base64, whatsAppPayload.filename);
        await runtime.whatsAppClient.sendMessage(groupId, media, {
          caption: whatsAppPayload.caption || undefined
        });
      });

      if (delivery.ok) {
        runtime.markRecentDelivery(deliveryKey);
        sent.push({ groupId, attempt: delivery.attempt, type: whatsAppPayload.type });
      } else {
        if (delivery.errorClass === 'fatal') {
          runtime.deliveryStats.fatalFailures += 1;
        } else {
          runtime.deliveryStats.transientFailures += 1;
        }
        failed.push({
          groupId,
          error: delivery.error,
          type: whatsAppPayload.type,
          errorClass: delivery.errorClass || 'transient'
        });
      }

      await waitBetweenDeliveries();
    }

    return { sent, failed, skipped };
  });
}

export async function forwardPreparedMessagesToWhatsAppGroups(runtime, { prepared, targetGroupIds }) {
  return await runtime.whatsAppDeliveryQueue.enqueue('telegram-forward', async ({ sendWithRetry, waitBetweenDeliveries }) => {
    const sent = [];
    const failed = [];
    const skipped = [];

    for (const groupId of targetGroupIds) {
      for (const preparedItem of prepared) {
        const item = preparedItem.payload;
        const deliveryKey = buildDeliveryKey({
          flow: 'telegram_forward',
          sourceKey: preparedItem.sourceKey,
          groupId,
          messageType: item.type
        });

        if (runtime.hasRecentDelivery(deliveryKey)) {
          skipped.push({ groupId, type: item.type, reason: 'duplicate_delivery_key' });
          runtime.deliveryStats.skippedDuplicates += 1;
          continue;
        }

        const result = await sendWithRetry(async () => {
          if (item.type === 'text') {
            await runtime.whatsAppClient.sendMessage(groupId, item.text);
            return;
          }

          if (item.type === 'media') {
            const media = new MessageMedia(item.mimeType, item.base64, item.filename);
            await runtime.whatsAppClient.sendMessage(groupId, media, {
              caption: item.caption || undefined
            });
          }
        });

        if (result.ok) {
          runtime.markRecentDelivery(deliveryKey);
          sent.push({ groupId, attempt: result.attempt, type: item.type });
        } else {
          if (result.errorClass === 'fatal') {
            runtime.deliveryStats.fatalFailures += 1;
          } else {
            runtime.deliveryStats.transientFailures += 1;
          }
          failed.push({
            groupId,
            type: item.type,
            error: result.error,
            errorClass: result.errorClass || 'transient'
          });
        }
      }

      await waitBetweenDeliveries();
    }

    return { sent, failed, skipped };
  });
}

function buildDeliveryKey({ flow, sourceKey, groupId, messageType }) {
  return [
    String(flow || 'unknown'),
    String(sourceKey || 'unknown'),
    String(groupId || 'unknown'),
    String(messageType || 'unknown')
  ].join('|');
}

function hashText(value) {
  return crypto.createHash('sha1').update(String(value ?? '')).digest('hex').slice(0, 12);
}
