#!/usr/bin/env node

import { resolve } from "node:path";

import { validateCorpus } from "./corpus-gate.mjs";

function parseArguments(argv) {
  let root = process.cwd();
  let baselineRoot = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--baseline") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`DWG corpus gate: ${argument} requires a path`);
      }
      if (argument === "--root") root = resolve(value);
      else baselineRoot = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`DWG corpus gate: unsupported argument`);
  }
  return { baselineRoot, root: resolve(root) };
}

try {
  const report = await validateCorpus(parseArguments(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
