import connectDB from "./db.js";

const COLLECTIONS = ["rrr-parts", "shopify-parts"];

const truncate = (val, max = 40) => {
  const str = val === null || val === undefined ? "null" : String(val);
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
};

const printTable = (collectionName, docs) => {
  if (!docs.length) {
    console.log(`\n📂  ${collectionName}  — (empty)\n`);
    return;
  }

  // Collect all keys from every document
  const keys = [...new Set(docs.flatMap((d) => Object.keys(d)))];

  // Compute column widths
  const widths = keys.map((k) =>
    Math.max(k.length, ...docs.map((d) => truncate(d[k]).length))
  );

  const sep = "+" + widths.map((w) => "-".repeat(w + 2)).join("+") + "+";
  const row = (cells) =>
    "|" + cells.map((c, i) => ` ${c.padEnd(widths[i])} `).join("|") + "|";

  console.log(`\n${"=".repeat(sep.length)}`);
  console.log(`  📋  Collection: ${collectionName}  (${docs.length} docs)`);
  console.log("=".repeat(sep.length));
  console.log(sep);
  console.log(row(keys));
  console.log(sep);
  docs.forEach((doc) => {
    console.log(row(keys.map((k) => truncate(doc[k]))));
  });
  console.log(sep + "\n");
};

const run = async () => {
  const db = await connectDB();

  for (const name of COLLECTIONS) {
    const docs = await db.collection(name).find({}).toArray();
    // Convert ObjectId / nested objects to readable strings
    const clean = docs.map((doc) => {
      const out = {};
      for (const [k, v] of Object.entries(doc)) {
        out[k] =
          v && typeof v === "object" && !Array.isArray(v)
            ? JSON.stringify(v)
            : Array.isArray(v)
            ? `[Array(${v.length})]`
            : v;
      }
      return out;
    });
    printTable(name, clean);
  }

  process.exit(0);
};

run();
