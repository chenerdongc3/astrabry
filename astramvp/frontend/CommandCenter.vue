<template>
  <section class="command-center">
    <header class="command-center__header">
      <div>
        <p class="eyebrow">Astra // Command Stream</p>
        <h1>Agent Event Feed</h1>
      </div>
      <div class="header-actions">
        <button class="ghost" @click="startSession" :disabled="status === 'streaming'">
          {{ status === "streaming" ? "Streaming…" : "Start Session" }}
        </button>
        <button class="ghost warn" @click="stopSession" :disabled="status !== 'streaming'">
          Stop
        </button>
      </div>
    </header>

    <div class="terminal-panel">
      <RecycleScroller
        class="terminal-scroll"
        :items="entries"
        :item-size="48"
        key-field="id"
        page-mode
      >
        <template #default="{ item }">
          <article class="terminal-line" :data-role="item.role">
            <span class="role">{{ item.role.toUpperCase() }}</span>
            <p>{{ item.content }}</p>
            <time>{{ formatTs(item.ts) }}</time>
          </article>
        </template>
      </RecycleScroller>

      <footer class="status-bar">
        <span>Status: {{ status }}</span>
        <span v-if="error" class="error">{{ error }}</span>
      </footer>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { RecycleScroller } from "vue-virtual-scroller";
import { createDialogueProvider } from "./providers/dialogue";

const provider = createDialogueProvider({
  endpoint: "/api/agent/stream",
  heartbeatMs: 15000,
});

const entries = computed(() => provider.entries.value);
const status = computed(() => provider.status.value);
const error = computed(() => provider.error.value);

const startSession = () =>
  provider.start({
    session_id: crypto.randomUUID(),
    locale: "en-US",
    agent: "astra-mcp",
  });

const stopSession = () => provider.stop();

const formatTs = (ts: number) => new Date(ts).toLocaleTimeString();
</script>

<style scoped>
:global(:root) {
  --neo-bg: 230 21% 6%;
  --neo-card: 221 28% 11%;
  --neo-glow: 162 100% 62%;
  --neo-text: 210 40% 96%;
  --neo-muted: 215 18% 52%;
  color-scheme: dark;
}

.command-center {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.5rem;
  min-height: 100vh;
  background: radial-gradient(circle at top, hsl(230 25% 12%), hsl(var(--neo-bg)));
  color: hsl(var(--neo-text));
  font-family: "JetBrains Mono", ui-monospace, monospace;
}

.command-center__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.eyebrow {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.4em;
  color: hsl(var(--neo-muted));
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.ghost {
  border: 1px solid hsl(var(--neo-glow) / 0.4);
  background: hsl(var(--neo-card) / 0.7);
  color: hsl(var(--neo-text));
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.1em;
  transition: background 160ms, box-shadow 160ms;
}

.ghost:not(:disabled):hover {
  background: hsl(var(--neo-card) / 0.9);
  box-shadow: 0 0 18px hsl(var(--neo-glow) / 0.35);
}

.ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ghost.warn {
  border-color: hsl(8 91% 62% / 0.4);
  color: hsl(8 91% 62%);
}

.terminal-panel {
  flex: 1;
  backdrop-filter: blur(22px);
  background: linear-gradient(135deg, hsl(var(--neo-card) / 0.72), hsl(var(--neo-card) / 0.55));
  border: 1px solid hsl(var(--neo-glow) / 0.15);
  border-radius: 1.5rem;
  box-shadow:
    0 20px 60px hsl(230 40% 5% / 0.85),
    inset 0 0 0 1px hsl(var(--neo-glow) / 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.terminal-scroll {
  flex: 1;
}

.terminal-line {
  display: grid;
  grid-template-columns: 120px 1fr minmax(90px, auto);
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid hsl(var(--neo-glow) / 0.08);
}

.terminal-line[data-role="agent"] {
  background: hsl(var(--neo-glow) / 0.06);
}

.role {
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: hsl(var(--neo-muted));
}

.terminal-line p {
  margin: 0;
  color: hsl(var(--neo-text));
  font-size: 0.92rem;
}

.terminal-line time {
  font-size: 0.75rem;
  text-align: right;
  color: hsl(var(--neo-muted));
}

.status-bar {
  display: flex;
  justify-content: space-between;
  padding: 0.85rem 1.5rem;
  font-size: 0.8rem;
  border-top: 1px solid hsl(var(--neo-glow) / 0.1);
  background: hsl(var(--neo-card) / 0.65);
}

.status-bar .error {
  color: hsl(0 80% 65%);
}
</style>
