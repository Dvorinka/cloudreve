import { build } from "bun";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const output = process.argv[2];

assert(output, "Provide an executable output path");
assert(["linux", "darwin", "win32"].includes(process.platform), "Unsupported release platform");
assert(["x64", "arm64"].includes(process.arch), "Unsupported release architecture");

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve("@napi-rs/keyring"));
const suffix = process.platform === "linux" ? "-gnu" : process.platform === "win32" ? "-msvc" : "";

const binding = nativeRequire.resolve(
  `@napi-rs/keyring-${process.platform}-${process.arch}${suffix}`,
);

const platform = process.platform === "win32" ? "windows" : process.platform;
const baseline = process.arch === "x64" && process.platform !== "darwin" ? "-baseline" : "";
const target = `bun-${platform}-${process.arch}${baseline}`;

// Resolve the current runner's native addon statically so Bun embeds it in the executable.
await build({
  entrypoints: [resolve("src/bin.ts")],
  compile: { target, outfile: resolve(output), autoloadDotenv: false, autoloadBunfig: false },
  minify: true,
  define: { __CLOUDREVE_STANDALONE__: "true" },
  plugins: [
    {
      name: "native-vault",
      setup(builder) {
        builder.onResolve({ filter: /^@napi-rs\/keyring$/ }, () => ({ path: binding }));
      },
    },
  ],
});
