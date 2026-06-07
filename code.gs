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
const SPREADSHEET_ID = "1fqmAhLxpl_3oH7K-GK-nkx6f60L1kJYIUeLXt7V5cq4";
const BACKEND_VERSION = "2026-06-07-data-handling";
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
  "Receipt Save Status",
  "Submission ID",
];

function doGet(event) {
  const callback = getCallbackName(event);

  try {
    const action = getRequestParameter(event, "action");

    if (action === "status") {
      return createApiResponse(getSubmissionStatus(getRequestParameter(event, "submissionId")), callback);
    }

    const spreadsheet = getSpreadsheet();
    const sheet = getPaymentsSheet(spreadsheet);

    return createApiResponse({
      success: true,
      message: "Payment Tracker backend is ready.",
      spreadsheetUrl: spreadsheet.getUrl(),
      spreadsheetId: spreadsheet.getId(),
      sheetName: sheet.getName(),
      headerCount: HEADERS.length,
      backendVersion: BACKEND_VERSION,
    }, callback);
  } catch (error) {
    return createApiResponse({
      success: false,
      message: error.message,
    }, callback);
  }
}

function doPost(event) {
  try {
    const payload = parsePayload(event);
    validatePayload(payload);

    const spreadsheet = getSpreadsheet();
    const sheet = getPaymentsSheet(spreadsheet);
    const existingRecord = findPaymentRecordBySubmissionId(sheet, payload.submissionId);

    if (existingRecord) {
      return createApiResponse({
        success: true,
        duplicate: true,
        message: "Payment submission was already recorded.",
        spreadsheetUrl: spreadsheet.getUrl(),
        spreadsheetId: spreadsheet.getId(),
        sheetName: sheet.getName(),
        rowNumber: existingRecord.rowNumber,
        submissionId: existingRecord.submissionId,
        receiptSaveStatus: existingRecord.receiptSaveStatus,
        backendVersion: BACKEND_VERSION,
      });
    }

    const receipt = saveReceiptFile(payload);
    const record = appendPaymentRecord(sheet, payload, receipt);

    return createApiResponse({
      success: true,
      message: "Payment submitted successfully.",
      spreadsheetUrl: spreadsheet.getUrl(),
      spreadsheetId: spreadsheet.getId(),
      sheetName: sheet.getName(),
      rowNumber: record.rowNumber,
      submissionId: record.submissionId,
      receiptUrl: receipt.url,
      receiptSaveStatus: receipt.status,
      backendVersion: BACKEND_VERSION,
    });
  } catch (error) {
    return createApiResponse({
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
  let parsedPayload;

  try {
    parsedPayload = JSON.parse(contents);
  } catch (error) {
    throw new Error("Payment data must be valid JSON.");
  }

  return normalizePayload(parsedPayload);
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
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch (error) {
    throw new Error("Payment form data could not be decoded. Please submit again.");
  }
}

function looksLikeJson(value) {
  const trimmedValue = String(value).trim();
  return trimmedValue.startsWith("{") && trimmedValue.endsWith("}");
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Payment data must be an object.");
  }

  const fileName = getStringValue(payload.fileName);
  const mimeType = normalizeMimeType(getStringValue(payload.mimeType), fileName);

  return {
    memberName: getStringValue(payload.memberName),
    dueDate: getStringValue(payload.dueDate),
    paymentMethod: getStringValue(payload.paymentMethod),
    amountPaid: normalizeAmount(payload.amountPaid),
    referenceNumber: getStringValue(payload.referenceNumber),
    notes: getStringValue(payload.notes),
    fileName,
    mimeType,
    fileBase64: stripBase64Prefix(getStringValue(payload.fileBase64)).replace(/\s/g, ""),
    submissionId: normalizeSubmissionId(getStringValue(payload.submissionId || payload.clientSubmissionId)),
  };
}

function normalizeMimeType(mimeType, fileName) {
  if (ACCEPTED_MIME_TYPES.includes(mimeType)) {
    return mimeType;
  }

  const normalizedFileName = String(fileName || "").toLowerCase();
  if (normalizedFileName.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedFileName.endsWith(".jpg") || normalizedFileName.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalizedFileName.endsWith(".pdf")) {
    return "application/pdf";
  }

  return mimeType;
}


function normalizeAmount(value) {
  return getStringValue(value).replace(/,/g, "");
}

function normalizeSubmissionId(value) {
  return value.replace(/[^0-9A-Za-z_.:-]/g, "").slice(0, 120);
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

  if (!/^\d+(\.\d{1,2})?$/.test(payload.amountPaid)) {
    throw new Error("Amount paid must be a valid number with up to 2 decimal places.");
  }

  const amount = Number(payload.amountPaid);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount paid must be greater than zero.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)) {
    throw new Error("Due date must use YYYY-MM-DD format.");
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

  if (fileSize <= 0) {
    throw new Error("Uploaded receipt file is empty. Please choose a valid payment proof file.");
  }

  if (fileSize > MAX_FILE_SIZE_BYTES) {
    throw new Error("File size must not exceed 5MB.");
  }
}

function getSpreadsheet() {
  const spreadsheetId = String(SPREADSHEET_ID || "").trim();

  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      throw new Error("Unable to open the configured Google Sheet. Check SPREADSHEET_ID and make sure the script owner has edit access.");
    }
  }

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    return activeSpreadsheet;
  }

  const scriptProperties = PropertiesService.getScriptProperties();
  const savedSpreadsheetId = scriptProperties.getProperty(SPREADSHEET_PROPERTY_KEY);
  if (savedSpreadsheetId) {
    try {
      return SpreadsheetApp.openById(savedSpreadsheetId);
    } catch (error) {
      scriptProperties.deleteProperty(SPREADSHEET_PROPERTY_KEY);
    }
  }

  const spreadsheet = SpreadsheetApp.create(STORAGE_SPREADSHEET_NAME);
  scriptProperties.setProperty(SPREADSHEET_PROPERTY_KEY, spreadsheet.getId());
  return spreadsheet;
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

    const submissionId = payload.submissionId || Utilities.getUuid();
    const existingRecord = findPaymentRecordBySubmissionId(sheet, submissionId);
    if (existingRecord) {
      return existingRecord;
    }

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
      receipt.status,
      submissionId,
    ];
    const rowNumber = sheet.getLastRow() + 1;

    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    SpreadsheetApp.flush();

    const savedSubmissionId = sheet.getRange(rowNumber, getSubmissionIdColumn()).getValue();
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
    return { url: "", status: "Not saved: DRIVE_FOLDER_ID is blank" };
  }

  try {
    const bytes = Utilities.base64Decode(payload.fileBase64);
    const safeFileName = payload.fileName.replace(/[\\/:*?"<>|]/g, "-");
    const blob = Utilities.newBlob(bytes, payload.mimeType, `${Date.now()}-${safeFileName}`);
    const folder = DriveApp.getFolderById(folderId);
    const file = folder.createFile(blob);

    return { url: file.getUrl(), status: "Saved" };
  } catch (error) {
    return { url: "", status: `Not saved: ${error.message}` };
  }
}

function getSubmissionStatus(submissionId) {
  if (!submissionId) {
    throw new Error("submissionId is required.");
  }

  const spreadsheet = getSpreadsheet();
  const sheet = getPaymentsSheet(spreadsheet);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      success: true,
      found: false,
      message: "No payment records found yet.",
      spreadsheetUrl: spreadsheet.getUrl(),
      sheetName: sheet.getName(),
      backendVersion: BACKEND_VERSION,
    };
  }

  const record = findPaymentRecordBySubmissionId(sheet, normalizeSubmissionId(submissionId));
  if (!record) {
    return {
      success: true,
      found: false,
      message: "Submission has not appeared in the Payments sheet yet.",
      spreadsheetUrl: spreadsheet.getUrl(),
      sheetName: sheet.getName(),
      backendVersion: BACKEND_VERSION,
    };
  }

  return {
    success: true,
    found: true,
    message: "Submission was found in Google Sheets.",
    spreadsheetUrl: spreadsheet.getUrl(),
    spreadsheetId: spreadsheet.getId(),
    sheetName: sheet.getName(),
    rowNumber: record.rowNumber,
    submissionId: record.submissionId,
    receiptSaveStatus: record.receiptSaveStatus,
    backendVersion: BACKEND_VERSION,
  };
}

function findPaymentRecordBySubmissionId(sheet, submissionId) {
  const normalizedSubmissionId = normalizeSubmissionId(submissionId);
  const lastRow = sheet.getLastRow();

  if (!normalizedSubmissionId || lastRow < 2) {
    return null;
  }

  const submissionIdColumn = getSubmissionIdColumn();
  const match = sheet
    .getRange(2, submissionIdColumn, lastRow - 1, 1)
    .createTextFinder(normalizedSubmissionId)
    .matchEntireCell(true)
    .findNext();

  if (!match) {
    return null;
  }

  const rowNumber = match.getRow();
  const rowValues = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];

  return {
    rowNumber,
    submissionId: normalizedSubmissionId,
    receiptSaveStatus: rowValues[getHeaderIndex("Receipt Save Status")],
  };
}

function getHeaderIndex(header) {
  const index = HEADERS.indexOf(header);
  if (index < 0) {
    throw new Error(`${header} column is not configured.`);
  }

  return index;
}

function getSubmissionIdColumn() {
  return getHeaderIndex("Submission ID") + 1;
}

function getRequestParameter(event, key) {
  return event && event.parameter && event.parameter[key] ? String(event.parameter[key]).trim() : "";
}

function getCallbackName(event) {
  const callback = getRequestParameter(event, "callback");
  return /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback) ? callback : "";
}

function createApiResponse(data, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(data)});`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
