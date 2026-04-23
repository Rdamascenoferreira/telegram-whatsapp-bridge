# Ponte Telegram -> WhatsApp

Programa local para ler novos posts de um canal do Telegram e encaminhar para grupos do WhatsApp que voce escolher.

## Como funciona

- O painel agora pede login antes de liberar o acesso.
- O usuario pode criar conta com email e senha.
- O login com Google pode ser habilitado por configuracao no servidor.
- O lado Telegram usa um bot.
- O lado WhatsApp usa sua sessao do WhatsApp Web via QR Code.
- O painel local mostra apenas grupos onde sua conta atual aparece como admin.
- Voce marca os grupos desejados e salva.
- Quando chegar um novo post no canal configurado, a mensagem e encaminhada para esses grupos.

## O que esta versao faz

- Encaminha texto.
- Encaminha foto com legenda.
- Encaminha video com legenda.
- Encaminha documento.
- Encaminha albums simples do Telegram.
- Login com email e senha.
- Sessao persistente com botao de sair.
- Estrutura pronta para login com Google.
- Isola configuracao por usuario.
- Isola a sessao do WhatsApp por usuario.

## Como rodar

```powershell
cd "C:\Users\Rod&Ju\Documents\Codex\2026-04-23-oi\telegram-whatsapp-bridge"
npm.cmd install
npm.cmd start
```

Abra:

```text
http://localhost:3100
```

Na primeira vez, crie sua conta na tela inicial antes de acessar o painel.

## Configuracao

1. Crie sua conta com email e senha na tela inicial.
2. Crie um bot no Telegram com o `@BotFather`.
3. Adicione esse bot como administrador do canal do Telegram.
4. No painel local, cole o token do bot.
5. Informe o canal como `@username` ou ID `-100...`.
6. Escaneie o QR Code do WhatsApp.
7. Atualize a lista de grupos e marque os grupos desejados.

## Login com Google

Se quiser habilitar o botao `Entrar com Google`, voce pode copiar o arquivo `.env.example` para `.env` e preencher:

```env
SESSION_SECRET=troque-por-um-segredo-forte
GOOGLE_CLIENT_ID=seu-client-id
GOOGLE_CLIENT_SECRET=seu-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3100/auth/google/callback
```

No PowerShell, voce pode fazer assim:

```powershell
cd "C:\Users\Rod&Ju\Documents\Codex\2026-04-23-oi\telegram-whatsapp-bridge"
Copy-Item .env.example .env
npm.cmd start
```

Se nao definir essas variaveis, o painel continua funcionando com cadastro por email e senha.

## Dados locais

- Usuarios ficam em `data/users.json`
- Cada workspace fica em `data/workspaces/<userId>/config.json`
- Historico e metricas ficam em `data/workspaces/<userId>/activity.json`
- A migracao da ponte antiga fica registrada em `data/migrations/legacy-workspace-owner.json`
- As sessoes do WhatsApp ficam separadas em `.wwebjs_auth/session-user-<userId>`

## Observacoes importantes

- Esta ponte usa `whatsapp-web.js`, que opera em cima do WhatsApp Web. Segundo a documentacao do projeto, isso reduz risco, mas nao garante que a conta nunca sera bloqueada.
- A API oficial do WhatsApp Business/Cloud API e focada em mensagens para usuarios/contatos; eu nao encontrei, nas fontes oficiais que consultei, uma documentacao primaria equivalente para esse caso de encaminhar para grupos arbitrarios escolhidos no seu WhatsApp pessoal. Por isso esta versao local usa sessao web.
- Primeira versao: nao tenta sincronizar edicoes posteriores do post no Telegram. Ela encaminha novos posts.

## Fontes consultadas

- Telegram Bot API: [core.telegram.org/bots/api](https://core.telegram.org/bots/api)
- Eventos `channel_post` em `node-telegram-bot-api`: [GitHub](https://github.com/yagop/node-telegram-bot-api/blob/master/doc/usage.md)
- `whatsapp-web.js`: [wwebjs.dev](https://wwebjs.dev/)
- `LocalAuth`: [docs.wwebjs.dev/LocalAuth.html](https://docs.wwebjs.dev/LocalAuth.html)
- `GroupChat.participants` e flags de admin: [docs.wwebjs.dev/GroupChat.html](https://docs.wwebjs.dev/GroupChat.html)
