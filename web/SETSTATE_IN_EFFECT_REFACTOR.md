# Refactor Plan: `react-hooks/set-state-in-effect`

Base de mapeamento gerada em 2026-05-09 com:

```bash
node ./node_modules/eslint/bin/eslint.js app/page.tsx --format json --rule "react-hooks/set-state-in-effect:error"
```

## Ocorrências iniciais (12)

- `web/app/page.tsx:448` - bootstrap/polling de estado global.
- `web/app/page.tsx:1849` - controle de edição de credenciais Telegram.
- `web/app/page.tsx:1861` - reset de senha/etapa de auth Telegram.
- `web/app/page.tsx:2269` - sincronização do formulário de fluxos com estado salvo.
- `web/app/page.tsx:2299` - reset da revisão antes de salvar fluxo.
- `web/app/page.tsx:2874` - sincronização de seleção de grupos (painel 1).
- `web/app/page.tsx:3310` - sincronização de seleção de grupos (painel 2).
- `web/app/page.tsx:3328` - sincronização do toggle `disconnectWhatsAppOnLogout`.
- `web/app/page.tsx:4133` - reset de edição de regras de afiliado.
- `web/app/page.tsx:4137` - reset de edição de conta de afiliado.
- `web/app/page.tsx:4863` - sincronização de nome/avatar no painel de conta.

## Status atual

- Ocorrências restantes em `web/app/page.tsx`: **0**.
- Regra `react-hooks/set-state-in-effect` reativada no lint do projeto.

## Já resolvido

- `web/app/page.tsx:487` - efeito que chamava `setView('overview')` ao deslogar foi removido (redundante, a tela já renderiza `AuthScreen` quando não autenticado).

## Estratégia por categoria

1. **Bootstrap/polling (`:448`)**
- mover `loadState` para callback assíncrono local dentro do efeito com guarda de cancelamento.
- avaliar extração para `useBridgeStatePolling`.

2. **Reset de formulário (`:1849`, `:1861`, `:2299`, `:4133`, `:4137`)**
- substituir por `key` no componente/form para reset declarativo.
- usar estado derivado (`useMemo`) quando o valor vier direto do servidor.

3. **Sincronização de seleção (`:2874`, `:3310`, `:3328`, `:4863`)**
- migrar para abordagem "source of truth + dirty flag" sem espelhar estado em efeito.
- inicializar com `useState(() => ...)` e reconciliar apenas em ações de usuário.

4. **Sincronização de fluxo (`:2269`)**
- extrair para hook dedicado de edição de automação com inicialização por `automationId`.
