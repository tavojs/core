export const starterStyleBase = `:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: #000000;
}

button, a {
  -webkit-tap-highlight-color: transparent;
}

.home-shell {
  --accent: #7c3aed;
  --accent-soft: rgba(124, 58, 237, 0.1);
  --page: #f6f5f8;
  --surface: #ffffff;
  --surface-raised: #faf9fc;
  --ink: #111111;
  --muted: #6f6b76;
  --border: #dedbe4;
  --header: rgba(246, 245, 248, 0.78);
  color-scheme: light;
  min-height: 100vh;
  color: var(--ink);
  background: var(--page);
  transition: color 180ms ease, background-color 180ms ease;
}

.home-shell.theme-dark {
  --accent: #a78bfa;
  --accent-soft: rgba(167, 139, 250, 0.1);
  --page: #000000;
  --surface: #0d0d0d;
  --surface-raised: #171717;
  --ink: #ffffff;
  --muted: #a9a9a9;
  --border: #2a2a2a;
  --header: rgba(5, 5, 5, 0.74);
  color-scheme: dark;
}

.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--border);
  background: var(--header);
  backdrop-filter: blur(22px);
}

.header-inner {
  width: min(1180px, calc(100% - 48px));
  height: 68px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 24px;
  margin: 0 auto;
}

.brand {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 9px;
  color: var(--ink);
  font-size: 1.05rem;
  font-weight: 720;
  letter-spacing: -0.03em;
  text-decoration: none;
}

.brand img {
  display: block;
  width: 38px;
  height: 38px;
}

.brand-accent, .eyebrow, .card-number {
  color: var(--accent);
}

.starter-label {
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.theme-toggle {
  justify-self: end;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 13px;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.theme-toggle:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
  transform: translateY(-1px);
}

.page-content {
  width: min(1180px, calc(100% - 48px));
  margin: 0 auto;
}

.hero {
  min-height: 680px;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(390px, 0.95fr);
  align-items: center;
  gap: clamp(48px, 8vw, 110px);
  padding: 96px 0 80px;
  border-bottom: 1px solid var(--border);
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 22px;
  font-size: 0.78rem;
  font-weight: 760;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.status-dot {
  width: 7px;
  height: 7px;
  display: inline-block;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.hero h1 {
  max-width: 680px;
  margin: 0;
  font-family: Satoshi, Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(4rem, 7.4vw, 7rem);
  font-weight: 760;
  line-height: 0.91;
  letter-spacing: -0.075em;
}

.hero h1 span {
  color: var(--accent);
}

.hero-description {
  max-width: 560px;
  margin: 30px 0 0;
  color: var(--muted);
  font-size: clamp(1rem, 1.5vw, 1.2rem);
  line-height: 1.65;
}

.feature-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 30px;
}

.feature-pills span {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 7px 11px;
  color: var(--muted);
  background: var(--surface);
  font-size: 0.72rem;
  font-weight: 650;
}

.counter-panel {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface);
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.08);
}

.panel-header, .panel-footer {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 0 18px;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 650;
}

.panel-header {
  border-bottom: 1px solid var(--border);
}

.panel-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.panel-status .status-dot {
  width: 6px;
  height: 6px;
}

`;
