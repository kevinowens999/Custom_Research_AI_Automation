# ContactOut Email Opener + Excel export (1.5.0)

Enter a page count and press Start. The extension reveals up to 25 email buttons per page, collects contacts, clicks Next, and repeats. It downloads **one genuine .xlsx workbook** for the run to **Downloads/contactout** with these columns:

| Client name | Company name | Founder personal LinkedIn URL | Email addresses |
| --- | --- | --- | --- |

All distinct, unmasked email addresses in each card are exported in displayed order, one per line in the same wrapped cell. There is no two-email limit. Contacts without an email are excluded from the workbook; missing names or companies remain blank. Current company is read from a current-company field or employment marked Present/Current, not a previous employer. Contacts are deduplicated by profile URL when available, otherwise by their name/company/email combination. Personal LinkedIn links are exported as clickable blue, underlined Excel hyperlinks and are read from the contact card when available; missing links remain blank. Company LinkedIn pages are not used as personal profiles. The personal profile belongs to the listed contact: select founders using ContactOut filters. No guessed addresses or API enrichment. Company websites are not included. Old saved checkpoints lack the new links; run collection again to populate them.

## Export modes

1. **Reveal up to 25, then export all info**: clicks up to 25 View email controls on each page, then exports contact details and all revealed emails.
2. **Export already revealed emails only**: never clicks View email. Reveal chosen contacts manually on the relevant pages before starting. The run visits the number of pages entered, starting with the current page, and exports contacts with unmasked emails available when each page loads. It does not pause for manual clicks between pages. This includes previously revealed contacts; it cannot distinguish who clicked the button or when.

Both modes use the same Next-page loop, Stop behavior, clickable LinkedIn URLs, and blank-email row exclusion. If ContactOut does not retain reveals when you revisit a page, use option 2 with a page count of 1 immediately after manually revealing that page.

## Install/update

Open `chrome://extensions` or `edge://extensions`. Enable Developer mode, then Load unpacked and choose this folder. For an existing installation click Reload. Refresh ContactOut afterward. Open the popup, enter the total pages (including the current page), then Start.

Stop prevents further clicks and navigation and saves contacts from fully collected pages. A partial page is not collected after Stop. The download continues after Stop so completed work is preserved. The popup can be closed while running. It shows page and contact progress when reopened. An already-issued click cannot be undone. Normal account credits apply.

Collected rows are checkpointed in local browser session storage, with no uploads or analytics. **Download last collected results** retries a failed download or recovers rows from an interrupted run while the browser session remains open. Starting a new run replaces that tab's checkpoint once its first page is collected. Screenshots are no longer produced.

Chrome/Edge 118+ is required. The existing debugger session keeps the long-running worker alive; its browser banner remains expected. No screenshot command is sent. Close DevTools on the target tab before starting. Do not manually navigate or change filters during a run.

The row parser uses rendered names, card controls and employment text. Unsupported or virtualized layouts require live validation. No matching rows stops the run; ambiguous or missing company values stay blank. Test one page and check the workbook against ContactOut before a large run.

## Validation

`node --test tests/background.test.cjs`

`node tests/extract-browser.cjs` uses an isolated Edge browser and synthetic contact cards to test row boundaries, current versus past employers, masked addresses, and two-email ordering. It uses the existing local test harness with no sandbox solely for fixture rendering. The extension does not change the user's browser sandbox.

`node tests/excel.test.cjs` writes a fixture workbook and validates its ZIP/XML structure with Python's standard library. No runtime libraries or network requests are needed.
