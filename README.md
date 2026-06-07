# Payment Tracker

Static Upload Payment page for a weekly contribution system. The page can be hosted on GitHub Pages and submits payment records to Google Sheets through a deployed Google Apps Script web app.

## Files

- `index.html` - Upload Payment page and side navigation.
- `styles.css` - Responsive styling based on the supplied layout.
- `script.js` - Browser-side validation and submission to Google Apps Script.
- `code.gs` - Google Apps Script backend that records payment data in Google Sheets and optionally stores receipt files in Google Drive.

## Google Apps Script setup

1. Open `code.gs` in Google Apps Script.
2. You can leave `SPREADSHEET_ID` blank. If the Apps Script project is bound to a Google Sheet, that Sheet is used as the backend storage. If the project is standalone, the backend automatically creates a Google Sheet named `Payment Tracker Storage` and remembers its ID in Script Properties.
3. Optional: if you already have a specific Sheet that must be used, paste its spreadsheet ID into `SPREADSHEET_ID`. The spreadsheet ID is the text between `/d/` and `/edit` in the Sheet URL.
4. Optional: create a Google Drive folder for receipts and paste its folder ID into `DRIVE_FOLDER_ID`, or leave it blank if you only need sheet records without saved files.
5. In Apps Script, run `doGet` once and approve the requested Google permissions so the script can create/open the storage Sheet and write records.
6. Deploy the Apps Script project as a web app. Choose **Deploy > New deployment** after changing `code.gs`; Apps Script keeps serving old code until a new web app version is deployed. Set **Execute as** to your account and **Who has access** to **Anyone** if the site is public.
7. Confirm the deployed web app URL in `APPS_SCRIPT_URL` in `script.js` is current. The current URL is `https://script.google.com/macros/s/AKfycby9MV1EbzVjUmXTtifTmpjmIJW0s3PLN09ZTgZ1eKbhPVlSSWvBn7CYgHe-XpMwGE7Vlw/exec`.

The website now sends submissions as a browser-safe form payload to avoid Google Apps Script CORS/redirect issues. Because that mode cannot read the JSON response in some browsers, verify the upload by checking the `Payments` sheet after the success message.

The backend accepts both JSON and form-encoded `payload` posts, trims values, validates the base64 receipt data, repairs the header row when needed, and writes each record with `setValues` under a script lock. If the record still does not appear, paste the intended spreadsheet ID into `SPREADSHEET_ID`, paste the latest `code.gs` contents into Apps Script, run `doGet` once to approve permissions, and deploy a new web app version.
