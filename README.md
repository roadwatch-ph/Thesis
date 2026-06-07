# Payment Tracker

Static Upload Payment page for a weekly contribution system. The page can be hosted on GitHub Pages and submits payment records to Google Sheets through a deployed Google Apps Script web app.

## Files

- `index.html` - Upload Payment page and side navigation.
- `styles.css` - Responsive styling based on the supplied layout.
- `script.js` - Browser-side validation and submission to Google Apps Script.
- `code.gs` - Google Apps Script backend that records payment data in Google Sheets and optionally stores receipt files in Google Drive.

## Google Apps Script setup

1. Create a Google Sheet and copy the spreadsheet ID from its URL.
2. Optional: Create a Google Drive folder for receipt uploads and copy the folder ID.
3. Paste the spreadsheet ID into `SPREADSHEET_ID` in `code.gs`.
4. Paste the Drive folder ID into `DRIVE_FOLDER_ID` in `code.gs`, or leave it as-is if you only need sheet records without saved files.
5. Deploy the Apps Script project as a web app.
6. Copy the deployed web app URL into `APPS_SCRIPT_URL` in `script.js`.
