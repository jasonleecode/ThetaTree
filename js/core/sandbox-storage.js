import "./sandbox-engine.js";
const { STORAGE_KEY, defaultStore, decodeStore, encodeStore } =
  globalThis.ThetaEngine;

async function getWorkspace() {
  const response = await fetch("/api/workspace", { cache: "no-store" });
  if (
    response.status === 404 ||
    (response.ok && response.headers.get("content-type")?.includes("text/html"))
  )
    return null;
  if (!response.ok) throw Error("无法读取模拟工作区");
  return response.json();
}
async function putWorkspace(revision, document) {
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision, store: JSON.parse(document) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(Error(data.error || "保存失败"), {
      status: response.status,
    });
  return data.revision;
}
// Keep in-flight writes and per-symbol undo stacks alive across hash navigation.
let session, opening;
export async function openSandbox() {
  if (session) return session;
  if (!opening)
    opening = load().finally(() => {
      opening = null;
    });
  return opening;
}
async function load() {
  let db = await getWorkspace(),
    revision = db?.revision;
  let store;
  if (!db?.store) {
    const local = localStorage.getItem(STORAGE_KEY);
    store = local ? decodeStore(local) : defaultStore();
    if (db) {
      try {
        revision = await putWorkspace(revision, encodeStore(store));
      } catch (e) {
        if (e.status !== 409) throw e;
        db = await getWorkspace();
        store = decodeStore(JSON.stringify(db.store));
        revision = db.revision;
      }
    }
  } else store = decodeStore(JSON.stringify(db.store));
  let last = encodeStore(store),
    pending = last,
    writing = false;
  const subscribers = new Set();
  const emit = () => subscribers.forEach((fn) => fn());
  const state = {
    store,
    local: !db,
    error: "",
    saving: false,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    async save() {
      pending = encodeStore(store);
      if (writing || (pending === last && !state.error)) return;
      writing = state.saving = true;
      state.error = "";
      emit();
      try {
        while (last !== pending) {
          const current = pending;
          if (db) revision = await putWorkspace(revision, current);
          else localStorage.setItem(STORAGE_KEY, current);
          last = current;
        }
      } catch (e) {
        state.error = e.message;
      } finally {
        writing = state.saving = false;
        emit();
      }
    },
  };
  const warn = (e) => {
    if (pending !== last) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", warn);
  session = state;
  return session;
}
