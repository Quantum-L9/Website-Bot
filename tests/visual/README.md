# Approved visual regression

These are the Wave 4 tests of WB-BUILD-CONTRACT-TESTS-01. They protect a design after a person has judged it acceptable. They do not decide whether a design is good, and they do not replace the Visual QA stage that `AGENTS.md` requires before production.

## What is protected

`references/registry.json` lists the designs under protection. Each design has a fixture that rebuilds it for real (`astro check` plus `astro build`) and passes it through the browser gate. A design moves from `awaiting-approval` to `approved` in one way only: the approval command below. While a design is awaiting approval, its reference directory must stay empty, so a first design can never approve itself.

| Design | Fixture | Routes | Viewports |
|---|---|---|---|
| `wb-fixture-redesign` | `tests/helpers/visualReferenceFixture.ts` | home `/`, services `/services/drains`, conversion `/contact` | desktop 1440px, mobile 390px |

## Tests

| File | Asserts |
|---|---|
| `tests/unit/wb-visual-approval.test.ts` | References are trusted only through a valid approval. It must name a human, cover exactly the approved bytes, include both viewports, and come from output that passed the browser gate. Approval refuses CI, agents, bots, a missing reason, an unreviewed candidate set, and replacement without `--replace`. |
| `tests/integration/local/wb-visual-regression.test.ts` | The capture is deterministic: an unchanged re-render matches pixel for pixel. Each deliberately broken variant fails on exactly the viewports it breaks, and leaves expected, actual and diff PNGs. The variants cover spacing, typography, cropping, composition, and form-field overflow. |
| `tests/integration/local/wb-visual-approved-references.test.ts` | Every approved design matches its references at desktop and mobile within tolerance. Untrusted references, or a renderer major version different from the approval's, fail rather than skip. Evidence for a failure is kept in `build/visual-evidence/<design>/`. |

## Deterministic rendering

Capture runs Chromium under these fixed conditions:

- **Viewport:** fixed viewport, `deviceScaleFactor` 1.
- **Motion:** reduced motion, animations and transitions off, caret hidden.
- **Environment:** light colour scheme, `en-US` locale, UTC.
- **Network:** no off-origin requests.
- **Images:** every image is loaded before capture.
- **Dynamic text:** elements marked `data-visual-dynamic` are masked. The footer's build year is one of them.

Text uses the template's own font, Inter, from `fonts/`. Whatever fonts the machine has installed do not change the pixels.

Comparison runs in Chromium's canvas, so no image library is needed. A pixel differs when any channel moves more than 8/255. The threshold was calibrated on the form-overflow defect, whose 1px light borders a 32/255 threshold missed. A screenshot fails when more than 0.05% of its pixels differ, or when its size changed.

## Approving or updating references

Approval is two explicit steps by a person, never by CI or an agent.

1. Run `npm run visual:approve`. It builds the fixture, requires the browser gate to pass, writes candidates to `build/visual-candidates/<design>/`, and prints a digest. Nothing is approved yet. Look at every PNG.
2. Run `npm run visual:approve -- --approver "Your Name" --reason "why" --confirm <digest>`. Add `--replace` when updating existing references. This step copies exactly the reviewed files into `references/<design>/` and writes an `approval.json` naming you.

Commit `references/` in a pull request, so the approval is reviewed like code.

Approve on the same Chromium major version CI uses, which is the one Playwright pins in `node_modules/playwright-core/browsers.json`. Run a standard `npx playwright install chromium` checkout to get it. The approved-reference test fails when the renderer line differs from the approval's.

## Fonts

`fonts/inter-latin-*.woff2` are Latin subsets (`pyftsubset`, Google Fonts Latin ranges) of Inter 4.0 weights 400, 500, 600, 700 and 800. They come from the Debian `fonts-inter` 4.0+ds-1 package. Copyright 2016–2023 The Inter Project Authors, licensed under the SIL Open Font License 1.1 (`fonts/OFL.txt`).
