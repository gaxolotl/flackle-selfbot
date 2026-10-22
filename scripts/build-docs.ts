import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";

interface NavItem {
  key: string;
  file: string;
  label: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const root = resolve(import.meta.dir, "..");
const docsDir = join(root, "docs");
const siteDir = join(docsDir, "site");
const apiDir = join(docsDir, "api");

const sections: NavSection[] = [
  {
    title: "Start",
    items: [
      { key: "index", file: "README.md", label: "Overview" },
      { key: "getting-started", file: "getting-started.md", label: "Getting started" },
      { key: "authentication", file: "authentication.md", label: "Authentication" },
    ],
  },
  {
    title: "Guides",
    items: [
      { key: "messages", file: "messages.md", label: "Messages" },
      { key: "reactions", file: "reactions.md", label: "Reactions" },
      { key: "servers-channels", file: "servers-channels.md", label: "Servers and channels" },
      {
        key: "members-roles-permissions",
        file: "members-roles-permissions.md",
        label: "Members, roles and permissions",
      },
      { key: "conversations", file: "conversations.md", label: "Conversations" },
      { key: "gateway", file: "gateway.md", label: "Gateway and events" },
      { key: "media-uploads", file: "media-uploads.md", label: "Media and uploads" },
      { key: "account", file: "account.md", label: "Account and security" },
    ],
  },
  {
    title: "Reference",
    items: [
      { key: "api-reference", file: "api-reference.md", label: "API reference" },
      { key: "recipes", file: "recipes.md", label: "Recipes" },
      { key: "troubleshooting", file: "troubleshooting.md", label: "Troubleshooting" },
    ],
  },
];

marked.use(gfmHeadingId());
marked.setOptions({ gfm: true, breaks: false });

function outName(file: string): string {
  return file === "README.md" ? "index.html" : file.replace(/\.md$/, ".html");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.replace(/[*_`]/g, "").trim() || fallback;
}

function rewriteLinks(html: string): string {
  const withGuideLinks = html.replace(
    /href="([^"]*?)\.md(#[^"]*)?"/g,
    (_match, path: string, hash = "") => {
      const normalized = path.endsWith("README")
        ? `${path.slice(0, -"README".length)}index`
        : path;
      return `href="${normalized}.html${hash}"`;
    },
  );

  return withGuideLinks.replace(
    /<a href="(https?:\/\/[^"]+)"/g,
    '<a href="$1" target="_blank" rel="noreferrer"',
  );
}

function renderNav(activeKey: string): string {
  const groups = sections
    .map((section) => {
      const links = section.items
        .map((item) => {
          const active = item.key === activeKey;
          return `<a class="nav-link${active ? " active" : ""}" href="${outName(item.file)}"${
            active ? ' aria-current="page"' : ""
          }>${escapeHtml(item.label)}</a>`;
        })
        .join("\n        ");

      return `<div class="nav-section">
      <div class="nav-title">${escapeHtml(section.title)}</div>
      ${links}
    </div>`;
    })
    .join("\n    ");

  return `${groups}
    <div class="nav-section">
      <div class="nav-title">Generated API</div>
      <a class="nav-link" href="api/index.html">TypeDoc reference</a>
    </div>`;
}

function renderPage(title: string, body: string, activeKey: string, version: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Unofficial Bun/TypeScript client and selfbot library for Flackle.">
  <title>${escapeHtml(title)} · flackle-selfbot docs</title>
  <link rel="stylesheet" href="assets/docs.css">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="index.html">flackle <span>selfbot</span></a>
    <div class="header-meta">
      <span class="badge">unofficial</span>
      <span class="version">v${escapeHtml(version)}</span>
    </div>
    <a class="api-link" href="api/index.html">TypeDoc API →</a>
  </header>

  <div class="layout">
    <aside class="sidebar">
      <nav aria-label="Documentation">
        ${renderNav(activeKey)}
      </nav>
      <div class="sidebar-footer">
        Not affiliated with Flackle. Automating an account can break server rules.
        Use it responsibly and never for spam, raids or mass DMs.
      </div>
    </aside>

    <main id="main" class="content">
      <article class="markdown">
${body}
      </article>
      <footer class="page-footer">
        <a href="index.html">← Docs home</a>
        <a href="api/index.html">TypeDoc API →</a>
      </footer>
    </main>
  </div>
</body>
</html>
`;
}

async function main(): Promise<void> {
  try {
    await stat(apiDir);
  } catch {
    throw new Error("docs/api is missing. Run `bun run docs:api` before building the site.");
  }

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    version?: string;
  };
  const version = pkg.version ?? "0.0.0";

  await rm(siteDir, { recursive: true, force: true });
  await mkdir(join(siteDir, "assets"), { recursive: true });
  await cp(apiDir, join(siteDir, "api"), { recursive: true });
  await cp(join(docsDir, "assets", "docs.css"), join(siteDir, "assets", "docs.css"));

  let pages = 0;

  for (const section of sections) {
    for (const item of section.items) {
      const markdown = await readFile(join(docsDir, item.file), "utf8");
      const rendered = rewriteLinks(await marked.parse(markdown));
      const title = titleFromMarkdown(markdown, item.label);
      const html = renderPage(title, rendered, item.key, version);

      await writeFile(join(siteDir, outName(item.file)), html, "utf8");
      pages += 1;
    }
  }

  console.log(`docs site generated at ${join(siteDir, "index.html")} (${pages} pages + TypeDoc)`);
}

await main();
