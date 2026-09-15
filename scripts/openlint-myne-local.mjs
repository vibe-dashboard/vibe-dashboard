#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

const supportedExtensions = new Set([".css", ".jsx", ".ts", ".tsx"]);
const identityAttributes = new Set([
  "data-myne-skin",
  "data-myne-slot",
  "data-myne-surface",
  "data-myne-view-pack",
]);
const findings = [];

function collectFiles(path) {
  const absolutePath = resolve(path);
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    return [];
  }
  if (stat.isDirectory()) {
    return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
      entry.name === "node_modules" || entry.name === ".git"
        ? []
        : collectFiles(resolve(absolutePath, entry.name)),
    );
  }
  return supportedExtensions.has(extname(absolutePath)) ? [absolutePath] : [];
}

function isAllowlisted(file) {
  return /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || file.endsWith(".md");
}

function addFinding(file, source, index, ruleId, message, note) {
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  findings.push({
    ruleId,
    message,
    severity: "error",
    file,
    range: { start: { line: lines.length - 1, column: lines.at(-1)?.length ?? 0 } },
    note,
  });
}

function reportMatches(file, source, expression, ruleId, message, note) {
  for (const match of source.matchAll(expression)) {
    addFinding(file, source, match.index, ruleId, message(match), note);
  }
}

function inspect(file) {
  if (isAllowlisted(file)) return;
  const source = readFileSync(file, "utf8");
  const isView = file.endsWith(".view.tsx") || file.endsWith(".view.jsx");
  const fileName = basename(file);
  const isApprovedContainer = fileName === "SpacesOverview.tsx" || fileName === "SkinEditorDialog.tsx";

  if (file.endsWith(".tsx") && !isView && !isApprovedContainer && !file.endsWith(".composition.tsx")) {
    reportMatches(
      file,
      source,
      /<[a-z][a-z0-9-]*(?:\s|\/>|>)/g,
      "myne/no-intrinsic-jsx-outside-view",
      () => "An intrinsic JSX element is only allowed in a view file or approved container/composition adapter.",
      "Move markup to a *.view.tsx renderer and keep the container semantic.",
    );
  }

  if (!isView && !isApprovedContainer && !file.endsWith(".contracts.ts") && fileName !== "AppHooks.ts" && /\bappHooks\b/.test(source)) {
    addFinding(
      file,
      source,
      source.indexOf("appHooks"),
      "myne/app-hooks-only-in-approved-container",
      "appHooks may only be consumed by an approved container.",
      "Project the required semantic model and named actions at the page/container boundary.",
    );
  }

  if (fileName === "AppHooks.ts") {
    reportMatches(
      file,
      source,
      /from\s+["'][^"']*(?:components|theme\/skins|vk-client|springboard|useModule|rpc|store|server-action|navigation)[^"']*["']/gi,
      "myne/public-app-hooks-import-boundary",
      () => "The public AppHooks contract must not import private host or proof-surface types.",
      "Define portable readonly DTOs in the public app-hooks package.",
    );
  }

  if (isView) {
    reportMatches(
      file,
      source,
      /\buse[A-Z][A-Za-z0-9_]*\s*\(/g,
      "myne/no-hooks-in-view",
      () => "Presentation views must not call hooks.",
      "Project host state into a narrow semantic model in the container.",
    );
    reportMatches(
      file,
      source,
      /\bappHooks\b/g,
      "myne/no-app-hooks-in-view",
      () => "Presentation views must not receive or access appHooks.",
      "Expose only the model and actions declared by the slot contract.",
    );
    reportMatches(
      file,
      source,
      /from\s+["'][^"']*(?:vk-client|springboard|useModule|rpc|server-action|navigation|store)[^"']*["']/gi,
      "myne/no-host-import-in-view",
      () => "Presentation views must not use a private host import.",
      "Keep host dependencies in page/container composition adapters.",
    );
  }

  reportMatches(
    file,
    source,
    /(?:data-vd-|--vd-|\bVD(?:Action|Badge|Card|Heading|Icon|Row|Text|Skin)\b)/g,
    "myne/no-vd-vocabulary",
    () => "VD-era public customization vocabulary is forbidden in migrated runtime files.",
    "Use registered myne classes, exact data-myne identities, and --myne-* properties.",
  );

  if (/\.[jt]sx$/.test(file)) {
    reportMatches(
      file,
      source,
      /\bstyle\s*=/g,
      "myne/no-inline-style",
      () => "An inline style attribute bypasses the skin contract.",
      "Use a registered public class backed by a --myne-* token.",
    );
    reportMatches(
      file,
      source,
      /\b(?:hover:|group-hover:|disabled:hover:)?(?:text|bg|border(?:-[trblxy])?)-(?:white|black|zinc|slate|gray|neutral|stone|red|green|amber|yellow|blue|cyan|indigo|violet|purple|pink|primary)(?:-[^\s"'`}]*)?/g,
      "myne/no-hardcoded-skin-color",
      (match) => `Hardcoded skin-controlled utility "${match[0]}" is forbidden.`,
      "Use a semantic myne primitive or registered public class.",
    );
    for (const match of source.matchAll(/\bdata-myne-[a-z0-9-]+/g)) {
      if (!identityAttributes.has(match[0])) {
        addFinding(
          file,
          source,
          match.index,
          "myne/exact-identities-only",
          `The data-myne attribute "${match[0]}" is not an approved sparse identity.`,
          "Only surface, slot, skin, and view-pack are public data-myne identities.",
        );
      }
    }

    for (const match of source.matchAll(/className\s*=\s*["']([^"']*)["']/g)) {
      const classes = new Set(match[1].split(/\s+/).filter(Boolean));
      for (const className of classes) {
        const modifier = /^(myne-[a-z0-9-]+)--[a-z0-9-]+$/.exec(className);
        if (modifier && !classes.has(modifier[1])) {
          addFinding(
            file,
            source,
            match.index,
            "myne/modifier-requires-base",
            `Modifier "${className}" must co-occur with its base class "${modifier[1]}".`,
            "Public modifiers never stand alone.",
          );
        }
      }
    }

    for (const match of source.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)\baria-pressed\s*=/g)) {
      if (match[1].toLowerCase() !== "button" && !/\brole\s*=\s*["']button["']/.test(match[2])) {
        addFinding(
          file,
          source,
          match.index,
          "myne/truthful-aria-pressed",
          "aria-pressed requires a native button or an explicit button role.",
          "Prefer the native button element and preserve keyboard behavior.",
        );
      }
    }
  }

  if (file.endsWith(".module.css")) {
    reportMatches(
      file,
      source,
      /:global|\.myne-|\[data-myne-/g,
      "myne/no-public-selector-in-css-module",
      () => "A private CSS Module must not reach into the public myne selector contract.",
      "Keep public selectors in myne.css and module selectors local.",
    );
  }
}

for (const file of [...new Set(process.argv.slice(2).flatMap(collectFiles))]) inspect(file);
process.stdout.write(`${JSON.stringify(findings)}\n`);
