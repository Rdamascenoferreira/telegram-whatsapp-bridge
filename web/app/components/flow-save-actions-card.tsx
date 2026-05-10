import { RefreshCcw } from 'lucide-react';

type FlowSaveActionsCardProps = {
  readOnlyAccount: boolean;
  busy: string;
  isAutomationEditing: boolean;
  selectedRouteSource: string;
  hasPendingFlowChanges: boolean;
  shouldShowFlowReview: boolean;
  telegramFlow: 'bridge' | 'affiliate';
  selectedSourceName: string;
  selectedWhatsAppDestinationCount: number;
  telegramForwardLabel: string;
  pendingFlowChanges: string[];
  onEditOrSubmit: () => void;
  onCancelReview: () => void;
  onRefreshOrigins: () => Promise<void>;
  primaryButtonClassName: string;
  secondaryButtonClassName: string;
};

export function FlowSaveActionsCard({
  readOnlyAccount,
  busy,
  isAutomationEditing,
  selectedRouteSource,
  hasPendingFlowChanges,
  shouldShowFlowReview,
  telegramFlow,
  selectedSourceName,
  selectedWhatsAppDestinationCount,
  telegramForwardLabel,
  pendingFlowChanges,
  onEditOrSubmit,
  onCancelReview,
  onRefreshOrigins,
  primaryButtonClassName,
  secondaryButtonClassName
}: FlowSaveActionsCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-black/10 p-4">
      <p className="text-sm font-semibold">Acoes do fluxo</p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
        Edite a origem, recarregue a lista de chats do Telegram e salve a operacao escolhida.
      </p>
      {shouldShowFlowReview ? (
        <div className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-3 text-xs leading-5 text-cyan-100">
          <p className="font-semibold">Resumo para revisao</p>
          <p className="mt-1">Fluxo: {telegramFlow === 'bridge' ? 'Ponte Telegram -> WhatsApp' : 'Automatizador de Ofertas'}</p>
          <p>Origem: {selectedSourceName}</p>
          <p>Destinos WhatsApp: {selectedWhatsAppDestinationCount}</p>
          <p>Encaminhar para Telegram: {telegramForwardLabel}</p>
          <p className="mt-2 font-semibold">Alteracoes detectadas:</p>
          {pendingFlowChanges.map((change, index) => (
            <p key={`flow-change-${index}`}>- {change}</p>
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          disabled={
            readOnlyAccount ||
            busy === 'save-source' ||
            (isAutomationEditing && !selectedRouteSource.trim()) ||
            (isAutomationEditing && !hasPendingFlowChanges && !shouldShowFlowReview)
          }
          onClick={onEditOrSubmit}
          className={primaryButtonClassName}
        >
          {isAutomationEditing
            ? shouldShowFlowReview
              ? 'Confirmar e salvar'
              : 'Revisar antes de salvar'
            : 'Editar fluxo'}
        </button>
        {shouldShowFlowReview ? (
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={onCancelReview}
          >
            Voltar e editar
          </button>
        ) : null}
        <button
          type="button"
          disabled={readOnlyAccount || busy === 'telegram-chats'}
          onClick={() => void onRefreshOrigins()}
          className={secondaryButtonClassName}
        >
          <RefreshCcw size={16} />
          Atualizar origens
        </button>
      </div>
    </div>
  );
}
