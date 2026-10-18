# P1 mobile customization runtime investigation

Branch: `fix/non-wing-customization-parity`. Previous commits investigated: `83f33fd` and `4d46076`.

## What was established

The supplied stack identifies the call at `menu-item-builder.tsx:261`, but does not distinguish an absent imported function from a failure inside that function. No failing customer payload or device bundle was supplied. Therefore the exact origin of that particular device exception cannot be asserted from the stack alone.

The previous stale-cache diagnosis was too confident. On the checked-out `4d46076`, `customerCustomizationInstructions` is present in both TypeScript source and generated CommonJS exports. Expo's actual resolver prioritizes `react-native` and loads `packages/customization/src/index.ts`. The previous change was not merely a Jest mapper change: native bundle source maps confirm source resolution. There is no evidence of a CommonJS/ESM incompatibility in a fresh current bundle.

Two failure paths were demonstrated independently:

1. A main-only package pointing at stale generated JavaScript without the helper produces an undefined runtime export. The real Metro regression reproduces this historical module-layout risk using an isolated stale-artifact fixture. This demonstrates the mechanism, not proof that a particular device was running that artifact.
2. Current saved-cart initialization trusted persisted values as TypeScript objects. A numeric `special_instructions` calls a nonexistent `split`; a non-array lunch `child_addons` calls a nonexistent `map`; null modifier selections call a nonexistent `some`. Three regression tests failed before the fix. Two of these failures lead through the exact reported helper call at line 261. Hermes can report an undefined method call as “undefined is not a function.” These are concrete defects, not an inference about module loading.

## Permanent correction

- The shared package now declares explicit conditional exports: native consumers load TypeScript source, while Node/CommonJS consumers load the built CommonJS module. Existing `main`, `react-native` and `types` fields remain compatible with legacy resolution. No dependency versions changed.
- A pure shared `inspectCustomizationDraft` validates persisted note, quantity, modifier, removal and builder-payload fields before the generic builder renders or initializes effects. Valid records and customer notes are retained. Legacy removals stored only in `ITEM_CUSTOMIZATION` payloads are retained too.
- Malformed portions flag an explicit customer review state. Add/Update is blocked until the customer reviews the current choices. There is no optional function-call fallback, empty catch, duplicated notes helper, silent price substitution or automatic cart mutation.
- Draft normalization is memoized on the incoming saved line. Session guards and existing effects retain their original stable edit/session semantics; every effect and render path now receives validated arrays and notes. Existing selected IDs still go through catalog eligibility validation. Notes summaries continue to be stripped only when they match established generated prefixes.
- Dedicated Wings and Wing Combo components were not edited.

## Tests and evidence

| Check | Result |
|---|---|
| Pre-fix malformed-cart regressions | 3 failures reproduced; split/map errors include the supplied helper-call location |
| Full mobile Jest suite | 500 tests, 42 suites passed |
| Shared pure-rule suite | 19 tests passed |
| Web customization/admin regressions | 6 tests passed |
| TypeScript: mobile, API, web and shared package | Passed |
| Node CommonJS export smoke test | Both notes and draft helpers are functions; notes execute correctly |
| Actual development Metro graph | Source exports resolve and execute; no compiled customization artifact is selected |
| Actual production/minified Metro graph | Source exports resolve and execute; no compiled customization artifact is selected |
| Historical stale-export fixture | Undefined function reproduced through Metro, outside Jest |
| Expo Android and iOS exports | Passed after `--clear`, offline, `--no-bytecode --max-workers 2`; both source maps select `customization/src/index.ts`, not `dist/index.js` |

`npm run test:metro-customization --workspace @wings4u/application` runs the new Metro regression. It resets Metro's cache, uses Expo's installed Metro implementation, bypasses Jest completely, and executes the real resolved/transformed pure-module graph in a JavaScript VM. Its small test serializer omits device bootstrap; it does not replace Metro resolution or transformation. Both native conditional source resolution and Node's compiled entry are verified. Native source selection has no dependency on a pre-existing `dist` directory, so clearing an old device cache is not the implementation fix.

The mobile regressions cover Veggie Burger, Chicken Burger, Buffalo Chicken Wrap, tenders, salad, lunch editing, notes, quantities, removals, valid partial-cart recovery and legacy payload-only removals. Existing dedicated Wings/Wing Combo and cart tests also pass.

## Native-runtime verification limitation

An Android emulator and Expo Go 57.0.9 were discovered. An isolated fixture project was generated under ignored `tmp/`, using the actual builder with in-memory cart actions and application API calls disabled. A fresh Metro dev server was started with `--clear`. Expo Go repeatedly entered an unresponsive/error state before requesting/loading that fixture. No native builder screen success is claimed. No iOS development runtime was available.

Automatic approval review rejected restarting Expo Go via `adb am force-stop`, reporting only “blocked by policy.” Choosing the existing dialog's Wait action recovered the dialog temporarily, but Expo Go remained unresponsive. No termination or application-data clearing was performed. The isolated dev server was stopped after the attempt.

The Metro execution tests and JavaScript exports verify resolution and JavaScript behavior, not Fabric/Hermes UI rendering on a healthy native device. Native opening/editing checks should be repeated once the emulator or development device is responsive.

## Changed files

- `packages/customization/package.json`: explicit native/Node conditional exports.
- `packages/customization/src/index.ts`: shared saved-draft validation and recovery metadata.
- `apps/application/src/components/menu-item-builder.tsx`: validated initialization and explicit malformed-cart review.
- `apps/application/tests/menu-item-builder-edit.test.cjs`: failing-before-fix cases, tender/salad initialization, valid partial-cart preservation and legacy removals.
- `apps/application/tests/metro-customization-runtime.cjs`: actual Metro development/production export execution and historical stale-export reproduction.
- `apps/application/package.json`: reproducible Metro regression command.
- This report.

No database connection, seed, sync, migration, production cart/order/payment operation, environment connection change, deployment or merge was performed. Existing untracked root `.expo/` and `tsconfig.json` were preserved. Final commit SHA is provided in the completion message.
