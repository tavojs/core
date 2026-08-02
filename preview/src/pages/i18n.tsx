import { I18nDemo } from "../components/I18nDemo/index.tsx";

export const head = (
  <>
    <title>tavo preview - i18n</title>
    <meta name="description" content="Tavo localization preview with direct translation object access." />
  </>
);

export default function I18nPage() {
  return <I18nDemo />;
}
