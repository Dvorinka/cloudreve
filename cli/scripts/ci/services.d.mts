export function selectSearchImage(
  definition: { platforms: Record<string, string> },
  architecture: string,
): { image: string; platform: string };
