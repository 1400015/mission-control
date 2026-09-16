/**
 * agents/tools/browser.ts
 * ----------------------------------------------------------------------------
 * FERRAMENTAS DE NAVEGADOR (browser control), ao estilo do browser do
 * Antigravity: o agente consegue abrir páginas, ler o conteúdo, interagir
 * e capturar screenshots que ficam guardados como ARTIFACTS.
 *
 * Implementação: playwright-core (sem download de browsers). Reutiliza o
 * Edge ou Chrome já instalado no sistema (canal "msedge"/"chrome").
 * O browser é partilhado entre ferramentas e encerrado quando a app sai.
 *
 * Screenshots → artifacts com data-URI (exibíveis diretamente na UI).
 */
import type { ToolDefinition } from "../../../shared/types";
// playwright-core é carregado dinamicamente (só quando uma ferramenta é usada)
type Playwright = typeof import("playwright-core");
let pw: Playwright | undefined;
let browser: import("playwright-core").Browser | undefined;
let page: import("playwright-core").Page | undefined;

/** Obtém (ou lança) uma instância única do browser, tentando Edge e Chrome. */
async function getBrowser(): Promise<NonNullable<typeof browser>> {
  if (!pw) pw = await import("playwright-core");
  if (browser?.isConnected()) return browser;
  const errors: string[] = [];
  for (const channel of ["msedge", "chrome"]) {
    try {
      browser = await pw.chromium.launch({
        channel,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      return browser;
    } catch (e) {
      errors.push(`${channel}: ${(e as Error).message}`);
    }
  }
  throw new Error(
    `Não foi possível abrir o navegador (precisas de Edge ou Chrome instalado). Tentativas: ${errors.join(" | ")}`
  );
}

async function getPage(): Promise<NonNullable<typeof page>> {
  const b = await getBrowser();
  if (!page || page.isClosed()) {
    page = await b.newContext({ viewport: { width: 1280, height: 800 } }).then((c) => c.newPage());
  }
  return page as NonNullable<typeof page>;
}

/** Encerra o browser (chamado ao sair da app). */
export async function closeBrowser(): Promise<void> {
  try { await browser?.close(); } catch { /* ignora */ }
  browser = undefined;
  page = undefined;
}

/** Extrai o texto principal da página atual (para o agente "ler" a página). */
async function pageText(): Promise<string> {
  const p = await getPage();
  return p.evaluate(() => {
    // Dentro do browser context, "document" existe em runtime
    const doc = (globalThis as { document?: { body?: { innerText?: string } } }).document;
    return (doc?.body?.innerText ?? "").slice(0, 20_000);
  });
}

// ---------------------------------------------------------------------------
// Ferramentas expostas ao modelo
// ---------------------------------------------------------------------------

export const browserOpenTool: ToolDefinition = {
  name: "browser_open",
  description: "Abre um URL no navegador integrado (headless). Usa browser_read para ver o conteúdo depois.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "URL completo (https://…)" } },
    required: ["url"],
  },
};

export async function runBrowserOpen(_ws: string, args: { url: string }): Promise<string> {
  const p = await getPage();
  await p.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  return `Página aberta: ${p.url()} — título: ${await p.title()}`;
}

export const browserReadTool: ToolDefinition = {
  name: "browser_read",
  description: "Lê o texto visível da página atual do navegador (até ~20k caracteres).",
  requiresApproval: false,
  parameters: { type: "object", properties: {} },
};

export async function runBrowserRead(): Promise<string> {
  return (await pageText()) || "(página sem texto)";
}

export const browserScreenshotTool: ToolDefinition = {
  name: "browser_screenshot",
  description:
    "Captura um screenshot da página atual. Devolve uma data-URI PNG que a UI mostra como artifact.",
  requiresApproval: false,
  parameters: { type: "object", properties: {} },
};

export async function runBrowserScreenshot(): Promise<{ result: string; dataUri?: string }> {
  const p = await getPage();
  const buf = await p.screenshot({ fullPage: false });
  const dataUri = `data:image/png;base64,${buf.toString("base64")}`;
  return { result: `Screenshot capturado (${buf.length} bytes).`, dataUri };
}

export const browserClickTool: ToolDefinition = {
  name: "browser_click",
  description: "Clica num elemento da página, identificado por seletor CSS.",
  requiresApproval: true, // interação externa requer confirmação
  parameters: {
    type: "object",
    properties: { selector: { type: "string", description: "Seletor CSS do elemento" } },
    required: ["selector"],
  },
};

export async function runBrowserClick(_ws: string, args: { selector: string }): Promise<string> {
  const p = await getPage();
  await p.click(args.selector, { timeout: 10_000 });
  return `Clicado: ${args.selector}`;
}

export const browserTypeTool: ToolDefinition = {
  name: "browser_type",
  description: "Escreve texto num campo da página (seletor CSS) — opcionalmente submetendo com Enter.",
  requiresApproval: true,
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "Seletor CSS do campo" },
      text: { type: "string", description: "Texto a escrever" },
      pressEnter: { type: "boolean", description: "Se true, prime Enter após escrever" },
    },
    required: ["selector", "text"],
  },
};

export async function runBrowserType(
  _ws: string,
  args: { selector: string; text: string; pressEnter?: boolean }
): Promise<string> {
  const p = await getPage();
  await p.fill(args.selector, args.text, { timeout: 10_000 });
  if (args.pressEnter) await p.keyboard.press("Enter");
  return `Escrito em ${args.selector}.`;
}
