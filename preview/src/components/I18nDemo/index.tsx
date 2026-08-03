import { createTavo, TavoController } from "@tavojs/core";
import { i18n } from "../../i18n/index.ts";

class I18nDemoController extends TavoController {
  setLocale(locale: "en" | "es" | "hy") {
    i18n.setLocale(locale);
  }

  navigateLocale(locale: "en" | "es" | "hy") {
    this.router.navigate(i18n.localizePath("/i18n", locale));
  }
}

export const I18nDemo = createTavo<Record<string, never>, Record<string, never>, I18nDemoController>({
  controller: I18nDemoController,
  view: ({ controller }) => {
    const text = i18n.text;

    return (
      <section className="tavo-panel">
        <p className="tavo-muted">{text.page.eyebrow}</p>
        <h3>{text.page.title}</h3>
        <p>{text.page.intro}</p>
        <div className="tavo-actions">
          <button type="button" onClick={() => controller?.setLocale("en")}>
            {text.actions.english}
          </button>
          <button type="button" onClick={() => controller?.setLocale("es")}>
            {text.actions.spanish}
          </button>
          <button type="button" onClick={() => controller?.setLocale("hy")}>
            {text.actions.armenian}
          </button>
        </div>
        <div className="tavo-grid">
          <article className="tavo-card">
            <h4>{text.cards.direct.title}</h4>
            <p>{text.cards.direct.body}</p>
            <code>i18n.text.cards.direct.title</code>
          </article>
          <article className="tavo-card">
            <h4>{text.cards.dynamic.title}</h4>
            <p>{text.cards.dynamic.body}</p>
            <code>{i18n.t("page.greeting", { name: "Tavo.js" })}</code>
          </article>
          <article className="tavo-card">
            <h4>{text.cards.routing.title}</h4>
            <p>{text.cards.routing.body}</p>
            <button type="button" onClick={() => controller?.navigateLocale("es")}>
              {i18n.localizePath("/i18n", "es")}
            </button>
          </article>
        </div>
      </section>
    );
  },
});
