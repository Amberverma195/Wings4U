# Mobile Stripe dormancy

Updated October 23, 2026. Current customer checkout uses in-person payment collection.

The mobile root's Stripe import and provider wrapper are commented out. Checkout's Stripe imports/hook, configuration request, initialization, PaymentSheet and payment-intent/reuse path are commented out, including callback dependencies. Code is preserved for review and possible future restoration. Mobile online-payment availability is fixed to false, independently of backend flags. Pickup Pay at Store and delivery Cash/Card on Delivery remain the supported preferences.

The Stripe Expo plugin is no longer active in `app.json`; its original entry is retained as a comment in `app.config.js`, since JSON cannot contain comments. The dormant publishable-key mapping, placeholder and export are retained in comments. The package dependency is deliberately retained: no blind uninstall, lockfile changes or schema changes were needed.

No customer website Stripe integration was found in `apps/web/src`. Backend Stripe records, historical-payment reconciliation, validation and security gates are preserved. Commenting those out could compromise financial-record handling and is outside the mobile startup/checkout initialization fix.

This source change does not update installed apps. Verify a rebuilt native release before claiming the SDK is absent from a binary or sends no telemetry: the retained package may still be linked by native autolinking. No native binary or device network test was performed here. No production environment, database or payment operations were performed; the owner authorized a source push to main.

Regression coverage includes executable-code checks proving that root/checkout do not import the Stripe module, call initialization/sheets or request Stripe endpoints; plugin absence with dependency retention; and checkout behavior with mocked backend online-payment flags enabled. Existing mocked checkout/preflight/configuration tests cover in-person collection, delivery quotes, pricing validation, auth handoff, retries and order confirmation. No real order or charge is submitted by these tests.

Validation: **196 tests passed across six suites** (`stripe-dormancy`, `mobile-checkout-quote-identity`, `checkout-preparation`, `checkout-entry-guard`, `mobile-config`, `mobile-env`). Mobile TypeScript and diff checks passed. An initial test run caught remaining PaymentSheet callback-dependency references; those are also commented out and the corrected rerun passes.

Restore only as a separately reviewed payment feature: restore provider/plugin/key configuration and checkout code together, verify online-payment backend gates and pricing/intent validation, review privacy/deletion/retention assumptions, and run sandbox and native-device tests before any live release. Do not enable online payments by merely uncommenting one import or changing a server flag.
