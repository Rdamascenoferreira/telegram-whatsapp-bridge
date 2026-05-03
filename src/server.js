import 'dotenv/config';
import express from 'express';
import { AuthService } from './authService.js';
import { BridgeApp } from './bridgeApp.js';

const port = Number(process.env.PORT ?? 3100);
const appBaseUrl = process.env.APP_BASE_URL ?? `http://localhost:${port}`;
const app = express();
const auth = new AuthService({
  sessionSecret: process.env.SESSION_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `${appBaseUrl}/auth/google/callback`
});
const bridge = new BridgeApp({ auth });

app.use(express.json({ limit: '4mb' }));
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

  if (error instanceof SyntaxError) {
    response.status(400).json({
      error: 'Não foi possível processar os dados enviados.'
    });
    return;
  }

  next(error);
});

app.listen(port, () => {
  console.log(`Telegram -> WhatsApp bridge listening on http://localhost:${port}`);
});

bridge.init().catch((error) => {
  console.error(`Bridge background initialization failed: ${error.message}`);
});
