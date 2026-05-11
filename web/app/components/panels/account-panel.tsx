'use client';

import { Camera, LockKeyhole, Mail, Shield, ShieldCheck, User } from 'lucide-react';
import { useState } from 'react';
import { AvatarBadge, Field } from '../common-ui';
import { HTTP_TIMEOUT_MS, postJsonWithOptions } from '../../../lib/http';
import { cn } from '../../../lib/utils';
import type { AppState } from '../../types/panel';

const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[var(--accent-strong)] disabled:opacity-60';

const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-[var(--border)] px-4 py-2.5 text-sm font-semibold transition hover:bg-white/5 disabled:opacity-60';

function isReadOnlyAccount(state: AppState) {
  return state.auth.user?.accountStatus === 'trial' && !state.auth.user?.isAdmin;
}

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';

      if (!result) {
        reject(new Error('não foi possível ler a imagem selecionada.'));
        return;
      }

      resolve(result);
    };

    reader.onerror = () => {
      reject(new Error('não foi possível ler a imagem selecionada.'));
    };

    reader.readAsDataURL(file);
  });
}

export function AccountPanel({
  state,
  refresh,
  setNotice
}: {
  state: AppState;
  refresh: () => Promise<void>;
  setNotice: (message: string) => void;
}) {
  const readOnlyAccount = isReadOnlyAccount(state);
  const user = state.auth.user;
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [previewAvatar, setPreviewAvatar] = useState(user?.avatarUrl || '');
  const [profileEditing, setProfileEditing] = useState(false);

  const providers = user?.providers || [];
  const usesGoogleAvatar = providers.includes('google');
  const canChangePassword = providers.includes('password');

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_380px]">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="mb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Conta</p>
          <h2 className="mt-1 text-2xl font-semibold">Perfil e acesso</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">
            Atualize seu nome, gerencie a senha e personalize a foto do perfil quando a conta usar login por e-mail.
          </p>
        </div>

        <div className="grid gap-4">
          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="flex items-start justify-between gap-3 max-sm:flex-col max-sm:items-stretch">
              <div>
                <p className="text-sm font-semibold">Dados do perfil</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  Essas informações aparecem no seu painel e ajudam a identificar a conta conectada.
                </p>
              </div>

              <div className="flex items-center gap-2 max-sm:w-full">
                {profileEditing ? (
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      setName(user?.name || '');
                      setProfileEditing(false);
                    }}
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  type="button"
                  className={profileEditing ? secondaryButton : primaryButton}
                  disabled={readOnlyAccount}
                  onClick={() => {
                    if (!profileEditing) {
                      setProfileEditing(true);
                    }
                  }}
                >
                  {profileEditing ? 'Editando perfil' : 'Editar'}
                </button>
              </div>
            </div>

            <form
              className="mt-4 grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault();

                if (!profileEditing) {
                  return;
                }

                setBusy('profile');

                try {
                  await postJsonWithOptions('/api/account/profile', { name }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                  await refresh();
                  setProfileEditing(false);
                  setNotice('Perfil atualizado com sucesso.');
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : 'não foi possível atualizar o perfil.');
                } finally {
                  setBusy('');
                }
              }}
            >
              <Field label="Nome" value={name} onChange={setName} disabled={readOnlyAccount || !profileEditing} icon={User} />
              <Field label="E-mail" value={user?.email || ''} disabled icon={Mail} />
              {profileEditing ? (
                <div className="flex justify-end">
                  <button type="submit" className={primaryButton} disabled={readOnlyAccount || busy === 'profile'}>
                    Salvar perfil
                  </button>
                </div>
              ) : null}
            </form>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Seguranca da conta</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                  {canChangePassword
                    ? 'Use uma senha forte e atualize o acesso sempre que necessário.'
                    : 'Esta conta usa Autenticação externa e a senha e gerenciada fora do Portal do Afiliado.'}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {canChangePassword ? 'Senha local' : 'Login externo'}
              </span>
            </div>

            {canChangePassword ? (
              <form
                className="mt-4 grid gap-4 md:grid-cols-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy('password');

                  try {
                    await postJsonWithOptions('/api/account/password', {
                      currentPassword,
                      nextPassword,
                      confirmPassword
                    }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                    setCurrentPassword('');
                    setNextPassword('');
                    setConfirmPassword('');
                    await refresh();
                    setNotice('Senha atualizada com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'não foi possível atualizar a senha.');
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Field
                  label="Senha atual"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  icon={LockKeyhole}
                  disabled={readOnlyAccount}
                />
                <div className="hidden md:block" />
                <Field
                  label="Nova senha"
                  type="password"
                  autoComplete="new-password"
                  value={nextPassword}
                  onChange={setNextPassword}
                  icon={Shield}
                  disabled={readOnlyAccount}
                />
                <Field
                  label="Confirmar nova senha"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  icon={ShieldCheck}
                  disabled={readOnlyAccount}
                />
                <div className="md:col-span-2 flex justify-end">
                  <button type="submit" className={primaryButton} disabled={readOnlyAccount || busy === 'password'}>
                    Alterar senha
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-4 rounded-md border border-sky-400/20 bg-sky-400/10 px-4 py-3 text-sm text-sky-50">
                A senha desta conta e gerenciada pelo provedor de login conectado.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Foto do perfil</p>
        <h2 className="mt-1 text-xl font-semibold">Identidade da conta</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          {usesGoogleAvatar
            ? 'Sua foto está sincronizada com o Google e é atualizada automaticamente.'
            : 'Envie uma foto clara para identificar esta conta dentro do painel.'}
        </p>

        <div className="mt-5 flex flex-col items-center rounded-2xl border border-[var(--border)] bg-black/10 px-5 py-6 text-center">
          <AvatarBadge
            user={{
              ...(user || {}),
              avatarUrl: previewAvatar || user?.avatarUrl || ''
            }}
            size="lg"
          />
          <p className="mt-4 text-lg font-semibold">{user?.name || 'Usuário'}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">{user?.email}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {providers.map((provider) => (
              <span key={provider} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-[var(--muted)]">
                {provider === 'google' ? 'Google' : 'Email e senha'}
              </span>
            ))}
          </div>
        </div>

        {usesGoogleAvatar ? (
          <div className="mt-4 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-50">
            Como esta conta usa Google, a foto de perfil vem diretamente do Google do usuário.
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-black/10 p-4">
            <p className="text-sm font-semibold">Enviar nova foto</p>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
              Aceitamos PNG, JPG ou WEBP com até 1 MB.
            </p>
            <label className={cn('mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-400/20 bg-emerald-400/5 px-4 py-6 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/10', readOnlyAccount && 'cursor-not-allowed opacity-60')}>
              <Camera size={18} />
              Selecionar imagem
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={readOnlyAccount}
                onChange={async (event) => {
                  const file = event.target.files?.[0];

                  if (!file) {
                    return;
                  }

                  try {
                    if (file.size > 1024 * 1024) {
                      throw new Error('A imagem deve ter no máximo 1 MB.');
                    }

                    const avatarDataUrl = await readFileAsDataUrl(file);
                    setBusy('avatar');
                    setPreviewAvatar(avatarDataUrl);
                    await postJsonWithOptions('/api/account/avatar', { avatarDataUrl }, { timeoutMs: HTTP_TIMEOUT_MS.MEDIUM });
                    setBusy('');
                    await refresh();
                    setNotice('Foto do perfil atualizada com sucesso.');
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : 'não foi possível atualizar a foto do perfil.');
                  } finally {
                    event.currentTarget.value = '';
                    setBusy('');
                  }
                }}
              />
            </label>
            {busy === 'avatar' ? (
              <p className="mt-3 text-xs font-semibold text-emerald-100">Enviando nova foto...</p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}


