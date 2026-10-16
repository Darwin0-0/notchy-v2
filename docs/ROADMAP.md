# What is next for Notchy

A focused backlog after the 0.3.3 review. These are remaining decisions, validation gaps and product improvements, not a list of confirmed bugs. Completed work—local search, scrolling and context actions, local module import and the SDK, manual LocalSend addressing, and the previous PDF/LocalSend hardening—is deliberately excluded.

The LocalSend launch fix, demonstration recordings, weather glyph correction and task-to-focus navigation are covered by the current update. Tasks already in a personal Notchy profile are kept when this project list is imported.

## Release confidence

Priority P1 establishes release confidence or a prerequisite for contributors; P2 covers the next product and testing work; P3 depends on the module catalog being available.

## P1 · Release and contributor readiness

### Sign the Windows app and installer

The public installer is explicitly unsigned; checksum verification is present but is not a publisher signature.

Done when: Choose the signing identity with the owner, sign the application and installer with timestamping, and verify both signatures on a clean Windows machine.

Requires a project-owner decision before implementation.

### Verify a clean installation on Windows 10 and 11

Exact extracted binaries were tested, but the complete installer wizard was not. Setup may need to download WebView2.

Done when: Run the published installer in disposable clean Windows 10/11 profiles with WebView2 present and absent. Verify completion, first-run Mimo entrance, launch, Windows startup preference and a readable error if the prerequisite download fails.

### Test upgrades and uninstall without losing user data

Safe local binary replacement was verified; it does not exercise the installer's update or uninstall paths.

Done when: In a disposable profile, upgrade from an earlier public build and retain tasks, Shelf bytes, layouts, installed-module state and startup opt-out. Uninstall must remove only the installed copy's startup entry and respect the documented data policy.

### Verify Up next with a live Spotify account

The current queue checks use fixture data; no new live Spotify account command was exercised for v0.3.3.

Done when: With a consenting test account and private app configuration, verify PKCE connection, live queue, track changes, supported commands, drawer close/return, token expiry and disconnection. Never commit account configuration or tokens.

### Recheck phone transfers in both directions on the release

The user previously confirmed a successful three-image reception, but the v0.3.3 verification records no new physical phone transfer. This is a validation task, not a claim that transfers are broken.

Done when: Using disposable images, verify phone→PC and PC→phone, received byte counts, refusal/cancel and music returning after completion. Also exercise the existing manual private-IP fallback when multicast is unavailable, on a local Wi-Fi without internet.

### Choose and publish the project licence

The repository explicitly has no project-wide licence, so public code is not a clear reuse/distribution grant for contributors.

Done when: Have the project owner choose the intended licence, check contributor ownership and third-party compatibility, add the licence text, then align README and contributing guidance. Do not select a licence without the owner's decision.

Requires a project-owner decision before implementation.

## P2 · Product and test coverage

### Test the island across monitors with different display scales

Current browser evidence covers normal scale and 125%; it does not establish real mixed-monitor or 150%/200% Windows behaviour.

Done when: On real Windows displays, test 100/125/150/200% where available, moving between differently scaled monitors and resuming from sleep. Verify painted hit region, hover, keyboard opening, departure collapse and scrolling, and record the actual tested matrix.

### Run browser interaction regressions in CI

The public workflow runs Node model tests and Rust service tests. The passing browser harnesses remain outside the public repository's CI.

Done when: Move the sanitized, isolated pointer/search/menu/scroll/module scenarios into maintained repository tests, run them in CI at two scales, block external requests and upload a failure screenshot. Keep native/physical-device checks explicitly separate.

### Define module-store publishing and verification rules

The requested community store is not connected. Its own module documentation calls out provenance, review, revocation and update policy as prerequisites.

Done when: Specify publisher/module identity, manifest review, immutable version/hash records, takedown/revocation handling and an update-consent policy while retaining the current no-code/no-privilege module boundary.

### Connect a verified module catalog to Discover

Discover currently iterates only the two bundled sample manifests. A remote catalog/download service is explicitly absent.

Done when: After the trust policy, fetch a bounded verified catalog in the host, validate every downloaded manifest/hash, retain preview and explicit installation, and provide offline/loading/error states without preventing local JSON import.

### Export a module manifest from My modules

Export manifest exists in the SDK, while installed-module cards in the app offer only placement and removal. Sharing an app-edited definition currently requires a manual JSON copy.

Done when: Add an explicit export action for the validated definition/defaults using the existing safe download path. Never include the user's current saved values, private profile data or credentials.

### Document search right-click actions and scrolling

The dedicated search guide still documents the original keyboard/open flow but omits the shipped context menu, More actions and Shift+F10 interaction.

Done when: Update LOCAL_SEARCH.md with right-click/More actions/Shift+F10, menu Escape behaviour, scrolling through the eight bounded results and reveal-only formats. Use sample screenshots without personal filenames.

## P3 · After the module catalog

### Offer module updates without losing their state

Local re-import already preserves compatible state and rejects lower versions; there is no connected update feed. Do not recreate the existing import/update validator.

Done when: Use trusted catalog version records to show available updates, preview changes, require explicit acceptance, preserve compatible state and keep the installed version usable when download, validation or save fails. Design any rollback separately with its state snapshot policy.

## Evidence and boundaries

This review used the current source and the [0.3.3 release](https://github.com/Darwin0-0/notchy-v2/releases/tag/v0.3.3). Its installer is unsigned. The complete installer wizard, a new physical phone transfer and a live Spotify queue were not exercised for that release; fixture and extracted-binary tests do not replace those checks. The current module catalog is bundled and imported JSON remains declarative, without network or system permissions.

Review this list as work lands. Keep the project list out of new users’ task lists: it belongs to this development profile, not to the application defaults.
