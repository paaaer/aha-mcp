import { build } from "esbuild";

// Single self-contained file so the plugin works without `npm install` on the user's machine.
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/aha-mcp.mjs",
  banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
});
