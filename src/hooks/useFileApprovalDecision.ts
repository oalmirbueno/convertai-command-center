import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useClientIdentity } from "@/hooks/useClientIdentity";
import {
  decideFileApproval,
  type FileApprovalDecision,
} from "@/lib/fileApprovalActions";

type DecideInput = {
  fileId: string;
  expectedVersion?: number | null;
  decision: FileApprovalDecision;
  feedback?: string | null;
};

export function useFileApprovalDecision() {
  const queryClient = useQueryClient();
  const { isImpersonating } = useClientIdentity();
  const [submitting, setSubmitting] = useState(false);

  const decide = useCallback(async ({
    fileId,
    expectedVersion,
    decision,
    feedback,
  }: DecideInput) => {
    if (isImpersonating) {
      throw new Error("O modo “Ver como cliente” é somente leitura.");
    }

    setSubmitting(true);
    try {
      const result = await decideFileApproval(
        fileId,
        Number(expectedVersion ?? 1),
        decision,
        feedback,
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["files"] }),
        queryClient.invalidateQueries({ queryKey: ["all-files"] }),
        queryClient.invalidateQueries({ queryKey: ["client-pending-approvals"] }),
        queryClient.invalidateQueries({ queryKey: ["client-delivered-files"] }),
      ]);

      return result;
    } finally {
      setSubmitting(false);
    }
  }, [isImpersonating, queryClient]);

  return {
    decide,
    submitting,
    isReadOnly: isImpersonating,
  };
}
