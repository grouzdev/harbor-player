import open from "open";
try {
  const response = await fetch("http://127.0.0.1:5173/api/session", {
    signal: AbortSignal.timeout(1000),
  });
  const data = await response.json();
  if (
    !response.ok ||
    !data.csrf ||
    !Array.isArray(data.capabilities?.writableFormats)
  )
    process.exit(1);
  await open("http://127.0.0.1:5173");
} catch {
  process.exitCode = 1;
}
