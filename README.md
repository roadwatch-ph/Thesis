# Payment Tracker

Static Upload Payment page for a weekly contribution system. The page can be hosted on GitHub Pages and submits payment records to Google Sheets through a deployed Google Apps Script web app.

## Files

- `index.html` - Upload Payment page and side navigation.
- `styles.css` - Responsive styling based on the supplied layout.
- `script.js` - Browser-side validation and submission to Google Apps Script.
- `code.gs` - Google Apps Script backend that records payment data in Google Sheets and optionally stores receipt files in Google Drive.

## Google Apps Script setup

1. Open `code.gs` in Google Apps Script.
2. `SPREADSHEET_ID` is currently set to `1fqmAhLxpl_3oH7K-GK-nkx6f60L1kJYIUeLXt7V5cq4`, the `Payment Tracker Storage` Sheet shown in the browser screenshot, so new submissions should append to its `Payments` tab. If you need a different Sheet, replace this value with the spreadsheet ID from the Sheet URL.
3. You can also leave `SPREADSHEET_ID` blank. If the Apps Script project is bound to a Google Sheet, that Sheet is used as the backend storage. If the project is standalone, the backend automatically creates a Google Sheet named `Payment Tracker Storage` and remembers its ID in Script Properties.
4. Optional: create a Google Drive folder for receipts and paste its folder ID into `DRIVE_FOLDER_ID`, or leave it blank if you only need sheet records without saved files.
5. In Apps Script, run `doGet` once and approve the requested Google permissions so the script can create/open the storage Sheet and write records.
6. Deploy the Apps Script project as a web app. Choose **Deploy > New deployment** after changing `code.gs`; Apps Script keeps serving old code until a new web app version is deployed. Set **Execute as** to your account and **Who has access** to **Anyone** if the site is public.
7. Confirm the deployed web app URL in `APPS_SCRIPT_URL` in `script.js` is current. The current URL is `https://script.google.com/macros/s/AKfycbxVOBOuTlNhkXVS1kI2MmAjYCAFXe5gf2fVIoTIGTIZalU3SMfLYI7QDozS9WSibX6itQ/exec`.

The website sends submissions as a browser-safe form payload to avoid Google Apps Script CORS/redirect issues. Each submission now includes a unique `submissionId`; after sending, the page polls the Apps Script `doGet?action=status` endpoint through JSONP until it verifies that the row exists in the `Payments` sheet. This prevents the page from showing a false success when Apps Script accepted the browser request but did not write the row. `index.html` loads `script.js` with a dated cache-busting query string so GitHub Pages and the browser do not keep running an old script that can still display the old unverified success message.

The backend accepts both JSON and form-encoded `payload` posts, trims values, validates the base64 receipt data, repairs the header row when needed, and writes each record with `setValues` under a script lock. Receipt-file saving is non-blocking: if `DRIVE_FOLDER_ID` is blank or invalid, the sheet row is still recorded and the receipt status is written in the `Receipt Save Status` column. If the record still does not appear, paste the latest `code.gs` contents into Apps Script, run `doGet` once to approve permissions, and deploy a new web app version. Apps Script keeps serving the previous deployment until you create that new deployment version.

## Troubleshooting: success message but no row

If the page says only `Payment sent successfully` but the `Payments` tab is still blank, the browser is running the old frontend. The fixed frontend must say `Payment sent. Checking if the row is already in Google Sheets...` first, then `Payment submitted and verified successfully` only after Apps Script confirms the row number. Hard-refresh the GitHub Pages tab, wait for the latest commit to publish, and make sure the deployed Apps Script contains the latest `code.gs`.

Also check the header row in the target Sheet. The latest backend has 12 columns and includes `Receipt Save Status` before `Submission ID`. If your Sheet still shows `Submission ID` in column K, the latest Apps Script has not written to that Sheet yet; paste the latest `code.gs`, run `doGet` once, approve permissions, then deploy a new web app version.
