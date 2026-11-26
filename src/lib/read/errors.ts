/** 读库失败（与「没有数据」区分）。 */
export class DataReadError extends Error {
  readonly name = "DataReadError";
  readonly code = "DATA_READ_ERROR" as const;
  readonly table?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; table?: string },
  ) {
    super(message, { cause: options?.cause });
    this.table = options?.table;
  }
}

/** 读取层要求会话，但当前请求未通过校验。 */
export class SessionRequiredError extends Error {
  readonly name = "SessionRequiredError";
  readonly code = "unauthorized" as const;

  constructor(message = "unauthorized") {
    super(message);
  }
}

export function isDataReadError(err: unknown): err is DataReadError {
  return err instanceof DataReadError;
}

export function isSessionRequiredError(
  err: unknown,
): err is SessionRequiredError {
  return err instanceof SessionRequiredError;
}
