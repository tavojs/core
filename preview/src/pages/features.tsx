import { FeatureLab } from "../components/FeatureLab/index.tsx";

export const head = (
  <>
    <title>tavo preview - feature lab</title>
    <meta name="description" content="Tavo.js framework feature lab" />
  </>
);

export default function FeaturesPage() {
  return <FeatureLab />;
}
