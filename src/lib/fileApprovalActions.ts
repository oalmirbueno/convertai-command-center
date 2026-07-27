import { supabase } from "@/integrations/supabase/client";

export type FileApprovalDecision = "approved" | "rejected";
export type FileReleaseMode = "client_shared" | "approval";

type RpcResult<T = unknown> = {
  data: T;
  error: { message?: string } | null;
};

type ApprovalRpc = <T = unknown>(
  functionName: string,
  args: Record<string, unknown>,
) => Promise<RpcResult<T>>;

async function runApprovalRpc<T = unknown>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const rpc = supabase.rpc.bind(supabase) as unknown as ApprovalRpc;
  const { data, error } = await rpc<T>(functionName, args);
  if (error) throw error;
  return data;
}

export function requestFileAgencyReview(fileId: string) {
  return runApprovalRpc("request_file_agency_review", {
    p_file_id: fileId,
  });
}

export function reviewFileAgency(
  fileId: string,
  decision: FileApprovalDecision,
  feedback?: string | null,
) {
  return runApprovalRpc("review_file_agency", {
    p_file_id: fileId,
    p_decision: decision,
    p_feedback: feedback?.trim() || null,
  });
}

export function releaseFileToClient(fileId: string, mode: FileReleaseMode) {
  return runApprovalRpc("release_file_to_client", {
    p_file_id: fileId,
    p_mode: mode,
  });
}

export function decideFileApproval(
  fileId: string,
  expectedVersion: number,
  decision: FileApprovalDecision,
  feedback?: string | null,
) {
  return runApprovalRpc("decide_file_approval", {
    p_file_id: fileId,
    p_expected_version: expectedVersion,
    p_decision: decision,
    p_feedback: feedback?.trim() || null,
  });
}
