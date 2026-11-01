import { bucket, defineRailway, preserve, project, ref, service } from "railway/iac";

// The Notes project also contains Postgres, its volume, and the Postgres-PITR
// backup bucket. Those stay under dashboard ownership; this partial owns only
// the web service and the media bucket it uses.
export const partial = "notes";

export default defineRailway((ctx) => {
  if (ctx.projectId !== "7c451bd1-350a-4fb3-a08f-5295863269ce") {
    throw new Error("Notes IaC must target the Notes Railway project.");
  }

  // CLI 5.62.1 may omit ctx.environment; the persistent environment ID is stable.
  const production = ctx.environmentId === "f65d1bcb-a786-4678-a431-e9f6c3ff154f";
  const development = ctx.environmentId === "8cbb1415-ac2b-46c3-ae8c-144265017189";
  const branch = production ? "prod" : development ? "main" : process.env.RAILWAY_IAC_BRANCH;
  if (!branch) {
    throw new Error("Preview applies require RAILWAY_IAC_BRANCH set to the preview's existing branch.");
  }

  // Private S3-compatible storage for item files. Region cannot change later.
  const media = bucket("media", { region: "iad" });

  const notesNext = service("apps/notes-next", {
    source: { repo: "paulshorey/notes", branch },
    env: {
      AUTH_SECRET: preserve(),
      AUTH_TRUST_HOST: preserve(),
      DB_NOTES_URL: preserve(),
      JINA_API_KEY: preserve(),
      OPENAI_API_KEY: preserve(),
      RESEND_EMAIL_API_KEY: preserve(),
      RESEND_FROM_ADDRESS: preserve(),
      TWILIO_ACCOUNT_SID: preserve(),
      TWILIO_AUTH_TOKEN: preserve(),
      TWILIO_FROM_NUMBER: preserve(),
      TWILIO_TO_NUMBER: preserve(),
      MEDIA_BUCKET_NAME: ref(media, "BUCKET"),
      MEDIA_BUCKET_ENDPOINT: ref(media, "ENDPOINT"),
      MEDIA_BUCKET_REGION: ref(media, "REGION"),
      MEDIA_BUCKET_ACCESS_KEY_ID: ref(media, "ACCESS_KEY_ID"),
      MEDIA_BUCKET_SECRET_ACCESS_KEY: ref(media, "SECRET_ACCESS_KEY"),
    },
    build: {
      builder: "RAILPACK",
      buildCommand: "pnpm --filter notes-next build",
      watchPatterns: [
        "apps/notes-next/**",
        "lib/db-items/**",
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
      preDeployCommand: ["pnpm --filter @lib/db-items db:migrate"],
      startCommand: "pnpm --filter notes-next start",
      healthcheckPath: "/api/health",
      healthcheckTimeout: 30,
      restartPolicyMaxRetries: 5,
    },
  });

  return project("Notes", { resources: [notesNext, media] });
});
