import { useEffect, useState, type FormEvent } from "react";
import type { TelegramClient } from "telegram";
import {
  checkPassword,
  clearSession,
  createClient,
  errorText,
  loadCreds,
  passwordHint,
  persistSession,
  saveCreds,
  resendCode,
  sendCode,
  signIn,
  type CodeInfo,
  type Creds,
} from "./tg";

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
}

type Step = "boot" | "creds" | "phone" | "code" | "password";

export function Login({ onReady }: { onReady: (c: TelegramClient) => void }) {
  const [step, setStep] = useState<Step>("boot");
  const [creds, setCreds] = useState<Creds | null>(null);
  const [client, setClient] = useState<TelegramClient | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState<CodeInfo | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect(c: Creds) {
    const cl = createClient(c);
    try {
      await withTimeout(cl.connect(), 20000, "Нет соединения с серверами Telegram");
    } catch (e) {
      // Stop the background reconnect loop of the abandoned client.
      void cl.destroy().catch(() => {});
      throw e;
    }
    setCreds(c);
    setClient(cl);
    if (await cl.checkAuthorization()) {
      persistSession(cl);
      onReady(cl);
    } else {
      clearSession();
      setStep("phone");
    }
  }

  useEffect(() => {
    const c = loadCreds();
    if (!c) {
      setStep("creds");
      return;
    }
    connect(c).catch((e) => {
      setError(errorText(e));
      setStep("creds");
    });
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    if (step === "creds") {
      return run(async () => {
        const c = { apiId: Number(v("apiId")), apiHash: v("apiHash") };
        if (!Number.isInteger(c.apiId) || c.apiId <= 0 || !/^[0-9a-f]{32}$/i.test(c.apiHash)) {
          throw new Error("api_id — число, api_hash — 32 символа из my.telegram.org");
        }
        saveCreds(c);
        await connect(c);
      });
    }
    if (!client || !creds) return;
    if (step === "phone") {
      return run(async () => {
        const p = v("phone").replace(/[^\d+]/g, "");
        setCode(await sendCode(client, creds, p));
        setPhone(p);
        setStep("code");
      });
    }
    if (step === "code") {
      return run(async () => {
        if (!code) return;
        if ((await signIn(client, phone, code.hash, v("code"))) === "password") {
          setHint(await passwordHint(client).catch(() => ""));
          setStep("password");
          return;
        }
        persistSession(client);
        onReady(client);
      });
    }
    if (step === "password") {
      return run(async () => {
        await checkPassword(client, String(f.get("password") ?? ""));
        persistSession(client);
        onReady(client);
      });
    }
  }

  if (step === "boot") {
    return (
      <div className="center">
        <p className="muted">{error || "Подключение…"}</p>
      </div>
    );
  }

  return (
    <div className="center">
      <form className="login" onSubmit={submit}>
        <h1>tg-lite</h1>
        {step === "creds" && (
          <>
            <p className="muted">
              Ключи приложения с <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">my.telegram.org/apps</a>.
              Хранятся только в этом браузере.
            </p>
            <input name="apiId" placeholder="api_id" inputMode="numeric" autoComplete="off" required />
            <input name="apiHash" placeholder="api_hash" autoComplete="off" required />
          </>
        )}
        {step === "phone" && (
          <>
            <p className="muted">Номер телефона аккаунта Telegram</p>
            <input name="phone" type="tel" placeholder="+7 999 123-45-67" autoComplete="tel" autoFocus required />
          </>
        )}
        {step === "code" && (
          <>
            <p className="muted">
              Код для +{phone.replace(/^\+/, "")}
              <br />
              {code?.where}
            </p>
            <input name="code" inputMode="numeric" placeholder="Код" autoComplete="one-time-code" autoFocus required />
          </>
        )}
        {step === "password" && (
          <>
            <p className="muted">Облачный пароль (2FA){hint ? ` · подсказка: ${hint}` : ""}</p>
            <input name="password" type="password" placeholder="Пароль" autoComplete="current-password" autoFocus required />
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Далее"}
        </button>
        {step === "code" && code?.canResend && client && (
          <button
            type="button"
            className="link"
            disabled={busy}
            onClick={() => void run(async () => setCode(await resendCode(client, phone, code.hash)))}
          >
            Отправить код другим способом
          </button>
        )}
        {step !== "creds" && (
          <button
            type="button"
            className="link"
            onClick={() => {
              saveCreds(null);
              clearSession();
              location.reload();
            }}
          >
            Сменить api_id
          </button>
        )}
      </form>
    </div>
  );
}
