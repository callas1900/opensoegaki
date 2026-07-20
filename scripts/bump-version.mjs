#!/usr/bin/env node
// Version-bump convenience script.
//
// Updates the version in src-tauri/Cargo.toml ([package].version) and
// package.json (version) to the same value, keeping them in sync.
//
// This script ONLY edits files. It never runs git commands (no commit, no
// tag, no push) — those steps remain fully manual, run by hand after
// reviewing the diff this script produces. See CONTRIBUTING.md's
// "Releasing" section for the full release flow.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function usageError(message) {
  if (message) {
    console.error(message);
  }
  console.error("Usage: pnpm version:bump <X.Y.Z>");
  process.exit(1);
}

function parseVersion(version) {
  return version.split(".").map((n) => parseInt(n, 10));
}

// Standard tuple comparison: major first, then minor, then patch.
function isStrictlyGreater(target, current) {
  for (let i = 0; i < 3; i++) {
    if (target[i] > current[i]) return true;
    if (target[i] < current[i]) return false;
  }
  return false;
}

function findPackageVersionLine(cargoTomlText) {
  const lines = cargoTomlText.split("\n");
  let inPackageTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\[package\]\s*$/.test(line)) {
      inPackageTable = true;
      continue;
    }
    if (inPackageTable && /^\[/.test(line)) {
      inPackageTable = false;
    }

    if (inPackageTable) {
      const match = line.match(/^(version\s*=\s*")([^"]*)(")/);
      if (match) {
        return { lineIndex: i, match };
      }
    }
  }

  return null;
}

function main() {
  const targetVersion = process.argv[2];

  if (!targetVersion || !SEMVER_RE.test(targetVersion)) {
    usageError();
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");
  const cargoTomlPath = path.join(repoRoot, "src-tauri", "Cargo.toml");
  const packageJsonPath = path.join(repoRoot, "package.json");

  const cargoTomlText = readFileSync(cargoTomlPath, "utf8");
  const found = findPackageVersionLine(cargoTomlText);

  if (!found) {
    console.error("could not find [package].version in src-tauri/Cargo.toml");
    process.exit(1);
    return;
  }

  const currentVersion = found.match[2];
  if (!SEMVER_RE.test(currentVersion)) {
    console.error(
      `unexpected version format in src-tauri/Cargo.toml: "${currentVersion}" (expected X.Y.Z)`
    );
    process.exit(1);
    return;
  }
  const currentParts = parseVersion(currentVersion);
  const targetParts = parseVersion(targetVersion);

  if (!isStrictlyGreater(targetParts, currentParts)) {
    console.error(
      `refusing to bump ${currentVersion} -> ${targetVersion} (must be a strictly greater version)`
    );
    process.exit(1);
    return;
  }

  // Rewrite only the matched [package].version line; every other line is
  // preserved exactly as-is.
  const lines = cargoTomlText.split("\n");
  const { lineIndex, match } = found;
  lines[lineIndex] = lines[lineIndex].replace(
    /^(version\s*=\s*")([^"]*)(")/,
    `$1${targetVersion}$3`
  );
  const newCargoTomlText = lines.join("\n");
  writeFileSync(cargoTomlPath, newCargoTomlText);

  const packageJsonText = readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(packageJsonText);
  packageJson.version = targetVersion;
  const trailingNewline = packageJsonText.endsWith("\n") ? "\n" : "";
  const newPackageJsonText =
    JSON.stringify(packageJson, null, 2) + trailingNewline;
  writeFileSync(packageJsonPath, newPackageJsonText);

  console.log(`Bumped version: ${currentVersion} -> ${targetVersion}`);
  console.log("  src-tauri/Cargo.toml");
  console.log("  package.json");
  console.log("");
  console.log("Files updated only — no git commands were run. Next steps:");
  console.log("  git add src-tauri/Cargo.toml package.json");
  console.log(`  git commit -m "version up to v${targetVersion}"`);
  console.log(`  git tag v${targetVersion}`);
  console.log(`  git push origin v${targetVersion}`);
}

main();
