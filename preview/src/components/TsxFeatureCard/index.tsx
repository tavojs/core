import { createTavo } from "@tavojs/core";

type TsxFeatureCardProps = {
  title: string;
  features: string[];
};

type TsxFeatureCardState = {
  renderedWith: string;
};

export const TsxFeatureCard = createTavo<TsxFeatureCardProps, TsxFeatureCardState>({
  model: () => ({
    renderedWith: "createTavo"
  }),
  view: ({ props, state }) => (
    <section className="tavo-panel">
      <h3>{props.title}</h3>
      <p className="tavo-muted">
        This component is written in TSX and rendered with {state.renderedWith}.
      </p>
      <ul className="tavo-list">
        {props.features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
    </section>
  )
});
