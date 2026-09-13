export async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin)
        chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}
export function isMainModule(url) {
    return process.argv[1] !== undefined && url === pathToFileURL(process.argv[1]).href;
}
import { pathToFileURL } from "node:url";
