import { readonly, shallowRef, ref, computed, watchEffect, type Ref } from "vue";

export interface DialogueEntry {
  id: string;
  role: "system" | "user" | "agent" | "tool";
  content: string;
  ts: number;
  meta?: Record<string, unknown>;
}

export interface DialogueProviderOptions {
  endpoint: string;
  heartbeatMs?: number;
}

interface StreamState {
  status: Ref<"idle" | "connecting" | "streaming" | "error" | "closed">;
  entries: Ref<DialogueEntry[]>;
  error: Ref<string | null>;
  start: (payload: Record<string, unknown>) => Promise<void>;
  stop: () => void;
}

const decoder = new TextDecoder("utf-8");

export function createDialogueProvider(options: DialogueProviderOptions): StreamState {
  const status = ref<StreamState["status"]["value"]>("idle");
  const entries = shallowRef<DialogueEntry[]>([]);
  const error = ref<string | null>(null);
  let abortController: AbortController | null = null;
  let heartbeatTimer: number | null = null;
  let pendingText = "";

  const reset = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    pendingText = "";
    status.value = "idle";
    error.value = null;
  };

  const startHeartbeat = () => {
    if (options.heartbeatMs) {
      heartbeatTimer = window.setInterval(() => {
        entries.value = [
          ...entries.value,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: "[heartbeat] awaiting next token…",
            ts: Date.now(),
          },
        ].slice(-2000);
      }, options.heartbeatMs);
    }
  };

  const parseFrame = (frame: string) => {
    const rows = frame.split("\n").map((line) => line.trim());
    const dataRows = rows.filter((row) => row.startsWith("data:")).map((row) => row.slice(5));
    if (!dataRows.length) return;

    const payloadText = dataRows.join("");
    if (!payloadText || payloadText === "[DONE]") {
      status.value = "closed";
      stop();
      return;
    }

    try {
      const payload = JSON.parse(payloadText) as DialogueEntry;
      entries.value = [...entries.value, payload];
    } catch (err) {
      console.error("Failed to parse SSE frame", err);
      error.value = (err as Error).message;
      status.value = "error";
      stop();
    }
  };

  const pump = async (reader: ReadableStreamDefaultReader<Uint8Array> | undefined) => {
    if (!reader) throw new Error("Readable stream reader unavailable");

    const readChunk = async (): Promise<void> => {
      const { value, done } = await reader.read();
      if (done) {
        status.value = "closed";
        stop();
        return;
      }
      if (value) {
        pendingText += decoder.decode(value, { stream: true });
        const frames = pendingText.split("\n\n");
        pendingText = frames.pop() ?? "";
        frames.forEach(parseFrame);
      }
      await readChunk();
    };

    await readChunk();
  };

  const start = async (payload: Record<string, unknown>) => {
    stop();
    entries.value = [];
    abortController = new AbortController();
    status.value = "connecting";
    error.value = null;

    const response = await fetch(options.endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      signal: abortController.signal,
    });

    if (!response.body || !response.ok) {
      status.value = "error";
      error.value = `Stream failed: ${response.status} ${response.statusText}`;
      stop();
      return;
    }

    status.value = "streaming";
    startHeartbeat();

    try {
      await pump(response.body.getReader());
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        status.value = "idle";
        return;
      }
      console.error("Stream error", err);
      error.value = (err as Error).message;
      status.value = "error";
    } finally {
      stop();
    }
  };

  const stop = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  return {
    status: readonly(status),
    entries: computed(() => entries.value),
    error: readonly(error),
    start,
    stop,
  };
}
