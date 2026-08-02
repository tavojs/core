import { defineLoader } from "@tavojs/core/router";
import { HeaderView } from "../components/HeaderView/index.jsx";
import { NavView } from "../components/NavView/index.jsx";

export const load = defineLoader((context) => ({
  shell: "root layout",
  pathname: context.pathname,
  loadedAt: new Date().toISOString()
}));

export function head() {
  return <meta name="x-tavo-layout" content="root" />;
}

export default function RootLayout(props) {
  return (
    <main className="tavo-app">
      <HeaderView />
      <NavView />
      <p className="tavo-layout-data">
        layout loader: <strong>{props.data?.shell}</strong> for{" "}
        <code>{props.data?.pathname}</code>
      </p>
      {props.children}
    </main>
  );
}
