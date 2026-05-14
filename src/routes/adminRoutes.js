import {
  deleteUserAccount,
  findUserById,
  updateUserAdminSettings
} from '../authStore.js';

export function attachAdminRoutes({
  app,
  requireAdmin,
  auth,
  manager,
  buildAdminState,
  respondWithState,
  auditAdminAction
}) {
  app.get('/api/admin/users', requireAdmin, async (_request, response) => {
    response.json(await buildAdminState());
  });

  app.post('/api/admin/users/:userId', requireAdmin, async (request, response) => {
    const targetUserId = String(request.params.userId ?? '').trim();
    const updatedUser = await updateUserAdminSettings(targetUserId, {
      plan: request.body?.plan,
      accountStatus: request.body?.accountStatus,
      billingStatus: request.body?.billingStatus,
      internalNote: request.body?.internalNote
    });

    if (request.user?.id === updatedUser.id) {
      Object.assign(request.user, updatedUser);
    }

    if (updatedUser.accountStatus === 'suspended') {
      await auth?.forceLogoutUser(updatedUser.id);
    }

    await auditAdminAction(request, 'admin.update_user_settings', targetUserId, 'success', {
      plan: request.body?.plan,
      accountStatus: request.body?.accountStatus,
      billingStatus: request.body?.billingStatus
    });
    await respondWithState(request, response);
  });

  app.post('/api/admin/users/:userId/restart-runtime', requireAdmin, async (request, response) => {
    const targetUserId = String(request.params.userId ?? '').trim();
    const targetUser = await findUserById(targetUserId);

    if (!targetUser) {
      await auditAdminAction(request, 'admin.restart_runtime', targetUserId, 'not_found');
      response.status(404).json({
        authenticated: true,
        googleEnabled: auth?.googleEnabled ?? false,
        error: 'Usuário não encontrado.'
      });
      return;
    }

    await manager.restartRuntimeForUserId(targetUserId);
    await auditAdminAction(request, 'admin.restart_runtime', targetUserId, 'success');
    await respondWithState(request, response);
  });

  app.delete('/api/admin/users/:userId', requireAdmin, async (request, response) => {
    const targetUserId = String(request.params.userId ?? '').trim();
    const targetUser = await findUserById(targetUserId);

    if (!targetUser) {
      await auditAdminAction(request, 'admin.delete_user', targetUserId, 'not_found');
      response.status(404).json({
        authenticated: true,
        googleEnabled: auth?.googleEnabled ?? false,
        error: 'Usuário não encontrado.'
      });
      return;
    }

    if (request.user?.id === targetUserId) {
      await auditAdminAction(request, 'admin.delete_user', targetUserId, 'blocked_self_delete');
      response.status(400).json({
        authenticated: true,
        googleEnabled: auth?.googleEnabled ?? false,
        error: 'Você não pode excluir a propria conta pelo painel admin.'
      });
      return;
    }

    await manager.destroyRuntimeForUserId(targetUserId);
    await (auth ? auth.deleteAccount(targetUserId) : deleteUserAccount(targetUserId));
    await auditAdminAction(request, 'admin.delete_user', targetUserId, 'success');
    await respondWithState(request, response);
  });
}
