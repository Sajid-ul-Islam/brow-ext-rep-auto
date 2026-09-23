import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const extensionRoot = path.join(root, "extension");
const excluded = new Set([".git", ".kilo", "node_modules", "artifacts", "dist", "coverage", "browser-profile", "test-results"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function requireLocalResource(base, reference) {
  assert(!/^[a-z]+:/i.test(reference), `Packaged resource must be local: ${reference}`);
  const resolved = path.resolve(base, reference);
  assert(resolved.startsWith(`${extensionRoot}${path.sep}`), `Resource leaves extension package: ${reference}`);
  await access(resolved);
}

const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, "116");
assert.equal(manifest.background.type, "module");
assert.equal(manifest.incognito, "not_allowed");
// Update this gate deliberately when a milestone adds reviewed permissions.
assert.deepEqual([...manifest.permissions].sort(), ["sidePanel", "storage", "activeTab", "scripting"].sort());
for (const permissionKey of ["host_permissions", "optional_host_permissions", "optional_permissions", "content_scripts", "externally_connectable"]) {
  assert(!Object.hasOwn(manifest, permissionKey), `M1-M5 must not declare ${permissionKey}`);
}
await requireLocalResource(extensionRoot, manifest.background.service_worker);
await requireLocalResource(extensionRoot, manifest.side_panel.default_path);
await requireLocalResource(extensionRoot, "observer.js");
await requireLocalResource(extensionRoot, "executor.js");

const files = await walk(root);
let scripts = 0;
let documents = 0;
for (const file of files) {
  const relative = path.relative(root, file);
  if (/\.(?:mjs|js)$/.test(file)) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    scripts += 1;
  }
  if (/\.(?:json|js|mjs|html|css|md)$/.test(file)) {
    const content = await readFile(file, "utf8");
    assert(content.endsWith("\n"), `${relative}: missing final newline`);
    if (!file.endsWith(".md")) assert(!/[\t ]+$/m.test(content), `${relative}: trailing whitespace`);
    if (file.endsWith(".json")) JSON.parse(content);
    if (file.endsWith(".html")) {
      for (const match of content.matchAll(/(?:src|href)="([^"]+)"/g)) {
        await requireLocalResource(path.dirname(file), match[1]);
      }
    }
    if (file.endsWith(".md")) {
      documents += 1;
      for (const match of content.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
        const reference = match[1];
        if (/^[a-z][\w+.-]*:/i.test(reference) || reference.startsWith("#")) continue;
        const target = reference.split("#")[0];
        await access(path.resolve(path.dirname(file), decodeURIComponent(target)));
      }
    }
  }
}

console.log(`Checks passed: MV3 manifest and permissions, packaged resources, ${scripts} JavaScript files, ${documents} Markdown documents and local file links.`);
console.log("Chrome runtime behavior requires the browser smoke check in docs/testing.md.");
