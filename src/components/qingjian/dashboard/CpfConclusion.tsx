import { C2_CONCLUSION } from "./c2Data";

export function CpfConclusion({
  title,
  body,
  sampleMode = false,
  reachedFrs = true,
}: {
  title?: string;
  body?: string;
  sampleMode?: boolean;
  reachedFrs?: boolean;
}) {
  const headline = (title ?? C2_CONCLUSION.title).trim();
  const support = (body ?? C2_CONCLUSION.body).trim();
  if (!headline) return null;

  // Split headline for em emphasis on money / date if matching C2 pattern
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

function splitConclusion(
  text: string,
): Array<{ text: string; em?: boolean }> {
  // Emphasize "S$ …" amounts and "YYYY 年 …" ETA phrases like C2.
  const re =
    /(S\$\s*[\d,]+|S\$\s*[\d.]+|\d{4}\s*年(?:\s*\d+\s*月)?)/g;
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
