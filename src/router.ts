export interface RouteMatch {
  params: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
}

export function createRoute(method: string, path: string): Route {
  const paramNames: string[] = [];
  const patternStr = path.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  return {
    method,
    pattern: new RegExp(`^${patternStr}$`),
    paramNames,
  };
}

export function matchRoute(
  route: Route,
  method: string,
  path: string
): RouteMatch | null {
  if (route.method !== method) return null;

  const match = path.match(route.pattern);
  if (!match) return null;

  const params: Record<string, string> = {};
  route.paramNames.forEach((name, i) => {
    params[name] = match[i + 1];
  });

  return { params };
}
