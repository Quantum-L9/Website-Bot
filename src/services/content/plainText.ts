// L9_META: layer=service, role=plain_text_normalize, status=active, version=1.0.0
//
// LLM copy often leaks Markdown (**bold**, # headings) into shipped HTML. Strip
// decorations so H1s render as clean sentences, not `**Protect Your Home**`.

export function stripMarkdownDecorators(value: string): string {
  let text = value.replaceAll("\r\n", "\n");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^>\s+/gm, "");
  text = text.replaceAll("**", "");
  return text.trim();
}

export function firstLine(value: string): string {
  return (
    value
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}
