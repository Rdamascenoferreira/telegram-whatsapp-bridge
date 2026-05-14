export async function prepareWhatsAppPayload(runtime, message) {
  if (message.__telegramSource === 'user_session') {
    return prepareWhatsAppPayloadFromTelegramUser(message);
  }

  const caption = message.caption || '';

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    return downloadTelegramBotMedia(runtime, photo.file_id, {
      mimeType: 'image/jpeg',
      filename: `telegram-photo-${message.message_id}.jpg`,
      caption
    });
  }

  if (message.video?.file_id) {
    return downloadTelegramBotMedia(runtime, message.video.file_id, {
      mimeType: message.video.mime_type || 'video/mp4',
      filename: message.video.file_name || `telegram-video-${message.message_id}.mp4`,
      caption
    });
  }

  if (message.document?.file_id) {
    return downloadTelegramBotMedia(runtime, message.document.file_id, {
      mimeType: message.document.mime_type || 'application/octet-stream',
      filename: message.document.file_name || `telegram-document-${message.message_id}`,
      caption
    });
  }

  if (message.animation?.file_id) {
    return downloadTelegramBotMedia(runtime, message.animation.file_id, {
      mimeType: message.animation.mime_type || 'image/gif',
      filename: message.animation.file_name || `telegram-animation-${message.message_id}.gif`,
      caption
    });
  }

  const text = message.text || caption || fallbackText(message);

  return {
    type: 'text',
    text
  };
}

export async function downloadTelegramBotMedia(runtime, fileId, metadata) {
  const fileUrl = await runtime.telegramBot.getFileLink(fileId);
  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(`Não foi possível baixar a mídia do Telegram (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    type: 'media',
    base64: buffer.toString('base64'),
    mimeType: metadata.mimeType,
    filename: metadata.filename,
    caption: metadata.caption
  };
}

export async function prepareWhatsAppPayloadFromTelegramUser(message) {
  const rawMessage = message.rawMessage;
  const caption = rawMessage?.text || rawMessage?.message || message.caption || '';
  const messageId = getTelegramMessageNumericId(message);

  if (rawMessage?.photo) {
    return downloadTelegramUserMedia(rawMessage, {
      mimeType: 'image/jpeg',
      filename: `telegram-photo-${messageId}.jpg`,
      caption
    });
  }

  if (rawMessage?.video) {
    return downloadTelegramUserMedia(rawMessage, {
      mimeType: rawMessage.video.mimeType || 'video/mp4',
      filename: inferTelegramFilename(rawMessage) || `telegram-video-${messageId}.mp4`,
      caption
    });
  }

  if (rawMessage?.document) {
    return downloadTelegramUserMedia(rawMessage, {
      mimeType: rawMessage.document.mimeType || 'application/octet-stream',
      filename: inferTelegramFilename(rawMessage) || `telegram-document-${messageId}`,
      caption
    });
  }

  if (rawMessage?.gif) {
    return downloadTelegramUserMedia(rawMessage, {
      mimeType: rawMessage.gif.mimeType || 'image/gif',
      filename: inferTelegramFilename(rawMessage) || `telegram-animation-${messageId}.gif`,
      caption
    });
  }

  const text = rawMessage?.text || rawMessage?.message || fallbackText(message);

  return {
    type: 'text',
    text
  };
}

export async function downloadTelegramUserMedia(rawMessage, metadata) {
  const buffer = await rawMessage.downloadMedia({});

  if (!buffer) {
    throw new Error('Não foi possível baixar a mídia da sessão do Telegram.');
  }

  return {
    type: 'media',
    base64: Buffer.from(buffer).toString('base64'),
    mimeType: metadata.mimeType,
    filename: metadata.filename,
    caption: metadata.caption
  };
}

export function fallbackText(message) {
  if (message?.rawMessage?.poll) {
    return `Enquete do Telegram: ${message.rawMessage.poll.question}`;
  }

  if (message?.rawMessage?.location) {
    return `Localizacao recebida do Telegram: ${message.rawMessage.location.latitude}, ${message.rawMessage.location.longitude}`;
  }

  if (message.poll) {
    return `Enquete do Telegram: ${message.poll.question}`;
  }

  if (message.location) {
    return `Localizacao recebida do Telegram: ${message.location.latitude}, ${message.location.longitude}`;
  }

  return 'Mensagem encaminhada do Telegram.';
}

export function getTelegramMessageNumericId(message) {
  return Number(message?.message_id ?? message?.id ?? message?.rawMessage?.id ?? 0);
}

export function inferTelegramFilename(message) {
  const attributes = Array.isArray(message?.document?.attributes)
    ? message.document.attributes
    : Array.isArray(message?.rawMessage?.document?.attributes)
      ? message.rawMessage.document.attributes
      : [];
  const attributeWithName = attributes.find((attribute) => attribute?.fileName);
  return String(attributeWithName?.fileName || '').trim();
}
