export function extendHydrationPath(
  path: string | undefined,
  pathSegments: string[] | undefined,
  trackDetails: boolean,
  segment: string
): { path: string | undefined; pathSegments: string[] | undefined } {
  if (!trackDetails) {
    return {
      path,
      pathSegments
    };
  }
  return {
    path: `${path ?? ""}${segment}`,
    pathSegments: [...(pathSegments ?? []), segment]
  };
}
