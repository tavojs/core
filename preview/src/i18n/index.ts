import { createI18n } from "@tavojs/core";

export const i18n = createI18n({
  serviceName: false,
  defaultLocale: "en",
  routing: {
    enabled: true,
  },
  locales: {
    en: {
      label: "English",
      dir: "ltr",
    },
    es: {
      label: "Spanish",
      dir: "ltr",
    },
    hy: {
      label: "Armenian",
      dir: "ltr",
    },
  },
  messages: {
    en: {
      page: {
        eyebrow: "Localization",
        title: "Translations are plain objects in the view",
        intro:
          "Tavo lets views read translations directly from i18n.text while the framework keeps locale changes reactive.",
        greeting: "Hello {name}, this string came from i18n.t().",
      },
      actions: {
        english: "English",
        spanish: "Spanish",
        armenian: "Armenian",
      },
      cards: {
        direct: {
          title: "Direct object access",
          body: "Use i18n.text.page.title directly in TSX.",
        },
        dynamic: {
          title: "Dynamic keys",
          body: "Use i18n.t('page.greeting', { name }) when keys or parameters are dynamic.",
        },
        routing: {
          title: "Locale routing",
          body: "Use i18n.localizePath('/i18n', locale) to navigate localized URLs that SSR can detect.",
        },
      },
    },
    es: {
      page: {
        eyebrow: "Localizacion",
        title: "Las traducciones son objetos simples en la vista",
        intro:
          "Tavo permite leer traducciones desde i18n.text mientras el framework mantiene reactivos los cambios de idioma.",
        greeting: "Hola {name}, este texto viene de i18n.t().",
      },
      actions: {
        english: "Ingles",
        spanish: "Espanol",
        armenian: "Armenio",
      },
      cards: {
        direct: {
          title: "Acceso directo al objeto",
          body: "Usa i18n.text.page.title en TSX sin hooks.",
        },
        dynamic: {
          title: "Claves dinamicas",
          body: "Usa i18n.t('page.greeting', { name }) cuando las claves o parametros son dinamicos.",
        },
        routing: {
          title: "Rutas por idioma",
          body: "Usa i18n.localizePath('/i18n', locale) para navegar URLs localizadas que SSR puede detectar.",
        },
      },
    },
    hy: {
      page: {
        eyebrow: "Տեղայնացում",
        title: "Թարգմանությունները view-ում սովորական օբյեկտներ են",
        intro:
          "Tavo-ում կարելի է կարդալ i18n.text-ից, իսկ framework-ը locale-ի փոփոխությունները պահում է ռեակտիվ։",
        greeting: "Բարեւ {name}, այս տեքստը գալիս է i18n.t()-ից։",
      },
      actions: {
        english: "Անգլերեն",
        spanish: "Իսպաներեն",
        armenian: "Հայերեն",
      },
      cards: {
        direct: {
          title: "Ուղիղ օբյեկտի հասանելիություն",
          body: "Օգտագործիր i18n.text.page.title TSX-ում՝ առանց hooks-ի։",
        },
        dynamic: {
          title: "Դինամիկ բանալիներ",
          body: "Օգտագործիր i18n.t('page.greeting', { name }), երբ բանալին կամ տվյալները դինամիկ են։",
        },
        routing: {
          title: "Locale routing",
          body: "Օգտագործիր i18n.localizePath('/i18n', locale), որպեսզի SSR-ը ճանաչի լեզուն URL-ից։",
        },
      },
    },
  },
});

export type PreviewI18n = typeof i18n;
