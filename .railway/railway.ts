import { defineRailway, project, service } from "railway/iac";

export default defineRailway((ctx) => {
  const notesNext = service("notes-next", {
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm --filter notes-next build",
      watchPatterns: [
        "apps/notes-next/**",
        "lib/db-notes/**",
        "lib/atomic-editor/**",
      ],
    },
    deploy: {
      preDeployCommand: ["pnpm --filter @lib/db-notes db:migrate"],
      startCommand: "pnpm --filter notes-next start",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
  });

  return project(ctx.projectName, { resources: [notesNext] });
});
