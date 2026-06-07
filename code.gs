/**
 * Google Apps Script backend for the Upload Payment page.
 *
 * Setup:
 * 1. Optional: Create a Google Sheet and copy its spreadsheet ID.
 * 2. Optional: Create a Google Drive folder for uploaded receipts and copy its folder ID.
 * 3. If you already have a sheet, replace SPREADSHEET_ID below with the ID from its URL.
 *    Example: https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 * 4. If SPREADSHEET_ID is left blank, the backend creates a spreadsheet automatically.
 * 5. Deploy as Web app with access set to "Anyone" or your preferred organization scope.
 * 6. Copy the deployed Web app URL into APPS_SCRIPT_URL in script.js.
 */
const BACKEND_VERSION = "2026-06-07-reliable-sheet-write";
const SPREADSHEET_ID = "";
const SHEET_NAME = "Payments";
const AUTO_SPREADSHEET_NAME = "Payment Tracker Data";
const SPREADSHEET_ID_PROPERTY = "PAYMENT_TRACKER_SPREADSHEET_ID";
const DRIVE_FOLDER_ID = "";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "application/pdf"];

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const payload = parsePayload_(e);
    validatePayload_(payload);

    const fileUrl = saveReceiptFile_(payload);
    const spreadsheet = getOrCreateSpreadsheet_();
    const sheet = getOrCreateSheet_(spreadsheet);
    ensureHeaderRow_(sheet);

    sheet.appendRow([
      new Date(),
      String(payload.memberName).trim(),
      String(payload.dueDate).trim(),
      String(payload.paymentMethod).trim(),
      Number(payload.amountPaid),
      String(payload.referenceNumber).trim(),
      String(payload.notes || "").trim(),
      String(payload.fileName).trim(),
      String(payload.mimeType).trim(),
      fileUrl,
    ]);
    SpreadsheetApp.flush();

    return jsonResponse_({
      success: true,
      message: "Payment recorded successfully.",
      fileUrl,
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      sheetName: sheet.getName(),
      version: BACKEND_VERSION,
    });
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message, version: BACKEND_VERSION });
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // No lock was acquired.
    }
  }
}

function doGet() {
  return jsonResponse_({
    success: true,
    message: "Upload Payment backend is online.",
    version: BACKEND_VERSION,
    spreadsheetMode: getConfiguredSpreadsheetId_() ? "configured" : "auto-created",
  });
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error("Missing request body.");
  }

  const contents = e.postData.contents;

  try {
    return JSON.parse(contents);
  } catch (error) {
    const params = e.parameter || {};

    if (params.payload) {
      return JSON.parse(params.payload);
    }

    throw new Error("Invalid request body. Send the payment details as JSON.");
  }
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

function getOrCreateSheet_(spreadsheet) {
  const existingSheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (existingSheet) {
    return existingSheet;
  }

  const sheets = spreadsheet.getSheets();
  const firstSheet = sheets[0];

  if (sheets.length === 1 && firstSheet.getLastRow() === 0 && firstSheet.getLastColumn() === 0) {
    firstSheet.setName(SHEET_NAME);
    return firstSheet;
  }

  return spreadsheet.insertSheet(SHEET_NAME);
}

function getOrCreateSpreadsheet_() {
  const configuredSpreadsheetId = getConfiguredSpreadsheetId_();

  if (configuredSpreadsheetId) {
    return SpreadsheetApp.openById(configuredSpreadsheetId);
  }

  const scriptProperties = PropertiesService.getScriptProperties();
  const savedSpreadsheetId = scriptProperties.getProperty(SPREADSHEET_ID_PROPERTY);

  if (savedSpreadsheetId) {
    try {
      return SpreadsheetApp.openById(savedSpreadsheetId);
    } catch (error) {
      scriptProperties.deleteProperty(SPREADSHEET_ID_PROPERTY);
    }
  }

  const spreadsheet = SpreadsheetApp.create(AUTO_SPREADSHEET_NAME);
  scriptProperties.setProperty(SPREADSHEET_ID_PROPERTY, spreadsheet.getId());
  return spreadsheet;
}

function getConfiguredSpreadsheetId_() {
  const spreadsheetId = String(SPREADSHEET_ID || "").trim();

  if (!spreadsheetId || spreadsheetId.includes("PASTE_YOUR")) {
    return "";
  }

  return spreadsheetId;
}

function ensureHeaderRow_(sheet) {
  const headers = ["Timestamp", "Member Name", "Due Date", "Payment Method", "Amount Paid", "Reference Number", "Notes", "File Name", "Mime Type", "Receipt URL"];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const hasHeaders = headers.every((header, index) => firstRow[index] === header);

  if (!hasHeaders) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
