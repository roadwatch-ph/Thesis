# Payment Tracker

Static Upload Payment page for a weekly contribution system. The page can be hosted on GitHub Pages and submits payment records to Google Sheets through a deployed Google Apps Script web app.

## Files

- `index.html` - Upload Payment page and side navigation.
- `styles.css` - Responsive styling based on the supplied layout.
- `script.js` - Browser-side validation and submission to Google Apps Script.
- `code.gs` - Google Apps Script backend that records payment data in Google Sheets and optionally stores receipt files in Google Drive.

## Google Apps Script setup

1. Open `code.gs` in Google Apps Script.
2. Keep `SPREADSHEET_ID` blank by default. The public website only needs the deployed Apps Script **Web App URL** in `APPS_SCRIPT_URL`; the backend will use the Sheet bound to the Apps Script project, or automatically create a Google Sheet named `Payment Tracker Storage` and remember it in Script Properties.
3. Only fill `SPREADSHEET_ID` if you intentionally want to force one specific existing Sheet. If that ID is wrong or the script owner has no edit access, records cannot be written, so blank is safer for normal setup.
4. The weekly contribution schedule is configurable through Apps Script **Script Properties**, so future amount/schedule changes do not require editing and redeploying code. In Apps Script, open **Project Settings > Script Properties** and optionally set:
   - `CONTRIBUTION_WEEKLY_AMOUNT` - weekly amount; defaults to `50`.
   - `CONTRIBUTION_TOTAL_WEEKS` - number of weekly dues; defaults to `30`.
   - `CONTRIBUTION_FIRST_DUE_DATE` - first due date in `YYYY-MM-DD` format; defaults to `2026-06-07`.
   The frontend loads these values from `doGet?action=dashboard`, then fills the contribution card, due-date list, and payment amount field automatically.
5. Receipts are saved to the configured Google Drive receipts root folder (`DRIVE_FOLDER_ID = "1JU78o8NGnt-YrBp_7iR7d3WIEbx2AceL"`). Inside that root folder, create one subfolder per member using the exact same name shown in the upload form. The backend uses the submitted `memberName` to find that subfolder and saves the receipt as `MEMBER NAME_DUE DATE` with the original accepted file extension, for example `Jhon Lenard Dimaano_2026-06-07.jpg`.
6. In Apps Script, run `doGet` once and approve the requested Google permissions so the script can create/open the storage Sheet and write records.
7. To enable automatic member emails, run `installContributionReminderTrigger` once in Apps Script and approve the requested email/trigger permissions. This creates a daily trigger for `sendContributionReminderEmails`, which sends: a reminder exactly 3 days before each due date, a due-today email on the exact due date, and an overdue notice after missed due dates. The email job skips a member for a due date when that member's recorded payments for that due date are already equal to or greater than the weekly required amount.
8. Deploy the Apps Script project as a web app. Choose **Deploy > New deployment** after changing `code.gs`; Apps Script keeps serving old code until a new web app version is deployed. Set **Execute as** to your account and **Who has access** to **Anyone** if the site is public.
9. Confirm the deployed web app URL in `APPS_SCRIPT_URL` in `script.js` is current. The current URL is `https://script.google.com/macros/s/AKfycbwNwcZNPpp9hUhq-uod3euaiNvvtgaZBuNzEbo9iYnciXedaCtut4PSlzEGi6EZ2PRG/exec`.

The website sends submissions through a hidden HTML form/iframe as a browser-safe form payload to avoid Google Apps Script CORS/redirect issues that can prevent `fetch(..., { mode: "no-cors" })` posts from reliably reaching `doPost`. Each submission now includes a unique `submissionId`; after sending, the page polls the Apps Script `doGet?action=status` endpoint through JSONP until it verifies that the row exists in the `Payments` sheet. This prevents the page from showing a false success when Apps Script accepted the browser request but did not write the row. `index.html` loads `script.js` with a dated cache-busting query string so GitHub Pages and the browser do not keep running an old script that can still display the old unverified success message.

The backend accepts both JSON and form-encoded `payload` posts, trims values, normalizes amount and submission ID fields, validates date format and receipt data, repairs the header row when needed, and writes each record with `setValues` under a script lock. Receipt routing uses the member and due date selected in the form: the Drive upload goes into the matching member subfolder and the saved file name is generated as `MEMBER NAME_DUE DATE` plus `.png`, `.jpg`, `.jpeg`, or `.pdf`. Repeated submissions with the same `submissionId` return the existing sheet row instead of creating a duplicate payment record. Receipt-file saving is non-blocking: if `DRIVE_FOLDER_ID` is blank/invalid, if the matching member folder is missing, or if receipt storage fails after the browser sends the payment details, the sheet row is still recorded and the receipt status is written in the `Receipt Save Status` column. If the record still does not appear, paste the latest `code.gs` contents into Apps Script, run `doGet` once to approve permissions, and deploy a new web app version. Apps Script keeps serving the previous deployment until you create that new deployment version.

## Troubleshooting: forced Sheet cannot be opened

If the website reports `Hindi ma-open ang Google Sheet na naka-force sa SPREADSHEET_ID`, the deployed Apps Script is trying to open a configured Sheet ID that is invalid or inaccessible in that deployment. The safest fix is to paste the latest `code.gs`, keep `const SPREADSHEET_ID = "";`, run `doGet` once to approve permissions, then create a **new** web app deployment. With `SPREADSHEET_ID` blank, the frontend only needs the Web App URL and the backend automatically uses the bound Sheet or creates/remembers a `Payment Tracker Storage` Sheet.

Only set `SPREADSHEET_ID` when you intentionally want to force one existing Sheet. In that case, copy only the Sheet ID from the Google Sheets URL and make sure the Google account selected as **Execute as: Me** owns or can edit that Sheet before deploying a new web app version.

## Troubleshooting: success message but no row

If the page says only `Payment sent successfully` but the `Payments` tab is still blank, the browser is running the old frontend. The fixed frontend must say `Payment sent. Checking if the row is already in Google Sheets...` first, then `Payment submitted and verified successfully` only after Apps Script confirms the row number. Hard-refresh the GitHub Pages tab, wait for the latest commit to publish, and make sure the deployed Apps Script contains the latest `code.gs`.

Also check the header row in the target Sheet. The latest backend has 12 columns and includes `Receipt Save Status` before `Submission ID`. If your Sheet still shows `Submission ID` in column K, the latest Apps Script has not written to that Sheet yet; paste the latest `code.gs`, run `doGet` once, approve permissions, then deploy a new web app version.
