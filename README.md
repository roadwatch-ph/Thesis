# Payment Tracker

Static Upload Payment page for a weekly contribution system. The page can be hosted on GitHub Pages and submits payment records to Google Sheets through a deployed Google Apps Script web app.

## Files

- `index.html` - Upload Payment page and side navigation.
- `styles.css` - Responsive styling based on the supplied layout.
- `script.js` - Browser-side validation and submission to Google Apps Script.
- `code.gs` - Google Apps Script backend that records payment data in Google Sheets and optionally stores receipt files in Google Drive.

## Google Apps Script setup

1. Open `code.gs` in Google Apps Script.
2. If you want the records to go to your existing Google Sheet, paste its spreadsheet ID into `SPREADSHEET_ID` in `code.gs`. The spreadsheet ID is the text between `/d/` and `/edit` in the Sheet URL. If you leave `SPREADSHEET_ID` blank, the backend creates a separate `Payment Tracker Data` spreadsheet automatically on the first successful payment upload and reuses that spreadsheet on future uploads.
3. Optional: create a Google Drive folder for receipts and paste its folder ID into `DRIVE_FOLDER_ID`, or leave it blank if you only need sheet records without saved files.
4. In Apps Script, run `doGet` once and approve the requested Google permissions so the script can write to the Sheet.
5. Deploy the Apps Script project as a web app. Choose **Deploy > New deployment** after changing `code.gs`; Apps Script keeps serving old code until a new web app version is deployed. Set **Execute as** to your account and **Who has access** to **Anyone** if the site is public.
6. Confirm the deployed web app URL in `APPS_SCRIPT_URL` in `script.js` is current. The current URL is `https://script.google.com/macros/s/AKfycbw0J-TAo54QteqV4VbKzPDrru_4q3jMbjdItIrCZGKghVpdLdIwZ4zQXp0JWNDe6aVrIg/exec`.

After a successful upload, the website now shows the spreadsheet URL returned by the backend. Use that URL to confirm whether records are going to your intended Sheet or to the automatically created `Payment Tracker Data` Sheet.

If the page shows `Please configure SPREADSHEET_ID in code.gs.`, the deployed Apps Script is still running an older version. Paste the latest `code.gs` contents into Apps Script and deploy a new web app version.
