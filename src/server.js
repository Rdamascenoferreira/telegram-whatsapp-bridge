import 'dotenv/config';
import express from 'express';
import { AuthService } from './authService.js';
import { BridgeApp } from './bridgeApp.js';

const port = Number(process.env.PORT ?? 3100);
const appBaseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;
const frontendBaseUrl = String(process.env.FRONTEND_BASE_URL ?? '').trim().replace(/\/$/, '');
const allowedOrigins = [
  frontendBaseUrl,
  process.env.APP_ALLOWED_ORIGINS,
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]
  .flatMap((value) => String(value ?? '').split(','))
  .map((value) => value.trim())
  .filter(Boolean);
const app = express();
const jsonParser = express.json({ limit: '4mb' });
const auth = new AuthService({
  sessionSecret: process.env.SESSION_SECRET,
  appBaseUrl,
  allowedOrigins,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `${appBaseUrl}/auth/google/callback`
});
const bridge = new BridgeApp({ auth, frontendBaseUrl });

if (appBaseUrl.startsWith('https://')) {
  app.set('trust proxy', 1);
}

app.use((request, response, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    jsonParser(request, response, next);
    return;
  }

  next();
});
app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'telegram-whatsapp-bridge',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    ...bridge.getHealthSnapshot(),
    timestamp: new Date().toISOString()
  });
});
auth.configure(app);
bridge.attachRoutes(app);

app.use((error, _request, response, next) => {
  if (!error) {
    next();
    return;
  }

  if (error.type === 'entity.too.large') {
    response.status(413).json({
      error: 'A imagem enviada é grande demais. Use um arquivo com até 1 MB.'
    });
    return;
  }

  if (error instanceof SyntaxError && error.type === 'entity.parse.failed') {
    response.status(400).json({
      error: 'Não foi possível processar os dados enviados.'
    });
    return;
  }

  next(error);
});

app.use((error, _request, response, _next) => {
  console.error(error);

  if (response.headersSent) {
    return;
  }

  response.status(error.status || error.statusCode || 500).json({
    error: error.message || 'Nao foi possivel concluir a acao.',
    ...(error.code ? { code: error.code } : {}),
    ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
  });
});

app.listen(port, () => {
  console.log(`Telegram -> WhatsApp bridge listening on http://localhost:${port}`);
});

bridge.init().catch((error) => {
  console.error(`Bridge background initialization failed: ${error.message}`);
});
