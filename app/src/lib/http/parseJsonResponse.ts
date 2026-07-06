/**
 * Parse a fetch Response as JSON, but only once we know it's actually JSON.
 * A non-2xx response can come back as plain text (e.g. a platform-level
 * "413 Request Entity Too Large" from a body-size limit, or an HTML error
 * page from a proxy) instead of the API route's JSON error body — calling
 * `.json()` unconditionally on that throws a confusing "unexpected token"
 * SyntaxError instead of a real error message.
 */
export async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    if (response.ok) return {} as T;
    const text = (await response.text()).trim();
    if (response.status === 413) {
      throw new Error("The request was too large for the server to accept. Try again with fewer species.");
    }
    throw new Error(text ? `${fallbackMessage} (${response.status}): ${text.slice(0, 200)}` : fallbackMessage);
  }
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? fallbackMessage);
  }
  return body;
}
