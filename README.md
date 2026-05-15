# Ponte Telegram -> WhatsApp

Programa local para ler novos posts de um canal do Telegram e encaminhar para grupos do WhatsApp que voc? escolher.

## Como funciona

- O painel agora pede login antes de liberar o acesso.
- O usu?rio pode criar conta com email e senha.
- O login com Google pode ser habilitado por configura??o no servidor.
- O lado Telegram usa um bot.
- O lado WhatsApp usa QR Code com Baileys por padrao, sem abrir Chromium.
- O painel local mostra apenas grupos onde sua conta atual aparece como admin.
- Voce marca os grupos desejados e salva.
- Quando chegar um novo post no canal configurado, a mensagem e encaminhada para esses grupos.

## O que esta vers?o faz

- Encaminha texto.
- Encaminha foto com legenda.
- Encaminha video com legenda.
- Encaminha documento.
- Encaminha albums simples do Telegram.
- Login com email e senha.
- Sessao persistente com botao de sair.
- Estrutura pronta para login com Google.
- Isola configura??o por usu?rio.
- Isola a sess?o do WhatsApp por usu?rio.

## Como rodar

```powershell
cd "C:\Users\Rod&Ju\Documents\Codex\2026-04-23-oi\telegram-whatsapp-bridge"
npm.cmd install
npm.cmd start
```

Para usar o painel novo em Next.js, abra outro PowerShell:

```powershell
cd "C:\Users\Rod&Ju\Documents\Codex\2026-04-23-oi\telegram-whatsapp-bridge\web"
npm.cmd install
npm.cmd run dev
```

Abra o painel:

```text
http://localhost:3000
```

O backend continua em:

```text
http://localhost:3100
```

Na primeira vez, crie sua conta na tela inicial antes de acessar o painel. Se `FRONTEND_BASE_URL` estiver configurado, acessar `http://localhost:3100` redireciona para o painel Next. Sem frontend configurado, o backend mostra apenas uma pagina minima com o link do painel e o healthcheck.

## Configuracao

1. Crie sua conta com email e senha na tela inicial.
2. Configure sua sess?o de usu?rio do Telegram com API ID, API Hash e telefone.
3. Informe a origem do Telegram na aba Fluxos.
4. Escaneie o QR Code do WhatsApp.
5. Atualize a lista de grupos e marque os grupos desejados.

## Login com Google

Se quiser habilitar o botao `Entrar com Google`, voc? pode copiar o arquivo `.env.example` para `.env` e preencher:

```env
SESSION_SECRET=troque-por-um-segredo-forte
SESSION_STORE=file
SESSION_FILE_STORE_DIR=data/sessions
GOOGLE_CLIENT_ID=seu-client-id
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3100/auth/google/callback
APP_BASE_URL=http://localhost:3100
FRONTEND_BASE_URL=http://localhost:3000
APP_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
PORT=3100
NODE_ENV=production
WHATSAPP_HEADLESS=true
WHATSAPP_PROVIDER=baileys
WHATSAPP_PROTOCOL_TIMEOUT_MS=600000
```

No PowerShell, voc? pode fazer assim:

```powershell
cd "C:\Users\Rod&Ju\Documents\Codex\2026-04-23-oi\telegram-whatsapp-bridge"
Copy-Item .env.example .env
npm.cmd start
```

Se n?o definir essas variaveis, o painel continua funcionando com cadastro por email e senha.

## Ajuste para servidor AWS/Linux

O padrao atual usa Baileys (`WHATSAPP_PROVIDER=baileys`), que evita abrir Chromium e reduz bastante o uso de RAM/CPU apos escanear o QR Code. Se precisar voltar ao motor antigo por emergencia, configure:

```env
WHATSAPP_PROVIDER=web
```

No modo antigo com Chromium, se a conta tiver muitos chats e a leitura dos grupos demorar no servidor, aumente o tempo do protocolo:

```env
WHATSAPP_PROTOCOL_TIMEOUT_MS=600000
```

O valor e em milissegundos. Nesta vers?o, o padr?o ja foi elevado para `600000` (10 minutos), o que costuma ajudar em instancias Linux mais lentas.

## Deploy na AWS

Esta vers?o agora ja vem com:

- healthcheck em `/api/health`
- configura??o do PM2 em `ecosystem.config.cjs`
- script de bootstrap do Ubuntu em `scripts/install-ubuntu.sh`
- script de release em `scripts/deploy-release.sh`
- workflow do GitHub Actions em `.github/workflows/deploy-aws.yml`

### Preparacao inicial do servidor

Copie o script para a EC2 a partir da sua maquina local:

```bash
scp scripts/install-ubuntu.sh ubuntu@SEU_HOST:/tmp/install-ubuntu.sh
```

Depois, no servidor Ubuntu, rode uma vez:

```bash
chmod +x install-ubuntu.sh
APP_DIR=/var/www/telegram-whatsapp-bridge ./install-ubuntu.sh
```

Depois:

```bash
mkdir -p /var/www/telegram-whatsapp-bridge
cd /var/www/telegram-whatsapp-bridge
cp .env.example .env
```

Preencha o `.env` com as credenciais reais do servidor.

### Segredos no GitHub

No repositório do GitHub, crie estes `Repository secrets`:

- `AWS_DEPLOY_HOST`: IP ou dominio da EC2
- `AWS_DEPLOY_USER`: usu?rio SSH, por exemplo `ubuntu`
- `AWS_DEPLOY_PORT`: porta SSH, normalmente `22`
- `AWS_DEPLOY_PATH`: pasta do app no servidor, por exemplo `/var/www/telegram-whatsapp-bridge`
- `AWS_DEPLOY_SSH_KEY`: chave privada SSH usada para entrar na EC2
- `AWS_DEPLOY_PM2_APP_NAME`: opcional, nome do processo no PM2
- `AWS_DEPLOY_HEALTHCHECK_URL`: opcional, URL publica do healthcheck, por exemplo `https://seu-dominio.com/api/health`

### Como o deploy automatico funciona

Cada `push` na branch `main`:

1. monta um pacote da vers?o nova
2. envia esse pacote por SSH para a EC2
3. aplica a release no servidor sem sobrescrever `.env`, `data/`, `.wwebjs_auth/` e `.wwebjs_cache`
4. roda `npm ci --omit=dev`
5. reinicia a app com `pm2 startOrReload ecosystem.config.cjs --update-env`
6. opcionalmente testa `/api/health`

### Primeira subida no servidor

Voce n?o precisa fazer `git clone` na EC2 para o deploy automatico funcionar. Depois de:

- instalar as dependencias com `install-ubuntu.sh`
- criar o `.env`
- cadastrar os segredos no GitHub

voc? pode disparar o primeiro deploy em:

- `GitHub > Actions > Deploy AWS > Run workflow`

Depois disso, cada `push` na `main` atualiza o servidor automaticamente.

## Dados locais

- Usu?rios ficam em `data/users.json`
- Cada workspace fica em `data/workspaces/<userId>/config.json`
- Hist?rico e m?tricas ficam em `data/workspaces/<userId>/activity.json`
- A migracao da ponte antiga fica registrada em `data/migrations/legacy-workspace-owner.json`
- As sessoes do WhatsApp ficam separadas em `.wwebjs_auth/baileys-user-<userId>` no provider Baileys e em `.wwebjs_auth/session-user-<userId>` no provider antigo.

Quando `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estiverem configurados, usu?rios e perfis passam a ser lidos e gravados no Supabase. O schema esperado fica em `scripts/supabase-auth-schema.sql`.

## Observacoes importantes

- Esta ponte usa Baileys por padrao e mantem `whatsapp-web.js` como fallback via `WHATSAPP_PROVIDER=web`. Ambos operam em cima de sessao web/multi-device e nao garantem que a conta nunca sera bloqueada.
- A API oficial do WhatsApp Business/Cloud API e focada em mensagens para usu?rios/contatos; eu n?o encontrei, nas fontes oficiais que consultei, uma documentacao primaria equivalente para esse caso de encaminhar para grupos arbitrarios escolhidos no seu WhatsApp pessoal. Por isso esta vers?o local usa sess?o web.
- O modo antigo com bot do Telegram foi removido; o runtime atual usa sess?o de usu?rio do Telegram.
- Primeira vers?o: n?o tenta sincronizar edicoes posteriores do post no Telegram. Ela encaminha novos posts.

## Fontes consultadas

- Telegram user sessions / GramJS: [gram.js.org](https://gram.js.org/)
- Baileys: [github.com/WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)
- `whatsapp-web.js`: [wwebjs.dev](https://wwebjs.dev/)
- `LocalAuth`: [docs.wwebjs.dev/LocalAuth.html](https://docs.wwebjs.dev/LocalAuth.html)
- `GroupChat.participants` e flags de admin: [docs.wwebjs.dev/GroupChat.html](https://docs.wwebjs.dev/GroupChat.html)
