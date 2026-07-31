import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  connectMetaOAuth,
  disconnectMetaOAuth,
  finishMetaOAuth,
  META_OAUTH_CALLBACK_PATH,
  startMetaOAuth,
} from "@/lib/socialMetaOAuth";

export function useMetaOAuth(clientId: string, projectId: string) {
  const queryClient = useQueryClient();

  const refreshAccounts = async () => {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: ["editorial-editor-options"] }),
      queryClient.invalidateQueries({ queryKey: ["external-accounts", clientId] }),
      queryClient.invalidateQueries({
        queryKey: ["external-account-connections", clientId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["project-external-accounts", clientId],
      }),
    ]);
  };

  const startConnection = useMutation({
    mutationFn: () =>
      startMetaOAuth({
        client_id: clientId,
        project_id: projectId,
        return_path: META_OAUTH_CALLBACK_PATH,
      }),
  });

  const connectResource = useMutation({
    mutationFn: ({
      oauthSessionId,
      candidateId,
    }: {
      oauthSessionId: string;
      candidateId: string;
    }) =>
      connectMetaOAuth({
        oauth_session_id: oauthSessionId,
        candidate_id: candidateId,
        client_id: clientId,
        project_id: projectId,
      }),
    onSuccess: refreshAccounts,
  });

  const disconnectAccount = useMutation({
    mutationFn: (externalAccountId: string) =>
      disconnectMetaOAuth({ external_account_id: externalAccountId }),
    onSuccess: refreshAccounts,
  });

  const finishSession = useMutation({
    mutationFn: ({
      oauthSessionId,
      sessionClientId,
      sessionProjectId,
    }: {
      oauthSessionId: string;
      sessionClientId: string;
      sessionProjectId: string;
    }) =>
      finishMetaOAuth({
        oauth_session_id: oauthSessionId,
        client_id: sessionClientId,
        project_id: sessionProjectId,
      }),
  });

  return {
    startConnection,
    connectResource,
    finishSession,
    disconnectAccount,
  };
}
