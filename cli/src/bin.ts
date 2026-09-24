#!/usr/bin/env node
import { run } from "./main.js";
import { serveNativeVault } from "./platform/native-vault.js";

if (!serveNativeVault()) {
  process.exitCode = await run(process.argv.slice(2));
}
