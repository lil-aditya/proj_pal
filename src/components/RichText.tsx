/** Minimal formatting for model replies: **bold** and bullet lines, without injecting HTML. */
export default function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const body = line.replace(/^\s*[-*•]\s+/, "");
        const parts = body.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : p,
        );
        return (
          <span key={i} className={bullet ? "block pl-3 -indent-3" : "block"}>
            {bullet && "• "}
            {parts}
            {!line && " "}
          </span>
        );
      })}
    </>
  );
}
