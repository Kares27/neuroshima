import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFileSync(path.join(root, name), "utf8").replace(/^\uFEFF/, "");
function files(directory) {
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(name) : [name];
  });
}
const modules = ["system.js", ...files("module").filter(name => /\.m?js$/.test(name))];
const templates = files("templates").filter(name => name.endsWith(".hbs"));
const sources = new Map([...modules, ...templates].map(name => [name, read(name)]));
const prefix = "systems/neuroshima/";
const templatePaths = text => [...text.matchAll(/systems\/neuroshima\/templates\/[^\s"'`{}]+\.hbs/g)].map(match => match[0]);
const preloadBlock = sources.get("system.js").match(/const templates\s*=\s*\[([\s\S]*?)\];/);
assert.ok(preloadBlock, "Template preload list must be discoverable");
const preloaded = new Set(templatePaths(preloadBlock[1]));
const aliases = new Map([...preloaded].filter(name => name.includes("/parts/") || name.endsWith("/damage-category-config.hbs")).map(name => [
  path.posix.basename(name, ".hbs").split("-").map(part => part[0].toUpperCase() + part.slice(1)).join(""), name
]));

test("runtime imports resolve after helper consolidation", () => {
  const errors = [];
  const known = new Set(modules);
  for (const name of modules) {
    for (const match of sources.get(name).matchAll(/\bfrom\s*["'](\.[^"']+)["']|\bimport\s*(?:\(\s*)?["'](\.[^"']+)["']/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1] ?? match[2]));
      if (!known.has(target)) errors.push(`${name} -> ${target}`);
    }
  }
  assert.deepEqual(errors, []);
});

test("system template paths in modules and HBS refer to existing files with exact casing", () => {
  const known = new Set(templates.map(name => prefix + name));
  const errors = [];
  for (const [name, text] of sources) {
    for (const target of templatePaths(text)) {
      if (!known.has(target)) errors.push(`${name} -> ${target}`);
    }
  }
  assert.deepEqual(errors, []);
});

test("HBS partials resolve through the preload registry, PascalCase aliases or local inline definitions", () => {
  const errors = [];
  for (const name of templates) {
    const text = sources.get(name).replace(/\{\{!--[\s\S]*?--\}\}/g, "");
    const inline = new Set([...text.matchAll(/\{\{~?\s*#\*inline\s+["']([^"']+)["']/g)].map(match => match[1]));
    for (const match of text.matchAll(/\{\{~?\s*(?:>|#>)\s*(?:"([^"]+)"|'([^']+)'|([^\s}]+))/g)) {
      const target = match[1] ?? match[2] ?? match[3];
      if (target === "@partial-block" || inline.has(target) || aliases.has(target) || preloaded.has(target)) continue;
      errors.push(`${name} -> ${target}`);
    }
  }
  assert.deepEqual(errors, []);
});

test("manifest entry points and stylesheet imports resolve", () => {
  const manifest = JSON.parse(read("system.json"));
  for (const name of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(language => language.path)]) {
    assert.doesNotThrow(() => read(name), name);
  }
  for (const name of manifest.styles) {
    for (const match of read(name).matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
      assert.doesNotThrow(() => read(path.posix.join(path.posix.dirname(name), match[1])), `${name} -> ${match[1]}`);
    }
  }
});
