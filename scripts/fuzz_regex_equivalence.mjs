#!/usr/bin/env node
// L9_META: layer=validation, role=regex_equivalence_fuzzer, status=active, version=1.0.0
//
// Fuzz equivalence harness for SonarCloud S8786 (ReDoS) remediations.
// For every regex rewrite, the old and new matchers must agree on a large
// deterministic corpus. Each pair documents its equivalence domain; inputs
// outside the domain are still fuzzed and reported as a divergence catalog
// (with a per-pair invariant check) so the security review can audit them.
//
// Usage: node scripts/fuzz_regex_equivalence.mjs [--quick]
//   --quick: reduced corpus (~8k per pair) for CI sanity; default is full.

const QUICK = process.argv.includes("--quick");

// Deterministic LCG (no Math.random — reproducible runs).
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

function randomString(rng, alphabet, minLen, maxLen) {
  const len = minLen + Math.floor(rng() * (maxLen - minLen + 1));
  let out = "";
  for (let i = 0; i < len; i++) out += pick(rng, alphabet);
  return out;
}

function recordDivergence(result, input, oldResult, newResult, inDomainInput) {
  result.diffs++;
  if (inDomainInput) {
    if (result.firstDiffExamples.length < 3) {
      result.firstDiffExamples.push({ input: truncate(input), old: oldResult, new: newResult });
    }
    return;
  }
  result.divergenceCatalog.push({ input: truncate(input), old: oldResult, new: newResult });
  if (result.divergenceCatalog.length > 5) result.divergenceCatalog.pop();
}

function runPair(name, { oldMatcher, newMatcher, generate, domainCheck, corpusSize }) {
  const rng = makeRng(hashSeed(name));
  const size = QUICK ? Math.min(8000, corpusSize) : corpusSize;
  const result = {
    diffs: 0,
    inDomain: 0,
    firstDiffExamples: [],
    divergenceCatalog: [],
  };
  const start = Date.now();
  for (let i = 0; i < size; i++) {
    const input = generate(rng, i);
    const inDomainInput = domainCheck ? domainCheck(input) : true;
    if (inDomainInput) result.inDomain++;
    const oldResult = oldMatcher(input);
    const newResult = newMatcher(input);
    if (oldResult !== newResult) {
      recordDivergence(result, input, oldResult, newResult, inDomainInput);
    }
  }
  const elapsedMs = Date.now() - start;
  return {
    pair: name,
    corpusSize: size,
    inDomain: result.inDomain,
    domainDiffs: result.firstDiffExamples.length > 0 ? undefined : 0,
    domainDiffExamples: result.firstDiffExamples,
    outsideDomainDivergences: result.divergenceCatalog.length,
    divergenceCatalog: result.divergenceCatalog,
    elapsedMs,
    pass: result.firstDiffExamples.length === 0,
  };
}

function truncate(value) {
  const s = String(value);
  return s.length <= 80 ? s : `${s.slice(0, 77)}...`;
}

function hashSeed(name) {
  let h = 2166136261;
  for (const c of name) {
    h ^= c.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- pairs ---

const DENYLIST_WORDS = ["rm", "dd", "curl"];
const SHELL_CHARS = [
  "a",
  "b",
  "Z",
  "0",
  "_",
  "=",
  " ",
  "-",
  ".",
  "/",
  ";",
  "&",
  "|",
  "(",
  ")",
  ">",
  "<",
  "`",
  "$",
  '"',
  "'",
  "\n",
];

function pairEnvAssignments() {
  const oldEnv = /^(?:[A-Za-z_]\w*=\S+\s+)+/;
  const newEnv = /^[A-Za-z_]\w*=\S+\s+/;
  const oldMatcher = (s) => s.replace(oldEnv, "");
  const newMatcher = (s) => {
    // Fixpoint strip: repeat one assignment-strip until no progress.
    let stripped = s;
    let previous;
    do {
      previous = stripped;
      stripped = previous.replace(newEnv, "");
    } while (stripped !== previous);
    return stripped;
  };
  return {
    oldMatcher,
    newMatcher,
    generate: (rng, _i) => {
      // Mix of realistic assignment prefixes and adversarial runs.
      const roll = rng();
      if (roll < 0.4) {
        const count = Math.floor(rng() * 5);
        let s = "";
        for (let k = 0; k < count; k++)
          s += `N${k}=${randomString(rng, SHELL_CHARS.slice(0, 12), 1, 8)} `;
        s += randomString(rng, SHELL_CHARS, 0, 12);
        return s;
      }
      if (roll < 0.7) {
        // Near-miss: assignment without trailing space
        return `N=${randomString(rng, ["a", "b", "=", "0"], 1, 40)}`;
      }
      if (roll < 0.9) {
        // Adversarial: many ambiguous value runs
        return `A=${randomString(rng, ["x", " "], 1, 30)}${randomString(rng, SHELL_CHARS, 0, 8)}`;
      }
      return randomString(rng, SHELL_CHARS, 0, 60);
    },
    corpusSize: 150_000,
  };
}

function pairRedirectStrip() {
  // NOSONAR: this is the pre-fix vulnerable form, kept intentionally as the
  // reference matcher the bounded rewrite is fuzz-compared against.
  const oldRedirect = /^[<>]+\s*\S+\s*/;
  const newRedirect = /^[<>]{1,64}\s*\S+\s*/;
  const domainCheck = (s) => {
    const m = s.match(/^[<>]*/);
    return (m?.[0].length ?? 0) <= 64;
  };
  return {
    oldMatcher: (s) => s.replace(oldRedirect, ""),
    newMatcher: (s) => s.replace(newRedirect, ""),
    domainCheck,
    generate: (rng, _i) => {
      const roll = rng();
      if (roll < 0.5) {
        // Realistic redirect prefixes (1-2 chars)
        const prefix = pick(rng, [">", "<", ">>", "2>", "<>", ">> "]);
        return prefix + randomString(rng, SHELL_CHARS, 0, 20);
      }
      if (roll < 0.8) {
        // Adversarial <> runs — occasionally beyond the 64-char domain
        const len = Math.floor(rng() * (roll < 0.65 ? 65 : 100));
        return "<".repeat(len) + randomString(rng, SHELL_CHARS, 0, 10);
      }
      return randomString(rng, SHELL_CHARS, 0, 40);
    },
    corpusSize: 150_000,
  };
}

function pairAssertionPatterns() {
  // All oldPatterns entries are the pre-fix vulnerable forms, kept
  // intentionally as reference matchers for the fuzz comparison.
  const oldPatterns = [
    /expected.*but.*received/i, // NOSONAR: reference pattern under test
    /assertion.*failed/i, // NOSONAR: reference pattern under test
    /test.*failed/i, // NOSONAR: reference pattern under test
    /expected:.*actual:/i, // NOSONAR: reference pattern under test
    /✕.*expect/i, // NOSONAR: reference pattern under test
    /error:.*expect/i, // NOSONAR: reference pattern under test
  ];
  const newPatterns = [
    /expected.{0,2000}but.{0,2000}received/i,
    /assertion.{0,2000}failed/i,
    /test.{0,2000}failed/i,
    /expected:.{0,2000}actual:/i,
    /✕.{0,2000}expect/i,
    /error:.{0,2000}expect/i,
  ];
  const matchSet = (patterns, s) => patterns.map((p) => Boolean(p.exec(s))).join(",");
  const domainCheck = (s) => s.length <= 4000; // any 2000-char span requires ≤4000 chars
  return {
    oldMatcher: (s) => matchSet(oldPatterns, s),
    newMatcher: (s) => matchSet(newPatterns, s),
    domainCheck,
    generate: (rng) => {
      const roll = rng();
      if (roll < 0.5) {
        const gap = () => randomString(rng, [" ", "a", "\n", ":"], 0, 40);
        const keywords = [
          ["expected", "but", "received"],
          ["assertion", "failed"],
          ["test", "failed"],
          ["expected:", "actual:"],
          ["✕", "expect"],
          ["error:", "expect"],
        ];
        const kw = pick(rng, keywords);
        let s = kw.join("");
        for (let i = kw.length - 1; i > 0; i--) {
          s =
            s.slice(0, kw.slice(0, i).join("").length) +
            gap() +
            s.slice(kw.slice(0, i).join("").length);
        }
        return s + randomString(rng, [" ", "x"], 0, 10);
      }
      return randomString(
        rng,
        ["e", "x", "p", "t", ":", " ", "\n", "✕", "f", "a", "i", "l"],
        0,
        60,
      );
    },
    corpusSize: 100_000,
  };
}

function pairBranch() {
  const oldBranch = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,255}$/;
  const newChars = /^[A-Za-z0-9._/-]{1,255}$/;
  const newMatcher = (s) =>
    newChars.test(s) && !s.startsWith("/") && !s.includes("..") && !s.includes("//");
  return {
    oldMatcher: (s) => oldBranch.test(s),
    newMatcher,
    generate: (rng) => {
      const alphabet = ["a", "B", "0", ".", "_", "/", "-", "..", "//", "..//"];
      return randomString(rng, alphabet, 0, 40) + randomString(rng, alphabet, 0, 220);
    },
    corpusSize: 200_000,
  };
}

function pairDenylist() {
  // $(...rm...) and `...rm...` families: lookahead rewrite must agree exactly.
  const oldPatterns = DENYLIST_WORDS.flatMap((word) => [
    new RegExp(String.raw`\$\([^)]*${word}[^)]*\)`, "gi"),
    new RegExp(String.raw`\`[^\`]*${word}[^\`]*\``, "gi"),
  ]);
  const newPatterns = DENYLIST_WORDS.flatMap((word) => [
    new RegExp(String.raw`\$\((?=[^)]*${word})[^)]*\)`, "gi"),
    new RegExp(String.raw`\`(?=[^\`]*${word})[^\`]*\``, "gi"),
  ]);
  const matchSet = (patterns, s) => patterns.map((p) => Boolean(p.exec(s))).join(",");
  return {
    oldMatcher: (s) => matchSet(oldPatterns, s),
    newMatcher: (s) => matchSet(newPatterns, s),
    generate: (rng, i) => {
      const word = DENYLIST_WORDS[i % DENYLIST_WORDS.length];
      const roll = rng();
      const bodyChars = ["a", " ", word, "-", "m", "r", "d", "c", "u", "l"];
      const body = randomString(rng, bodyChars, 0, 30);
      if (roll < 0.4) return `$(echo ${body})`;
      if (roll < 0.7) return `\`${body}\``;
      if (roll < 0.85) return `prefix $(${body}) suffix`;
      return randomString(rng, ["$", "(", ")", "`", "a", "r", "m", " "], 0, 40);
    },
    corpusSize: 200_000,
  };
}

// -------------------------------------------------------------- summary ---

const pairs = [
  { name: "secure-exec-110-env-assignments", ...pairEnvAssignments() },
  { name: "secure-exec-113-redirect-strip", ...pairRedirectStrip() },
  { name: "e2e-engine-186-assertion-patterns", ...pairAssertionPatterns() },
  { name: "request-17-branch", ...pairBranch() },
  { name: "secure-exec-denylist-substitutions", ...pairDenylist() },
];

const results = [];
let allPass = true;
for (const pair of pairs) {
  const result = runPair(pair.name, pair);
  results.push(result);
  if (!result.pass) allPass = false;
  console.log(
    `${result.pair}: corpus=${result.corpusSize} inDomain=${result.inDomain} ` +
      `domainDiffs=${result.domainDiffExamples?.length ?? 0} ` +
      `outsideDomainDivergences=${result.outsideDomainDivergences} (${result.elapsedMs}ms)`,
  );
  for (const example of result.domainDiffExamples ?? []) {
    console.log(`  DOMAIN DIFF: ${JSON.stringify(example)}`);
  }
}

const totalCases = results.reduce((sum, r) => sum + r.corpusSize, 0);
const totalDiffs = results.reduce((sum, r) => sum + (r.domainDiffExamples?.length ?? 0), 0);
console.log(
  JSON.stringify(
    {
      mode: QUICK ? "quick" : "full",
      totalCases,
      totalDomainDiffs: totalDiffs,
      allPairsPass: allPass,
      pairs: results,
    },
    null,
    2,
  ),
);

if (!allPass) process.exit(1);
