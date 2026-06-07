/**
 * Google Apps Script backend for the Payment Tracker upload form.
 *
 * Setup:
 * 1. Paste this file into Apps Script as code.gs.
 * 2. Optional: set SPREADSHEET_ID only if you already have a specific Google Sheet.
 * 3. Optional: set DRIVE_FOLDER_ID to save uploaded receipts in a specific folder.
 * 4. Deploy as a Web App with "Execute as: Me" and "Who has access: Anyone".
 *
 * If SPREADSHEET_ID is blank, the backend uses the spreadsheet bound to this
 * Apps Script project. If there is no bound spreadsheet, it automatically
 * creates a Google Sheet named STORAGE_SPREADSHEET_NAME and remembers it.
 */
const SPREADSHEET_ID = "";
const DRIVE_FOLDER_ID = "";
const STORAGE_SPREADSHEET_NAME = "Payment Tracker Storage";
const SPREADSHEET_PROPERTY_KEY = "PAYMENT_TRACKER_SPREADSHEET_ID";
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
  "Submission ID",
];

function doGet() {
  try {
    const spreadsheet = getSpreadsheet();
    const sheet = getPaymentsSheet(spreadsheet);

    return createJsonResponse({
      success: true,
      message: "Payment Tracker backend is ready.",
      spreadsheetUrl: spreadsheet.getUrl(),
      spreadsheetId: spreadsheet.getId(),
      sheetName: sheet.getName(),
      headerCount: HEADERS.length,
    });
  } catch (error) {
    return createJsonResponse({
      success: false,
      message: error.message,
    });
  }
}

function doPost(event) {
  try {
    const payload = parsePayload(event);
    validatePayload(payload);

    const spreadsheet = getSpreadsheet();
    const sheet = getPaymentsSheet(spreadsheet);
    const receipt = saveReceiptFile(payload);
    const record = appendPaymentRecord(sheet, payload, receipt);

    return createJsonResponse({
      success: true,
      message: "Payment submitted successfully.",
      spreadsheetUrl: spreadsheet.getUrl(),
      spreadsheetId: spreadsheet.getId(),
      sheetName: sheet.getName(),
      rowNumber: record.rowNumber,
      submissionId: record.submissionId,
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
  if (!event) {
    throw new Error("No payment data was received.");
  }

  const contents = event.postData && event.postData.contents ? event.postData.contents : "";
  const parameters = event.parameter || {};

  if (parameters.payload) {
    return parseJsonPayload(parameters.payload);
  }

  if (contents) {
    if (looksLikeJson(contents)) {
      return parseJsonPayload(contents);
    }

    const decodedPayload = parseUrlEncodedPayload(contents);
    if (decodedPayload) {
      return decodedPayload;
    }
  }

  if (Object.keys(parameters).length > 0) {
    return normalizePayload(parameters);
  }

  throw new Error("No payment data was received.");
}

function parseJsonPayload(contents) {
  try {
    return normalizePayload(JSON.parse(contents));
  } catch (error) {
    throw new Error("Payment data must be valid JSON.");
  }
}

function parseUrlEncodedPayload(contents) {
  const fields = {};

  contents.split("&").forEach((pair) => {
    if (!pair) {
      return;
    }

    const separatorIndex = pair.indexOf("=");
    const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
    const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : "";
    const key = decodeFormValue(rawKey);
    const value = decodeFormValue(rawValue);
    fields[key] = value;
  });

  if (fields.payload) {
    return parseJsonPayload(fields.payload);
  }

  return Object.keys(fields).length > 0 ? normalizePayload(fields) : null;
}

function decodeFormValue(value) {
  return decodeURIComponent(String(value).replace(/\+/g, " "));
}

function looksLikeJson(value) {
  const trimmedValue = String(value).trim();
  return trimmedValue.startsWith("{") && trimmedValue.endsWith("}");
}

function normalizePayload(payload) {
  return {
    memberName: getStringValue(payload.memberName),
    dueDate: getStringValue(payload.dueDate),
    paymentMethod: getStringValue(payload.paymentMethod),
    amountPaid: getStringValue(payload.amountPaid),
    referenceNumber: getStringValue(payload.referenceNumber),
    notes: getStringValue(payload.notes),
    fileName: getStringValue(payload.fileName),
    mimeType: getStringValue(payload.mimeType),
    fileBase64: stripBase64Prefix(getStringValue(payload.fileBase64)),
  };
}

function getStringValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]).trim() : "";
  }

  return value === null || value === undefined ? "" : String(value).trim();
}

function stripBase64Prefix(value) {
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
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
    if (!payload[field]) {
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

  let fileSize = 0;
  try {
    fileSize = Utilities.base64Decode(payload.fileBase64).length;
  } catch (error) {
    throw new Error("Uploaded receipt data is not valid base64.");
  }

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new Error("File size must not exceed 5MB.");
  }
}

function getSpreadsheet() {
  const spreadsheetId = String(SPREADSHEET_ID || "").trim();
  if (!spreadsheetId) {
    throw new Error("Please configure SPREADSHEET_ID in code.gs with the Google Sheet ID you want to update.");
  }
}

  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error("Unable to open the configured Google Sheet. Check SPREADSHEET_ID and make sure the script owner has edit access.");
  }
}

function getPaymentsSheet(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), HEADERS.length);
  const existingHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const needsHeaders = sheet.getLastRow() === 0 || HEADERS.some((header, index) => existingHeaders[index] !== header);

  if (!needsHeaders) {
    return;
  }

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
}

function appendPaymentRecord(sheet, payload, receipt) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    ensureHeaders(sheet);

    const submissionId = Utilities.getUuid();
    const row = [
      new Date(),
      payload.memberName,
      payload.dueDate,
      payload.paymentMethod,
      Number(payload.amountPaid),
      payload.referenceNumber,
      payload.notes,
      payload.fileName,
      receipt.url,
      payload.mimeType,
      submissionId,
    ];
    const rowNumber = sheet.getLastRow() + 1;

    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();

    const savedSubmissionId = sheet.getRange(rowNumber, HEADERS.length).getValue();
    if (savedSubmissionId !== submissionId) {
      throw new Error("The payment could not be verified in Google Sheets. Please check the Apps Script execution log.");
    }

    return { rowNumber, submissionId };
  } finally {
    lock.releaseLock();
  }
}

function saveReceiptFile(payload) {
  const folderId = String(DRIVE_FOLDER_ID || "").trim();
  if (!folderId || !payload.fileBase64) {
    return { url: "" };
  }

  try {
    const bytes = Utilities.base64Decode(payload.fileBase64);
    const safeFileName = payload.fileName.replace(/[\\/:*?"<>|]/g, "-");
    const blob = Utilities.newBlob(bytes, payload.mimeType, `${Date.now()}-${safeFileName}`);
    const folder = DriveApp.getFolderById(folderId);
    const file = folder.createFile(blob);

    return { url: file.getUrl() };
  } catch (error) {
    throw new Error("Unable to save receipt file in Google Drive. Check DRIVE_FOLDER_ID and Drive permissions.");
  }
}

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
