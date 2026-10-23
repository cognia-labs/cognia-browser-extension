# Security and privacy

Report vulnerabilities privately through [GitHub security advisories](https://github.com/cognia-labs/cognia-browser-extension/security/advisories/new). Do not include live pairing codes, device keys, captured private pages or access tokens in public issues.

The extension sends captures and attachments to the Cognia Host the user pairs. The Host's configured providers and delivery targets determine any later processing. Pairing uses origin-bound device credentials and DPoP proofs; private keys are generated in the browser. Captured drafts and task sessions use browser session storage. Pairing metadata, preferences, saved prompts and persistent site decisions use local storage. Those stores retain their existing versioned keys across this extraction.

Broad page access is optional. Agent mode additionally requires a Host drive grant, the local mode switch, compatible protocol/overlay and site approval. Stop and Take over cancel pending work and retain a pause until explicit Resume. Browser APIs already dispatched before cancellation cannot be recalled. Revocation and reconnect behavior is covered by unit and Chromium tests, with Host authorization fences tested by the product's Rust suite.

Incognito is disabled. Do not broaden install permissions, weaken origin checks, bypass cancellation or enable arbitrary page-origin permission messages to simplify tests. Release testing must include native permission refusal and installed-profile/signing identity compatibility.
