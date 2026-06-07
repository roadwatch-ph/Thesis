# Payment Tracker

Static Upload Payment page for a weekly contribution system. The page can be hosted on GitHub Pages and submits payment records to Google Sheets through a deployed Google Apps Script web app.

## Files

- `index.html` - Upload Payment page and side navigation.
- `styles.css` - Responsive styling based on the supplied layout.
- `script.js` - Browser-side validation and submission to Google Apps Script.
- `code.gs` - Google Apps Script backend that records payment data in Google Sheets and optionally stores receipt files in Google Drive.

## Google Apps Script setup

1. Open `code.gs` in Google Apps Script.
2. Optional: if you already have a Google Sheet, paste its spreadsheet ID into `SPREADSHEET_ID` in `code.gs`. If you leave it blank, the backend creates a `Payment Tracker Data` spreadsheet automatically on the first successful payment upload.
3. Optional: create a Google Drive folder for receipts and paste its folder ID into `DRIVE_FOLDER_ID`, or leave it as-is if you only need sheet records without saved files.
4. Deploy the Apps Script project as a web app.
5. Confirm the deployed web app URL in `APPS_SCRIPT_URL` in `script.js` is current. The current URL is `https://script.google.com/macros/s/AKfycbx4MKeYbQ9Izjt9ndxXYroA-T2DXUv_ZH3NTE8EYMZFC_fVbe7UMB-Hxno11SbvgY_i-g/exec`.
