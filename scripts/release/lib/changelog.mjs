/**
 * Release notes come from CHANGELOG.md (Keep a Changelog): the section whose
 * heading names the version, such as "## [0.1.0-beta.1] - 2026-11-02".
 * Returns its body as Markdown, or null if there is no such section.
 */
export function changelogSection(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The version must end at "]" or a space, so 0.1.0 never matches 0.1.0-beta.1.
  const heading = new RegExp(`^##\\s+\\[?v?${escaped}(?:\\]|\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  let end = lines.findIndex((line, i) => i > start && /^##?\s/.test(line));
  if (end === -1) end = lines.length;

  const body = lines.slice(start + 1, end);

  // The file ends with link definitions ("[0.1.0]: https://…"), which belong to
  // the whole changelog, not to whichever section happens to be last.
  const isTrailing = (line) =>
    line.trim() === "" || /^\[[^\]]+\]:\s/.test(line);
  while (body.length && isTrailing(body[body.length - 1])) body.pop();

  while (body.length && body[0].trim() === "") body.shift();

  return body.length ? `${body.join("\n")}\n` : null;
}
