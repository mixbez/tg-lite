import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Api, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { clearSession, errorText } from "./tg";

interface Chat {
  id: string;
  title: string;
  last: string;
  lastOut: boolean;
  date: number;
  unread: number;
  isUser: boolean;
  peer: Api.TypeInputPeer;
}

interface Msg {
  id: number;
  text: string;
  out: boolean;
  date: number;
  sender: string;
}

const PAGE = 50;
const AVATAR_COLORS = ["#e17076", "#faa774", "#a695e7", "#7bc862", "#6ec9cb", "#65aadd", "#ee7aae"];

function textOf(m: Api.TypeMessage): string {
  if (m instanceof Api.MessageService) return "[служебное сообщение]";
  if (m instanceof Api.Message) {
    if (m.message) return m.message;
    if (m.media) return "[медиа]";
  }
  return "";
}

function senderName(m: Api.Message): string {
  const s = (m as unknown as { sender?: { title?: string; firstName?: string; lastName?: string } }).sender;
  if (!s) return "";
  return s.title ?? [s.firstName, s.lastName].filter(Boolean).join(" ");
}

function toMsg(m: Api.Message): Msg {
  return { id: m.id, text: textOf(m), out: !!m.out, date: m.date, sender: senderName(m) };
}

function time(unix: number, short = false): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (!short || d.toDateString() === now.toDateString()) return hm;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function Avatar({ id, title }: { id: string; title: string }) {
  // Telegram picks one of seven avatar colours by peer id.
  const color = AVATAR_COLORS[Number((BigInt(id) % 7n + 7n) % 7n)];
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0])
    .join("")
    .toUpperCase();
  return (
    <div className="avatar" style={{ background: color }} aria-hidden>
      {initials || "?"}
    </div>
  );
}

export function Messenger({ client }: { client: TelegramClient }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const openRef = useRef<string | null>(null);
  const chatsRef = useRef<Chat[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const keepScroll = useRef<number | null>(null);
  const stickBottom = useRef(true);

  chatsRef.current = chats;
  openRef.current = openId;
  const open = chats.find((c) => c.id === openId) ?? null;

  const loadChats = useCallback(async () => {
    try {
      const dialogs = await client.getDialogs({ limit: 100 });
      setChats(
        dialogs
          .filter((d) => d.id)
          .map((d) => ({
            id: d.id!.toString(),
            title: d.title || d.name || "Без названия",
            last: d.message ? textOf(d.message) : "",
            lastOut: !!d.message?.out,
            date: d.date,
            unread: d.unreadCount,
            isUser: d.isUser,
            peer: d.inputEntity,
          })),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingChats(false);
    }
  }, [client]);

  useEffect(() => {
    void loadChats();
    const event = new NewMessage({});
    const onMessage = (ev: NewMessageEvent) => {
      const m = ev.message;
      const chatId = m.chatId?.toString();
      if (!chatId) return;
      const msg = toMsg(m);
      const isOpen = openRef.current === chatId;
      if (isOpen) {
        setMsgs((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
        const chat = chatsRef.current.find((c) => c.id === chatId);
        if (chat && !msg.out && document.visibilityState === "visible") void client.markAsRead(chat.peer).catch(() => {});
      }
      if (!chatsRef.current.some((c) => c.id === chatId)) {
        void loadChats();
        return;
      }
      setChats((prev) => {
        const i = prev.findIndex((c) => c.id === chatId);
        if (i < 0) return prev;
        const c = prev[i];
        const next = {
          ...c,
          last: msg.text,
          lastOut: msg.out,
          date: msg.date,
          unread: isOpen || msg.out ? c.unread : c.unread + 1,
        };
        return [next, ...prev.slice(0, i), ...prev.slice(i + 1)];
      });
    };
    client.addEventHandler(onMessage, event);
    return () => client.removeEventHandler(onMessage, event);
  }, [client, loadChats]);

  async function openChat(chat: Chat) {
    setOpenId(chat.id);
    setMsgs([]);
    setDraft("");
    setHasMore(false);
    setLoadingMsgs(true);
    stickBottom.current = true;
    try {
      const list = await client.getMessages(chat.peer, { limit: PAGE });
      if (openRef.current !== chat.id) return;
      setMsgs(list.map(toMsg).reverse());
      setHasMore(list.length === PAGE);
      setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unread: 0 } : c)));
      void client.markAsRead(chat.peer).catch(() => {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMsgs(false);
    }
  }

  async function loadOlder() {
    if (!open || loadingMsgs || !hasMore || msgs.length === 0) return;
    const chatId = open.id;
    setLoadingMsgs(true);
    try {
      const list = await client.getMessages(open.peer, { limit: PAGE, offsetId: msgs[0].id });
      if (openRef.current !== chatId) return;
      const el = listRef.current;
      keepScroll.current = el ? el.scrollHeight - el.scrollTop : null;
      setMsgs((prev) => [...list.map(toMsg).reverse(), ...prev]);
      setHasMore(list.length === PAGE);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMsgs(false);
    }
  }

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keepScroll.current !== null) {
      el.scrollTop = el.scrollHeight - keepScroll.current;
      keepScroll.current = null;
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs]);

  async function send() {
    const text = draft.trim();
    if (!open || !text) return;
    setDraft("");
    stickBottom.current = true;
    try {
      const sent = await client.sendMessage(open.peer, { message: text });
      const msg = toMsg(sent);
      setMsgs((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
      setChats((prev) => {
        const i = prev.findIndex((c) => c.id === open.id);
        if (i < 0) return prev;
        const next = { ...prev[i], last: msg.text, lastOut: true, date: msg.date };
        return [next, ...prev.slice(0, i), ...prev.slice(i + 1)];
      });
    } catch (e) {
      setDraft(text);
      setError(errorText(e));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  async function logout() {
    if (!confirm("Выйти из аккаунта?")) return;
    try {
      await client.invoke(new Api.auth.LogOut());
    } catch {
      // The local session is dropped regardless.
    }
    clearSession();
    location.reload();
  }

  const q = filter.trim().toLowerCase();
  const visible = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;

  return (
    <div className={"app" + (open ? " has-open" : "")}>
      <aside className="sidebar">
        <header className="bar">
          <input
            className="search"
            placeholder="Поиск"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="logout" onClick={() => void logout()}>
            Выйти
          </button>
        </header>
        <div className="chats">
          {loadingChats && <p className="muted pad">Загрузка чатов…</p>}
          {!loadingChats && visible.length === 0 && <p className="muted pad">Нет чатов</p>}
          {visible.map((c) => (
            <button
              key={c.id}
              className={"chat" + (c.id === openId ? " active" : "")}
              onClick={() => void openChat(c)}
            >
              <Avatar id={c.id} title={c.title} />
              <div className="chat-body">
                <div className="row">
                  <span className="title">{c.title}</span>
                  <span className="date">{c.date ? time(c.date, true) : ""}</span>
                </div>
                <div className="row">
                  <span className="preview">
                    {c.lastOut && <span className="you">Вы: </span>}
                    {c.last}
                  </span>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="pane">
        {!open ? (
          <div className="center muted">Выберите чат</div>
        ) : (
          <>
            <header className="bar">
              <button className="icon back" title="Назад" onClick={() => setOpenId(null)}>
                ←
              </button>
              <Avatar id={open.id} title={open.title} />
              <span className="title">{open.title}</span>
            </header>
            <div
              className="messages"
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                if (el.scrollTop < 80) void loadOlder();
              }}
            >
              {loadingMsgs && msgs.length === 0 && <p className="muted pad">Загрузка…</p>}
              {msgs.map((m, i) => {
                const showName = !open.isUser && !m.out && m.sender && msgs[i - 1]?.sender !== m.sender;
                return (
                  <div key={m.id} className={"msg " + (m.out ? "out" : "in")}>
                    {showName && <div className="sender">{m.sender}</div>}
                    <span className="text">{m.text}</span>
                    <span className="time">{time(m.date)}</span>
                  </div>
                );
              })}
            </div>
            <footer className="composer">
              <textarea
                rows={1}
                placeholder="Сообщение"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                maxLength={4096}
              />
              <button onClick={() => void send()} disabled={!draft.trim()} title="Отправить">
                ➤
              </button>
            </footer>
          </>
        )}
      </main>
      {error && (
        <div className="toast" role="alert" onClick={() => setError("")}>
          {error}
        </div>
      )}
    </div>
  );
}
