import { defineRailway, preserve, project, service } from "railway/iac";

// WebArts also hosts Map and NLP. This repository owns only its Notes service.
export const partial = "notes";

export default defineRailway((ctx) => {
  if (ctx.projectId !== "c6260c51-8b01-4934-8ccb-9cf32456744c") {
    throw new Error("Notes IaC must target the WebArts Railway project.");
  }

  // CLI 5.62.1 may omit ctx.environment; the persistent environment ID is stable.
  const production = ctx.environmentId === "46907359-520d-41a3-adf3-6ed23379b418";
  const development = ctx.environmentId === "4e7d33aa-1de0-441f-a105-352bbe3b6697";
  const branch = production ? "prod" : development ? "main" : process.env.RAILWAY_IAC_BRANCH;
  if (!branch) {
    throw new Error("Preview applies require RAILWAY_IAC_BRANCH set to the preview's existing branch.");
  }
  const notesNext = service(production ? "notes" : "apps/notes-next", {
    source: { repo: "paulshorey/notes", branch },
    env: {
      AUTH_SECRET: preserve(),
      AUTH_TRUST_HOST: preserve(),
      DB_NOTES_URL: preserve(),
      JINA_API_KEY: preserve(),
      OPENAI_API_KEY: preserve(),
    },
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm --filter notes-next build",
      watchPatterns: [
        "apps/notes-next/**",
        "lib/db-notes/**",
        "lib/atomic-editor/**",
        "lib/config/**",
        "package.json",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml",
        "turbo.json",
      ],
    },
    deploy: {
      preDeployCommand: ["pnpm --filter @lib/db-notes db:migrate"],
      startCommand: "pnpm --filter notes-next start",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 5,
    },
  });

  return project("WebArts", { resources: [notesNext] });
});
