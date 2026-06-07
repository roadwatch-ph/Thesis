/**
 * Google Apps Script backend for the Upload Payment page.
 *
 * Setup:
 * 1. Create a Google Sheet and copy its spreadsheet ID.
 * 2. Optional: Create a Google Drive folder for uploaded receipts and copy its folder ID.
 * 3. Replace SPREADSHEET_ID and DRIVE_FOLDER_ID below.
 * 4. Deploy as Web app with access set to "Anyone" or your preferred organization scope.
 * 5. Copy the deployed Web app URL into APPS_SCRIPT_URL in script.js.
 */
const SPREADSHEET_ID = "PASTE_YOUR_SPREADSHEET_ID_HERE";
const SHEET_NAME = "Payments";
const DRIVE_FOLDER_ID = "PASTE_YOUR_DRIVE_FOLDER_ID_HERE";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "application/pdf"];

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    validatePayload_(payload);

    const fileUrl = saveReceiptFile_(payload);
    const sheet = getOrCreateSheet_();
    ensureHeaderRow_(sheet);

    sheet.appendRow([
      new Date(),
      payload.memberName,
      payload.dueDate,
      payload.paymentMethod,
      Number(payload.amountPaid),
      payload.referenceNumber,
      payload.notes || "",
      payload.fileName,
      payload.mimeType,
      fileUrl,
    ]);

    return jsonResponse_({ success: true, message: "Payment recorded successfully.", fileUrl });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function doGet() {
  return jsonResponse_({ success: true, message: "Upload Payment backend is online." });
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Missing request body.");
  }

  return JSON.parse(e.postData.contents);
}

function validatePayload_(payload) {
  const requiredFields = ["memberName", "dueDate", "paymentMethod", "amountPaid", "referenceNumber", "fileName", "mimeType", "fileBase64"];
  requiredFields.forEach((field) => {
    if (!payload[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  });

  if (!ACCEPTED_MIME_TYPES.includes(payload.mimeType)) {
    throw new Error("Invalid file type. Upload PNG, JPG, JPEG, or PDF only.");
  }

  const estimatedBytes = Math.ceil((payload.fileBase64.length * 3) / 4);
  if (estimatedBytes > MAX_FILE_SIZE_BYTES) {
    throw new Error("File size exceeds 5MB.");
  }

  if (Number(payload.amountPaid) <= 0) {
    throw new Error("Amount paid must be greater than zero.");
  }
}

function saveReceiptFile_(payload) {
  if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID.includes("PASTE_YOUR")) {
    return "Drive folder not configured";
  }

  const bytes = Utilities.base64Decode(payload.fileBase64);
  const safeName = payload.fileName.replace(/[\\/:*?"<>|]/g, "-");
  const blob = Utilities.newBlob(bytes, payload.mimeType, `${Date.now()}-${safeName}`);
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);
  return file.getUrl();
}

function getOrCreateSheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.includes("PASTE_YOUR")) {
    throw new Error("Please configure SPREADSHEET_ID in code.gs.");
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function ensureHeaderRow_(sheet) {
  const headers = ["Timestamp", "Member Name", "Due Date", "Payment Method", "Amount Paid", "Reference Number", "Notes", "File Name", "Mime Type", "Receipt URL"];
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = headers.every((header, index) => firstRow[index] === header);

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
