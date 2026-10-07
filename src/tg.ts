import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { computeCheck } from "telegram/Password";

const KEY_CREDS = "tglite.creds";
const KEY_SESSION = "tglite.session";

export interface Creds {
  apiId: number;
  apiHash: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the session lives until the tab closes.
  }
}

export function loadCreds(): Creds | null {
  const raw = read(KEY_CREDS);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Creds;
    return Number.isInteger(c.apiId) && typeof c.apiHash === "string" ? c : null;
  } catch {
    return null;
  }
}

export function saveCreds(c: Creds | null) {
  write(KEY_CREDS, c ? JSON.stringify(c) : null);
}

export function createClient(c: Creds): TelegramClient {
  const client = new TelegramClient(new StringSession(read(KEY_SESSION) ?? ""), c.apiId, c.apiHash, {
    connectionRetries: 5,
    useWSS: true,
  });
  client.setLogLevel("error" as never);
  return client;
}

export function persistSession(client: TelegramClient) {
  write(KEY_SESSION, (client.session as StringSession).save());
}

export function clearSession() {
  write(KEY_SESSION, null);
}

export function errorText(e: unknown): string {
  const msg = (e as { errorMessage?: string; message?: string })?.errorMessage ?? (e as Error)?.message ?? String(e);
  const known: Record<string, string> = {
    PHONE_NUMBER_INVALID: "Неверный номер телефона",
    PHONE_CODE_INVALID: "Неверный код",
    PHONE_CODE_EXPIRED: "Код истёк, запросите новый",
    PASSWORD_HASH_INVALID: "Неверный пароль",
    API_ID_INVALID: "Неверные api_id / api_hash",
    PHONE_NUMBER_BANNED: "Номер заблокирован в Telegram",
    FLOOD: "Слишком много попыток, подождите",
  };
  for (const k of Object.keys(known)) if (msg.includes(k)) return known[k];
  return msg;
}

export async function sendCode(client: TelegramClient, c: Creds, phone: string) {
  const { phoneCodeHash } = await client.sendCode({ apiId: c.apiId, apiHash: c.apiHash }, phone);
  return phoneCodeHash;
}

/** Returns "ok", or "password" when the account has 2FA enabled. */
export async function signIn(client: TelegramClient, phone: string, phoneCodeHash: string, code: string) {
  try {
    const r = await client.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }));
    if (r instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new Error("Этот номер не зарегистрирован в Telegram");
    }
    return "ok" as const;
  } catch (e) {
    if ((e as { errorMessage?: string }).errorMessage === "SESSION_PASSWORD_NEEDED") return "password" as const;
    throw e;
  }
}

export async function checkPassword(client: TelegramClient, password: string) {
  const srp = await client.invoke(new Api.account.GetPassword());
  await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(srp, password) }));
}

export async function passwordHint(client: TelegramClient) {
  const srp = await client.invoke(new Api.account.GetPassword());
  return srp.hint ?? "";
}
