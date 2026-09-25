/**
 * Reads an NDJSON body (one JSON object per line) and hands each object to
 * `onEvent` as soon as its line is complete. A chunk can split a line, so
 * the partial tail is held until the next chunk. Blank and malformed lines
 * are skipped; an exception thrown by `onEvent` propagates. `onChunk` runs
 * after every decoded chunk's events, for callers that repaint per chunk.
 *
 * Browser-safe and prisma-free: the chat, the admin copilot, the card
 * builder, the site-cards run and the GitHub import all stream this way.
 */
export async function readNdjson<T = { t: string; v?: unknown }>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  onChunk?: () => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: T;
      try {
        event = JSON.parse(line) as T;
      } catch {
        continue;
      }
      onEvent(event);
    }
    onChunk?.();
  }
  // A final line with no trailing newline is still a line.
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer) as T);
    } catch {
      /* malformed tail — skipped */
    }
    onChunk?.();
  }
}
