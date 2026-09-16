import { FileAppearanceRevisionStore } from "../appearance-revision-store.node.ts";

const [path, expected, encoded] = process.argv.slice(2);
const store = new FileAppearanceRevisionStore(path);
const result = await store.compareAndSwap(expected === "undefined" ? undefined : expected, JSON.parse(encoded));
process.stdout.write(result);
