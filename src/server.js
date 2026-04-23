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

app.use(express.json({ limit: '2mb' }));
app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'telegram-whatsapp-bridge',
    environment: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
auth.configure(app);
await bridge.init();
bridge.attachRoutes(app);

app.listen(port, () => {
  console.log(`Telegram -> WhatsApp bridge listening on http://localhost:${port}`);
});
