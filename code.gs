/**
 * Google Apps Script backend for the Payment Tracker upload form.
 *
 * Setup:
 * 1. Paste this file into Apps Script as code.gs.
 * 2. Optional: set SPREADSHEET_ID to an existing Google Sheet ID.
 * 3. Optional: set DRIVE_FOLDER_ID to save uploaded receipts in a specific folder.
 * 4. Deploy as a Web App with "Execute as: Me" and "Who has access: Anyone".
 */
const SPREADSHEET_ID = "";
const DRIVE_FOLDER_ID = "";
const AUTO_SPREADSHEET_NAME = "Payment Tracker Data";
const SHEET_NAME = "Payments";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "application/pdf"];
const HEADERS = [
  "Timestamp",
  "Member Name",
  "Due Date",
  "Payment Method",
  "Amount Paid",
  "Reference Number",
  "Notes",
  "Receipt File Name",
  "Receipt File URL",
  "Receipt MIME Type",
];

function doGet() {
  const spreadsheet = getSpreadsheet();
  const sheet = getPaymentsSheet(spreadsheet);

  return createJsonResponse({
    success: true,
    message: "Payment Tracker backend is ready.",
    spreadsheetUrl: spreadsheet.getUrl(),
    sheetName: sheet.getName(),
  });
}

function doPost(event) {
  try {
    const payload = parsePayload(event);
    validatePayload(payload);

    const spreadsheet = getSpreadsheet();
    const sheet = getPaymentsSheet(spreadsheet);
    const receipt = saveReceiptFile(payload);

    sheet.appendRow([
      new Date(),
      payload.memberName,
      payload.dueDate,
      payload.paymentMethod,
      Number(payload.amountPaid),
      payload.referenceNumber,
      payload.notes || "",
      payload.fileName,
      receipt.url,
      payload.mimeType,
    ]);

    return createJsonResponse({
      success: true,
      message: "Payment submitted successfully.",
      spreadsheetUrl: spreadsheet.getUrl(),
      receiptUrl: receipt.url,
    });
  } catch (error) {
    return createJsonResponse({
      success: false,
      message: error.message,
    });
  }
}

function parsePayload(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error("No payment data was received.");
  }

  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error("Payment data must be valid JSON.");
  }
}

function validatePayload(payload) {
  const requiredFields = [
    "memberName",
    "dueDate",
    "paymentMethod",
    "amountPaid",
    "referenceNumber",
    "fileName",
    "mimeType",
    "fileBase64",
  ];

  requiredFields.forEach((field) => {
    if (!payload[field] || String(payload[field]).trim() === "") {
      throw new Error(`${field} is required.`);
    }
  });

  const amount = Number(payload.amountPaid);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount paid must be greater than zero.");
  }

  if (!ACCEPTED_MIME_TYPES.includes(payload.mimeType)) {
    throw new Error("Only PNG, JPG, JPEG, and PDF files are accepted.");
  }

  const fileSize = Utilities.base64Decode(payload.fileBase64).length;
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new Error("File size must not exceed 5MB.");
  }
}

function getSpreadsheet() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  const properties = PropertiesService.getScriptProperties();
  const savedSpreadsheetId = properties.getProperty("PAYMENT_TRACKER_SPREADSHEET_ID");

  if (savedSpreadsheetId) {
    try {
      return SpreadsheetApp.openById(savedSpreadsheetId);
    } catch (error) {
      properties.deleteProperty("PAYMENT_TRACKER_SPREADSHEET_ID");
    }
  }

  const spreadsheet = SpreadsheetApp.create(AUTO_SPREADSHEET_NAME);
  properties.setProperty("PAYMENT_TRACKER_SPREADSHEET_ID", spreadsheet.getId());
  return spreadsheet;
}

function getPaymentsSheet(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }

  return sheet;
}

function saveReceiptFile(payload) {
  if (!DRIVE_FOLDER_ID || !payload.fileBase64) {
    return { url: "" };
  }

  const bytes = Utilities.base64Decode(payload.fileBase64);
  const safeFileName = String(payload.fileName).replace(/[\\/:*?"<>|]/g, "-");
  const blob = Utilities.newBlob(bytes, payload.mimeType, `${Date.now()}-${safeFileName}`);
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const file = folder.createFile(blob);

  return { url: file.getUrl() };
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
