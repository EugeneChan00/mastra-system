import { DEFAULT_MASTRA_BASE_URL, MASTRA_API_PREFIX } from "../const.js";

export function normalizeMastraBaseUrl(input: string | undefined = process.env.MASTRA_BASE_URL): string {
	const raw = (input ?? DEFAULT_MASTRA_BASE_URL).trim() || DEFAULT_MASTRA_BASE_URL;
	const withoutTrailingSlash = raw.replace(/\/+$/, "");
	if (withoutTrailingSlash.endsWith(MASTRA_API_PREFIX)) {
		return withoutTrailingSlash;
	}
	return `${withoutTrailingSlash}${MASTRA_API_PREFIX}`;
}

export function joinMastraPath(baseUrl: string, path: string): string {
	const normalizedBase = baseUrl.replace(/\/+$/, "");
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${normalizedBase}${normalizedPath}`;
}

