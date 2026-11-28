/**
 * Offline C2 screenshot fixture: SSR DashboardView / CpfSection into static HTML.
 * Usage: node --import tsx scripts/render-c2-fixture.mjs [12m|all] > out.html
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const range = process.argv[2] === "all" ? "all" : "12m";
const outPath = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(root, `tmp-c2-${range}.html`);

const { DashboardView } = await import(
  "../src/components/qingjian/DashboardView.tsx"
);
const { SAMPLE_DASHBOARD } = await import(
  "../src/components/qingjian/dashboard/fixtures.ts"
);
const { CpfSection } = await import(
  "../src/components/qingjian/dashboard/CpfSection.tsx"
);

const cssPath = resolve(root, "src/components/qingjian/qingjian.css");
const globalsPath = resolve(root, "src/app/globals.css");
const qjCss = readFileSync(cssPath, "utf8");
const globals = readFileSync(globalsPath, "utf8");
const rootMatch = globals.match(/:root\s*\{[\s\S]*?\n\}/);
const rootCss = rootMatch ? rootMatch[0] : "";

const body =
  range === "all"
    ? renderToStaticMarkup(
        createElement(
          "div",
          { className: "qj-dash" },
          createElement(
            "div",
            { className: "banner", role: "note" },
            createElement("b", null, "示例数据"),
            "此页所有数字、日期均为设计稿占位，不是真实数据。",
          ),
          createElement(CpfSection, {
            sampleMode: true,
            trendRange: "all",
          }),
        ),
      )
    : renderToStaticMarkup(
        createElement(DashboardView, {
          data: SAMPLE_DASHBOARD,
          sampleMode: true,
        }),
      );

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>C2 CPF ${range}</title>
  <style>
${rootCss}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--qj-bg);
  color: var(--qj-ink);
  font-family: var(--qj-font-sans);
  line-height: 1.5;
}
.qj-wrap { max-width: 1120px; margin: 0 auto; padding: 1.25rem 1.25rem 3rem; width: 100%; }
.qj-app { min-height: 100dvh; background: var(--qj-bg); }
${qjCss}
  </style>
</head>
<body>
  <div class="qj-app"><main class="qj-wrap">${body}</main></div>
</body>
</html>
`;

writeFileSync(outPath, html);
console.error(`wrote ${outPath} (${html.length} bytes, range=${range})`);
