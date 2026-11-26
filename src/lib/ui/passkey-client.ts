"use client";

import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export class PasskeyError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PasskeyError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText || "request failed";
  }
}

export async function loginWithPasskey(): Promise<void> {
  const optRes = await fetch("/api/auth/options", { method: "GET" });
  if (optRes.status === 429) {
    throw new PasskeyError("locked", 429);
  }
  if (!optRes.ok) {
    throw new PasskeyError(await readError(optRes), optRes.status);
  }
  const optBody = (await optRes.json()) as {
    challenge_id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  };

  const assertion = await startAuthentication({
    optionsJSON: optBody.options,
  });

  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: optBody.challenge_id,
      assertion,
    }),
  });

  if (verifyRes.status === 429) {
    throw new PasskeyError("locked", 429);
  }
  if (!verifyRes.ok) {
    throw new PasskeyError(await readError(verifyRes), verifyRes.status);
  }
}

export type DecisionAction = "approve" | "reject" | "reply";

export async function decideWithPasskey(input: {
  itemId: string;
  action: DecisionAction;
  contentHash: string;
  optionKey?: string;
  replyText?: string;
}): Promise<void> {
  const optRes = await fetch("/api/auth/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      purpose: "step_up",
      item_id: input.itemId,
    }),
  });
  if (!optRes.ok) {
    throw new PasskeyError(await readError(optRes), optRes.status);
  }
  const optBody = (await optRes.json()) as {
    challenge_id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  };

  const assertion = await startAuthentication({
    optionsJSON: optBody.options,
  });

  const body: Record<string, unknown> = {
    action: input.action,
    content_hash: input.contentHash,
    assertion,
    challenge_id: optBody.challenge_id,
  };
  if (input.optionKey) body.option_key = input.optionKey;
  if (input.replyText !== undefined) body.reply_text = input.replyText;

  const decideRes = await fetch(`/api/items/${input.itemId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (decideRes.status === 409) {
    throw new PasskeyError("conflict", 409);
  }
  if (!decideRes.ok) {
    throw new PasskeyError(await readError(decideRes), decideRes.status);
  }
}
