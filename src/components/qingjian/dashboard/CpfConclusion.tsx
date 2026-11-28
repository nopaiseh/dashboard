import { EmptyBlock } from "./EmptyBlock";

export function CpfConclusion({
  title,
  body,
  sampleMode = false,
  reachedFrs = false,
}: {
  title?: string;
  body?: string;
  sampleMode?: boolean;
  /** 由数据决定，默认 false，禁止写死为已达标。 */
  reachedFrs?: boolean;
}) {
  const headline = (title ?? "").trim();
  const support = (body ?? "").trim();
  if (!headline) {
    return (
      <EmptyBlock title="一句话结论" message="暂无结论" />
    );
  }

  const parts = splitConclusion(headline);

  return (
    <section className={"hl"} aria-labelledby="cpf-conclusion">
      <div className={"k"}>
        一句话结论
        <span className={"chip chipEst"}>估算</span>
        {sampleMode ? (
          <span className={"chip chipSample"}>示例数据</span>
        ) : null}
        {reachedFrs ? (
          <span className={"chip chipOver"}>已达 FRS</span>
        ) : null}
      </div>
      <h1 id="cpf-conclusion">
        {parts.map((p, i) =>
          p.em ? <em key={i}>{p.text}</em> : <span key={i}>{p.text}</span>,
        )}
      </h1>
      {support ? <p>{support}</p> : null}
    </section>
  );
}

/**
 * Highlight currency amounts and year/month phrases in green.
 * Amounts like S$14,280.45 must match as one token (decimals stay green).
 */
export function splitConclusion(
  text: string,
): Array<{ text: string; em?: boolean }> {
  const re =
    /(S\$\s*[\d,]+(?:\.\d+)?|\d{4}\s*年(?:\s*\d+\s*月)?)/g;
  const out: Array<{ text: string; em?: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx) });
    out.push({ text: m[0], em: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}
