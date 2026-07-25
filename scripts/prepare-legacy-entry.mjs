import { mkdir, readFile, writeFile } from "node:fs/promises";

const indexUrl = new URL("../dist/index.html", import.meta.url);
const html = await readFile(indexUrl, "utf8");
const scriptMatch = html.match(/<script[^>]+src="([^"]+index-[^"]+\.js)"/);
const styleMatch = html.match(/<link[^>]+href="([^"]+index-[^"]+\.css)"/);

if (!scriptMatch) throw new Error("현재 앱 진입 파일을 찾지 못했습니다.");

const currentScript = scriptMatch[1].split("/").pop();
const currentStyle = styleMatch?.[1].split("/").pop();
const legacyAssetsUrl = new URL("../dist/assets/", import.meta.url);
const legacyEntryUrl = new URL("index-CpkOBaHW.js", legacyAssetsUrl);

const legacyLoader = `${
  currentStyle
    ? `if (!document.querySelector('link[href$="${currentStyle}"]')) {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL("./${currentStyle}", import.meta.url).href;
  document.head.append(style);
}
`
    : ""
}// Compatibility loader for browsers held on the pre-PaddleOCR service-worker cache.
await import(new URL("./${currentScript}", import.meta.url).href);
`;

await mkdir(legacyAssetsUrl, { recursive: true });
await writeFile(legacyEntryUrl, legacyLoader);
