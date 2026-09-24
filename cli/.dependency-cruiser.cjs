module.exports = {
  forbidden: [
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
    {
      name: "no-unresolved",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "commands-no-platform-imports",
      severity: "error",
      from: { path: "^src/commands/" },
      to: { path: "^src/platform/|^node:" },
    },
    {
      name: "platform-no-command-imports",
      severity: "error",
      from: { path: "^src/platform/" },
      to: { path: "^src/commands/|^src/main\\.ts$" },
    },
    {
      name: "output-pure",
      severity: "error",
      from: { path: "^src/output/" },
      to: { path: "^src/platform/|^src/commands/|^src/composition|^node:" },
    },
    {
      name: "no-sibling-source",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^\\.\\./" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "node", "default"],
      extensions: [".ts", ".js", ".json"],
    },
  },
};
