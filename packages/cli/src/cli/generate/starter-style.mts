import { starterStyleBase } from "./starter-style-base.mjs";

export function defaultStyleSource(): string {
  return starterStyleBase + `.counter-stage {
  min-height: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 54px 30px;
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 46px 46px;
  background-position: -1px -1px;
}

.counter-caption {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.counter-value {
  display: block;
  margin: 18px auto 38px;
  font-family: Satoshi, Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(6rem, 13vw, 9rem);
  font-weight: 760;
  line-height: 0.9;
  letter-spacing: -0.08em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 42px var(--accent-soft);
}

.counter-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.counter-button, .reset-button {
  height: 46px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.counter-button {
  width: 52px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--ink);
  background: var(--surface-raised);
}

.counter-button--primary {
  border-color: var(--accent);
  color: #000000;
  background: var(--accent);
  box-shadow: inset 0 1px rgba(255, 255, 255, 0.22);
}

.reset-button {
  min-width: 92px;
  padding: 0 18px;
  color: var(--muted);
  background: var(--surface);
  font-size: 0.82rem;
  font-weight: 680;
}

.counter-button:hover, .reset-button:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.counter-button:active, .reset-button:active {
  transform: scale(0.98);
}

.counter-icon {
  position: relative;
  display: block;
  width: 18px;
  height: 18px;
}

.counter-icon::before, .counter-icon--plus::after {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 999px;
  background: currentColor;
  content: "";
  transform: translate(-50%, -50%);
}

.counter-icon::before {
  width: 18px;
  height: 2px;
}

.counter-icon--plus::after {
  width: 2px;
  height: 18px;
}

.panel-footer {
  border-top: 1px solid var(--border);
}

.panel-footer code, .app-footer code {
  color: var(--accent);
  font-size: 0.75rem;
}

.starter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding: 72px 0;
  border-bottom: 1px solid var(--border);
}

.starter-grid article {
  min-height: 210px;
  padding: 26px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: var(--surface);
  transition: transform 180ms ease, border-color 180ms ease;
}

.starter-grid article:hover {
  border-color: var(--accent);
  transform: translateY(-3px);
}

.card-number {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.35rem;
  font-weight: 750;
  letter-spacing: -0.04em;
}

.starter-grid h2 {
  margin: 44px 0 10px;
  font-size: 1.08rem;
  letter-spacing: -0.025em;
}

.starter-grid p {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.app-footer {
  min-height: 94px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  color: var(--muted);
  font-size: 0.8rem;
}

button:focus-visible, a:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent);
  outline-offset: 3px;
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 64px;
    padding-top: 76px;
  }

  .hero-copy {
    max-width: 720px;
  }

  .counter-panel {
    width: min(560px, 100%);
  }

  .starter-grid {
    grid-template-columns: 1fr;
  }

  .starter-grid article {
    min-height: 170px;
  }

  .starter-grid h2 {
    margin-top: 32px;
  }
}

@media (max-width: 560px) {
  .header-inner, .page-content {
    width: min(100% - 28px, 1180px);
  }

  .header-inner {
    grid-template-columns: 1fr auto;
  }

  .starter-label {
    display: none;
  }

  .hero {
    min-height: auto;
    padding: 64px 0;
  }

  .hero h1 {
    font-size: clamp(3.5rem, 18vw, 5rem);
  }

  .counter-stage {
    min-height: 360px;
    padding-inline: 16px;
  }

  .panel-footer {
    align-items: flex-start;
    flex-direction: column;
    padding-block: 14px;
  }

  .app-footer {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}`;
}
