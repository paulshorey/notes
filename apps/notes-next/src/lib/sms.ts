export type SmsConfig = { accountSid: string; username: string; password: string; from: string; to: string };

export class SmsError extends Error {
  constructor(public readonly code: string, public readonly acceptedParts = 0) {
    super("SMS could not be submitted.");
  }
}

export function readSmsConfig(env: Record<string, string | undefined> = process.env): SmsConfig {
  const accountSid = env.TWILIO_ACCOUNT_SID ?? "";
  const useApiKey = Boolean(env.TWILIO_API_KEY_SID || env.TWILIO_API_KEY_SECRET);
  const username = useApiKey ? env.TWILIO_API_KEY_SID ?? "" : accountSid;
  const password = (useApiKey ? env.TWILIO_API_KEY_SECRET : env.TWILIO_AUTH_TOKEN) ?? "";
  const from = env.TWILIO_FROM_NUMBER ?? "";
  const to = env.TWILIO_TO_NUMBER ?? "";
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid) || !password ||
      (useApiKey && !/^SK[0-9a-f]{32}$/i.test(username)) ||
      !/^\+[1-9]\d{7,14}$/.test(from) || !/^\+[1-9]\d{7,14}$/.test(to)) {
    throw new SmsError("configuration_missing");
  }
  return { accountSid, username, password, from, to };
}

// Leave room for page labels and keep each request under Twilio's 1,600 limit.
// Iterate by code point so a boundary never splits an emoji's surrogate pair.
export function chunkSms(message: string): string[] {
  if (!message) throw new SmsError("empty_message");
  const chunks: string[] = [];
  let chunk = "";
  for (const character of message) {
    if (chunk.length + character.length > 1400) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 4) throw new SmsError("message_too_long");
  return chunks.map((body, index) => chunks.length > 1 ? `${body}\n[Page: ${index + 1} of ${chunks.length}]` : body);
}

type SmsDependencies = { fetch: typeof fetch; pause: (ms: number) => Promise<void>; now: () => number };

export async function sendSms(
  message: string,
  config: SmsConfig,
  dependencies: Partial<SmsDependencies> = {},
): Promise<void> {
  const request = dependencies.fetch ?? fetch;
  const pause = dependencies.pause ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = dependencies.now ?? Date.now;
  const chunks = chunkSms(message);
  let acceptedParts = 0;

  for (const body of chunks) {
    const started = now();
    try {
      const response = await request(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: config.to, From: config.from, Body: body }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) {
        const code = typeof data.code === "number" ? String(data.code) : `http_${response.status}`;
        throw new SmsError(code, acceptedParts);
      }
      if (typeof data.sid !== "string" || !/^SM[0-9a-f]{32}$/i.test(data.sid) ||
          !["queued", "accepted", "sending", "sent", "delivered"].includes(data.status)) {
        throw new SmsError("not_accepted", acceptedParts);
      }
      acceptedParts++;
    } catch (error) {
      if (error instanceof SmsError) throw error;
      // Never retry an ambiguous timeout: Twilio may already have accepted it.
      throw new SmsError("request_failed", acceptedParts);
    }
    if (acceptedParts < chunks.length) await pause(Math.max(0, 10000 - (now() - started)));
  }
}
