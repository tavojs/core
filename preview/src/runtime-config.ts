export function previewMiddleware() {
  return [
    ({ to }: { to: string }) => {
      if (to === "/old-home") {
        return { redirect: "/" };
      }
      return undefined;
    },
  ];
}
