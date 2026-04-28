# Frontend SaaS

Este diretorio contem a nova interface em Next.js para o painel do produto.

## Rodar localmente

1. Suba o backend principal na raiz do projeto:

```powershell
npm.cmd start
```

2. Em outro terminal, rode o frontend:

```powershell
cd "C:\Users\Rod&Ju\Documents\Codex\2026-04-23-oi\telegram-whatsapp-bridge\web"
node .\node_modules\next\dist\bin\next dev
```

3. Acesse:

```text
http://localhost:3000
```

O frontend usa `BACKEND_URL` para encaminhar `/api/*` e `/auth/*` para o backend. Em desenvolvimento, o padrao e `http://localhost:3100`.
