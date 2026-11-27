/** When item fields failed to decrypt, block passkey decisions in the UI. */
export const DECRYPT_FAILED_DECISION_REASON =
  "内容无法解密，暂不能批准或回复";

export function decisionActionsBlocked(item: {
  decrypt_failed?: boolean;
}): { blocked: boolean; reason: string | null } {
  if (item.decrypt_failed) {
    return { blocked: true, reason: DECRYPT_FAILED_DECISION_REASON };
  }
  return { blocked: false, reason: null };
}
