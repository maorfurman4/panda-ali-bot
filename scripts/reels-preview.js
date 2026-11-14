// Sends a finished Reel from the Mac to the owner through the Reels approve bot, as a file (full quality) with the same
// caption and "publish" / "skip" buttons as the bot's own previews. A press is then handled by the server (/reels).
// Usage: node --env-file-if-exists=.env scripts/reels-preview.js <video.mp4> [post-text.txt]   (needs REELS_BOT_TOKEN and ADMIN_USER_ID)
// Without a text file the post gets the fixed style-1 text; styles 2 and 3 pass their own (it is what gets published).
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { Api, InputFile } from "grammy";
import { previewExtra } from "../reels.js";

const [file, textFile] = process.argv.slice(2);
const text = textFile ? readFileSync(textFile, "utf8").trim() : undefined;
const { REELS_BOT_TOKEN: token, ADMIN_USER_ID: owner } = process.env;
if (!file || !token || !owner) {
  console.error("usage: node --env-file-if-exists=.env scripts/reels-preview.js <video.mp4> (REELS_BOT_TOKEN and ADMIN_USER_ID in .env)");
  process.exit(1);
}
const mb = statSync(file).size / 1024 / 1024;
if (mb > 20) {
  console.error(`${basename(file)} is ${mb.toFixed(1)} MB: over the bot's 20 MB download limit, so "publish" could not fetch it. Encode it smaller first.`);
  process.exit(1);
}
const sent = await new Api(token).sendDocument(owner, new InputFile(file, basename(file)), previewExtra(text));
console.log(`sent ${basename(file)} (${mb.toFixed(1)} MB) to the owner, message ${sent.message_id}`);
