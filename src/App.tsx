import { useState } from "react";
import type { TelegramClient } from "telegram";
import { Login } from "./Login";
import { Messenger } from "./Messenger";

export function App() {
  const [client, setClient] = useState<TelegramClient | null>(null);
  return client ? <Messenger client={client} /> : <Login onReady={setClient} />;
}
