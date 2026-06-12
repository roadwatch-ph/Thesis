/**
 * Google Apps Script backend for the Payment Tracker upload form.
 *
 * Setup:
 * 1. Paste this file into Apps Script as code.gs.
 * 2. Leave SPREADSHEET_ID blank unless you intentionally want to force one Sheet.
 * 3. Optional: set DRIVE_FOLDER_ID to save uploaded receipts in a specific folder.
 * 4. Deploy as a Web App with "Execute as: Me" and "Who has access: Anyone".
 *
 * If SPREADSHEET_ID is blank, the backend uses the spreadsheet bound to this
 * Apps Script project. If there is no bound spreadsheet, it automatically
 * creates a Google Sheet named STORAGE_SPREADSHEET_NAME and remembers it.
 */
// Default setup: keep this blank so the Web App URL is the only frontend
// configuration needed. Fill this only when you intentionally want this
// backend to write to one existing Sheet that the script owner can edit.
const SPREADSHEET_ID = "";
const BACKEND_VERSION = "cumulative-contribution-target-v1";
const DRIVE_FOLDER_ID = "1JU78o8NGnt-YrBp_7iR7d3WIEbx2AceL";
const STORAGE_SPREADSHEET_NAME = "Payment Tracker Storage";
const SPREADSHEET_PROPERTY_KEY = "PAYMENT_TRACKER_SPREADSHEET_ID";
const SHEET_NAME = "Payments";
const DEFAULT_WEEKLY_AMOUNT = 50;
const DEFAULT_TOTAL_WEEKS = 30;
const DEFAULT_FIRST_DUE_DATE = "2026-06-07";
const CONTRIBUTION_SETTING_KEYS = {
  weeklyAmount: "CONTRIBUTION_WEEKLY_AMOUNT",
  totalWeeks: "CONTRIBUTION_TOTAL_WEEKS",
  firstDueDate: "CONTRIBUTION_FIRST_DUE_DATE",
};
const MEMBERS = [
  "Jhon Lenard Dimaano",
  "Prince Johnel Abe",
  "Michael Orilla",
  "Carmela Elaine Agrao",
  "Darlene Grace Villanueva",
];
const MEMBER_EMAILS = {
  "Jhon Lenard Dimaano": "22-07456@g.batstate-u.edu.ph",
  "Prince Johnel Abe": "22-03511@g.batstate-u.edu.ph",
  "Michael Orilla": "22-05880@g.batstate-u.edu.ph",
  "Carmela Elaine Agrao": "22-07514@g.batstate-u.edu.ph",
  "Darlene Grace Villanueva": "22-05233@g.batstate-u.edu.ph",
};
const REMINDER_DAYS_BEFORE_DUE = 3;
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

    if (action === "dashboard") {
      return createApiResponse(getDashboardData(), callback);
    }

    if (action && action !== "health") {
      return createApiResponse({
        success: false,
        message: `Unknown action: ${action}`,
        backendVersion: BACKEND_VERSION,
      }, callback);
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
      backendVersion: BACKEND_VERSION,
    }, callback);
  }
}

function doPost(event) {
  try {
    const payload = parsePayload(event);
    validateCorePaymentPayload(payload);

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


/**
 * Run this once in Apps Script to create the daily contribution email trigger.
 * The trigger calls sendContributionReminderEmails every day between 8AM-9AM
 * in the Apps Script project's timezone.
 */
function installContributionReminderTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "sendContributionReminderEmails")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("sendContributionReminderEmails")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
}

/**
 * Daily email job for contribution reminders.
 * Sends:
 * - 3-day reminder when the due date is exactly 3 days away.
 * - due-today notice on the exact due date.
 * - overdue notice after the due date.
 *
 * Members whose total accumulated payments are already equal to or greater than
 * the cumulative required contribution for that due date are skipped and will not receive an email.
 */
function sendContributionReminderEmails() {
  const spreadsheet = getSpreadsheet();
  const sheet = getPaymentsSheet(spreadsheet);
  const contributionSettings = getContributionSettings();
  const weeks = buildContributionWeeks(contributionSettings);
  const payments = getPaymentRows(sheet);
  const today = getTodayDateOnly();
  const notices = [];

  weeks.forEach((week) => {
    const noticeType = getContributionNoticeType(week.id, today);
    if (!noticeType) {
      return;
    }

    MEMBERS.forEach((memberName) => {
      const email = MEMBER_EMAILS[memberName];
      if (!email) {
        return;
      }

      const amountPaid = getMemberTotalPaid(payments, memberName);
      const requiredAmount = getCumulativeRequiredAmountForWeek(week, contributionSettings.weeklyAmount);
      if (amountPaid >= requiredAmount) {
        return;
      }

      const emailMessage = buildContributionEmailMessage({
        noticeType,
        memberName,
        dueDate: week.id,
        amountPaid,
        requiredAmount,
      });

      MailApp.sendEmail({
        to: email,
        subject: emailMessage.subject,
        body: emailMessage.body,
      });

      notices.push({
        memberName,
        email,
        dueDate: week.id,
        noticeType,
        amountPaid,
        requiredAmount,
      });
    });
  });

  return {
    success: true,
    sent: notices.length,
    notices,
    backendVersion: BACKEND_VERSION,
  };
}

function getContributionNoticeType(dueDateText, today) {
  const dueDate = parseIsoDate(dueDateText);
  const daysUntilDue = getDayDifference(today, dueDate);

  if (daysUntilDue === REMINDER_DAYS_BEFORE_DUE) {
    return "reminder";
  }

  if (daysUntilDue === 0) {
    return "dueToday";
  }

  if (daysUntilDue < 0) {
    return "overdue";
  }

  return "";
}

function getDayDifference(startDate, endDate) {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function getMemberTotalPaid(payments, memberName) {
  return payments
    .filter((payment) => payment.memberName === memberName)
    .reduce((total, payment) => total + payment.amountPaid, 0);
}

function getCumulativeRequiredAmountForWeek(week, weeklyAmount) {
  return (Number(week.weekNumber) || 0) * weeklyAmount;
}

function buildContributionEmailMessage(details) {
  if (details.noticeType === "reminder") {
    return buildReminderEmail(details);
  }

  if (details.noticeType === "dueToday") {
    return buildDueTodayEmail(details);
  }

  return buildOverdueEmail(details);
}

function buildReminderEmail(details) {
  const dueDate = formatDisplayDate(details.dueDate);
  return {
    subject: "Contribution Payment Reminder",
    body: [
      "Dear Member,",
      "",
      `This is a friendly reminder that your scheduled contribution payment is due on ${dueDate}, which is 3 days from today.`,
      "",
      `According to our records, your accumulated contribution is ${formatCurrency(details.amountPaid)}, while the cumulative target for this due date is ${formatCurrency(details.requiredAmount)}.`,
      "",
      "To avoid any delays or penalties, please ensure that your payment is completed on or before the due date.",
      "",
      "If you have already made a recent payment that is not yet reflected in the system, please disregard this notice.",
      "",
      "Thank you for your cooperation.",
    ].join("\n"),
  };
}

function buildDueTodayEmail(details) {
  const dueDate = formatDisplayDate(details.dueDate);
  const remainingBalance = Math.max(details.requiredAmount - details.amountPaid, 0);
  return {
    subject: "Contribution Payment Due Today",
    body: [
      "Dear Member,",
      "",
      `This is to inform you that your contribution payment is due today, ${dueDate}.`,
      "",
      "Our records indicate that your accumulated contribution has not yet reached the target for this due date.",
      "",
      `Cumulative Target: ${formatCurrency(details.requiredAmount)}`,
      `Accumulated Contribution: ${formatCurrency(details.amountPaid)}`,
      `Outstanding Amount: ${formatCurrency(remainingBalance)}`,
      "",
      "Kindly settle your contribution today to maintain your account in good standing.",
      "",
      "If payment has already been made, please disregard this notice.",
      "",
      "Thank you for your prompt attention.",
    ].join("\n"),
  };
}

function buildOverdueEmail(details) {
  const dueDate = formatDisplayDate(details.dueDate);
  const remainingBalance = Math.max(details.requiredAmount - details.amountPaid, 0);
  return {
    subject: "Overdue Contribution Notice",
    body: [
      "Dear Member,",
      "",
      `Our records indicate that your accumulated contribution has not yet reached the target for the due date ${dueDate}.`,
      "",
      `Cumulative Target: ${formatCurrency(details.requiredAmount)}`,
      `Accumulated Contribution: ${formatCurrency(details.amountPaid)}`,
      `Outstanding Amount: ${formatCurrency(remainingBalance)}`,
      "",
      "Your contribution is now overdue. We kindly request that you settle the outstanding amount as soon as possible to avoid any applicable penalties or account restrictions.",
      "",
      "If you have recently made a payment, please disregard this notice while we update our records.",
      "",
      "For any questions or concerns regarding your contribution status, please contact us.",
      "",
      "Thank you for your immediate attention to this matter.",
    ].join("\n"),
  };
}

function formatDisplayDate(isoDate) {
  return Utilities.formatDate(parseIsoDate(isoDate), Session.getScriptTimeZone(), "MMMM d, yyyy");
}

function formatCurrency(amount) {
  return `₱${Number(amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function validateCorePaymentPayload(payload) {
  const requiredFields = [
    "memberName",
    "dueDate",
    "paymentMethod",
    "amountPaid",
    "referenceNumber",
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

  if (!isValidIsoDateString(payload.dueDate)) {
    throw new Error("Due date must use YYYY-MM-DD format.");
  }

  // Receipt handling is deliberately non-blocking. The browser still requires
  // a proof file, but the backend records the payment details first and writes
  // any receipt issue into Receipt Save Status instead of dropping the row.
}

function validateReceiptPayload(payload) {
  if (!payload.fileName || !payload.mimeType || !payload.fileBase64) {
    return;
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
      throw new Error("Unable to open the configured Google Sheet. Leave SPREADSHEET_ID blank to use automatic storage, or check that the configured Sheet ID is correct and the script owner has edit access.");
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
      receipt.fileName || payload.fileName,
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
  if (!payload.fileBase64 || !payload.fileName || !payload.mimeType) {
    return { url: "", status: "Not saved: no receipt file data received", fileName: "" };
  }

  if (!folderId) {
    return { url: "", status: "Not saved: DRIVE_FOLDER_ID is blank", fileName: "" };
  }

  try {
    validateReceiptPayload(payload);
    const bytes = Utilities.base64Decode(payload.fileBase64);
    const receiptFileName = buildReceiptFileName(payload);
    const rootFolder = DriveApp.getFolderById(folderId);
    const memberFolder = getMemberReceiptFolder(rootFolder, payload.memberName);
    const blob = Utilities.newBlob(bytes, payload.mimeType, receiptFileName);
    const file = memberFolder.createFile(blob);

    return {
      url: file.getUrl(),
      status: `Saved to ${memberFolder.getName()}/${receiptFileName}`,
      fileName: receiptFileName,
    };
  } catch (error) {
    return { url: "", status: `Not saved: ${error.message}`, fileName: "" };
  }
}

function buildReceiptFileName(payload) {
  const baseName = `${payload.memberName}_${payload.dueDate}`;
  const extension = getReceiptFileExtension(payload.fileName, payload.mimeType);
  return sanitizeDriveFileName(`${baseName}${extension}`);
}

function getReceiptFileExtension(fileName, mimeType) {
  const normalizedFileName = String(fileName || "").toLowerCase();
  const extensionMatch = normalizedFileName.match(/\.[0-9a-z]+$/);

  if (extensionMatch && [".png", ".jpg", ".jpeg", ".pdf"].includes(extensionMatch[0])) {
    return extensionMatch[0];
  }

  if (mimeType === "image/png") {
    return ".png";
  }

  if (mimeType === "image/jpeg") {
    return ".jpg";
  }

  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  return "";
}

function sanitizeDriveFileName(fileName) {
  return String(fileName || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getMemberReceiptFolder(rootFolder, memberName) {
  const expectedFolderName = sanitizeDriveFileName(memberName);
  if (!expectedFolderName) {
    throw new Error("Member name is required to choose the receipt folder.");
  }

  const folders = rootFolder.getFoldersByName(expectedFolderName);
  if (!folders.hasNext()) {
    throw new Error(`Member folder not found: ${expectedFolderName}`);
  }

  return folders.next();
}


function getContributionSettings() {
  const scriptProperties = PropertiesService.getScriptProperties();

  return {
    weeklyAmount: getPositiveNumberSetting(scriptProperties, CONTRIBUTION_SETTING_KEYS.weeklyAmount, DEFAULT_WEEKLY_AMOUNT),
    totalWeeks: getPositiveIntegerSetting(scriptProperties, CONTRIBUTION_SETTING_KEYS.totalWeeks, DEFAULT_TOTAL_WEEKS),
    firstDueDate: getIsoDateSetting(scriptProperties, CONTRIBUTION_SETTING_KEYS.firstDueDate, DEFAULT_FIRST_DUE_DATE),
  };
}

function getPositiveNumberSetting(scriptProperties, key, defaultValue) {
  const configuredValue = getStringValue(scriptProperties.getProperty(key));
  if (!configuredValue) {
    return defaultValue;
  }

  const numericValue = Number(configuredValue.replace(/,/g, ""));
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : defaultValue;
}

function getPositiveIntegerSetting(scriptProperties, key, defaultValue) {
  const configuredValue = getStringValue(scriptProperties.getProperty(key));
  if (!configuredValue) {
    return defaultValue;
  }

  const numericValue = Number(configuredValue.replace(/,/g, ""));
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : defaultValue;
}

function getIsoDateSetting(scriptProperties, key, defaultValue) {
  const configuredValue = getStringValue(scriptProperties.getProperty(key));
  return isValidIsoDateString(configuredValue) ? configuredValue : defaultValue;
}

function isValidIsoDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parts = value.split("-").map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2];
}

function getDashboardData() {
  const spreadsheet = getSpreadsheet();
  const sheet = getPaymentsSheet(spreadsheet);
  const contributionSettings = getContributionSettings();
  const weeks = buildContributionWeeks(contributionSettings);
  const currentWeek = getCurrentContributionWeek(weeks);
  const payments = getPaymentRows(sheet);
  const expectedPerMember = contributionSettings.weeklyAmount * contributionSettings.totalWeeks;
  const expectedTotal = expectedPerMember * MEMBERS.length;
  const memberSummaries = MEMBERS.map((memberName) => buildMemberSummary(memberName, payments, weeks, expectedPerMember, contributionSettings.weeklyAmount));
  const totalCollected = memberSummaries.reduce((total, member) => total + member.totalPaid, 0);
  const currentWeekRequiredAmount = getCumulativeRequiredAmountForWeek(currentWeek, contributionSettings.weeklyAmount);
  const paidThisWeek = memberSummaries.filter((member) => member.totalPaid >= currentWeekRequiredAmount).length;
  const upcomingDueDates = weeks
    .filter((week) => !week.isPastDue)
    .slice(0, 5)
    .map((week) => ({
      id: week.id,
      label: week.label,
      weekday: week.weekday,
      weekNumber: week.weekNumber,
      amount: contributionSettings.weeklyAmount,
      cumulativeTarget: getCumulativeRequiredAmountForWeek(week, contributionSettings.weeklyAmount),
    }));

  return {
    success: true,
    backendVersion: BACKEND_VERSION,
    spreadsheetUrl: spreadsheet.getUrl(),
    spreadsheetId: spreadsheet.getId(),
    sheetName: sheet.getName(),
    driveFolderId: DRIVE_FOLDER_ID,
    totalMembers: MEMBERS.length,
    weeklyAmount: contributionSettings.weeklyAmount,
    totalWeeks: contributionSettings.totalWeeks,
    firstDueDate: contributionSettings.firstDueDate,
    expectedTotal,
    totalCollected,
    remainingTotal: Math.max(expectedTotal - totalCollected, 0),
    collectionPercent: expectedTotal > 0 ? (totalCollected / expectedTotal) * 100 : 0,
    paidThisWeek,
    pendingThisWeek: Math.max(MEMBERS.length - paidThisWeek, 0),
    currentWeek,
    weeks,
    members: memberSummaries,
    memberPercent: expectedPerMember > 0 && memberSummaries.length > 0 ? (memberSummaries[0].totalPaid / expectedPerMember) * 100 : 0,
    nextDueDate: upcomingDueDates.length > 0 ? upcomingDueDates[0].id : "",
    upcomingDueDates,
    recentPayments: payments
      .slice()
      .sort((a, b) => b.timestampValue - a.timestampValue)
      .slice(0, 5)
      .map((payment) => ({
        memberName: payment.memberName,
        dueDate: payment.dueDate,
        amountPaid: payment.amountPaid,
        referenceNumber: payment.referenceNumber,
        receiptUrl: payment.receiptUrl,
      })),
  };
}

function buildMemberSummary(memberName, payments, weeks, expectedPerMember, weeklyAmount) {
  const memberPayments = payments.filter((payment) => payment.memberName === memberName);
  const weekPayments = {};

  weeks.forEach((week) => {
    weekPayments[week.id] = { amount: 0, receiptUrl: "" };
  });

  memberPayments.forEach((payment) => {
    if (!weekPayments[payment.dueDate]) {
      weekPayments[payment.dueDate] = { amount: 0, receiptUrl: "" };
    }

    weekPayments[payment.dueDate].amount += payment.amountPaid;
    if (payment.receiptUrl) {
      weekPayments[payment.dueDate].receiptUrl = payment.receiptUrl;
    }
  });

  const totalPaid = memberPayments.reduce((total, payment) => total + payment.amountPaid, 0);
  const paidWeeks = Math.min(weeks.length, Math.floor(totalPaid / weeklyAmount));
  const lastPayment = memberPayments
    .slice()
    .sort((a, b) => b.timestampValue - a.timestampValue)[0];

  return {
    name: memberName,
    totalPaid,
    paidWeeks,
    balance: Math.max(expectedPerMember - totalPaid, 0),
    lastPaymentDate: lastPayment ? lastPayment.dueDate : "",
    weekPayments,
  };
}

function getPaymentRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues()
    .map((row) => ({
      timestampValue: getTimestampValue(row[getHeaderIndex("Timestamp")]),
      memberName: getStringValue(row[getHeaderIndex("Member Name")]),
      dueDate: normalizeSheetDate(row[getHeaderIndex("Due Date")]),
      amountPaid: Number(row[getHeaderIndex("Amount Paid")]) || 0,
      referenceNumber: getStringValue(row[getHeaderIndex("Reference Number")]),
      receiptUrl: getStringValue(row[getHeaderIndex("Receipt File URL")]),
    }))
    .filter((payment) => payment.memberName && payment.dueDate && payment.amountPaid > 0);
}

function buildContributionWeeks(contributionSettings) {
  const firstDueDate = parseIsoDate(contributionSettings.firstDueDate);
  const today = getTodayDateOnly();
  const timezone = Session.getScriptTimeZone();
  const weeks = [];

  for (let index = 0; index < contributionSettings.totalWeeks; index += 1) {
    const dueDate = new Date(firstDueDate.getTime());
    dueDate.setDate(firstDueDate.getDate() + (index * 7));
    weeks.push({
      id: Utilities.formatDate(dueDate, timezone, "yyyy-MM-dd"),
      label: Utilities.formatDate(dueDate, timezone, "MMMM d, yyyy"),
      weekday: Utilities.formatDate(dueDate, timezone, "EEEE"),
      weekNumber: index + 1,
      cumulativeTarget: contributionSettings.weeklyAmount * (index + 1),
      isPastDue: dueDate.getTime() < today.getTime(),
    });
  }

  return weeks;
}

function getCurrentContributionWeek(weeks) {
  const today = getTodayDateOnly();
  let currentWeek = weeks[0];

  weeks.forEach((week) => {
    const dueDate = parseIsoDate(week.id);
    if (dueDate.getTime() <= today.getTime()) {
      currentWeek = week;
    }
  });

  return currentWeek;
}

function normalizeSheetDate(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  const textValue = getStringValue(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
    return textValue;
  }

  const parsedDate = new Date(textValue);
  return Number.isNaN(parsedDate.getTime()) ? textValue : Utilities.formatDate(parsedDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function getTimestampValue(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime())) {
    return value.getTime();
  }

  const parsedDate = new Date(getStringValue(value));
  return Number.isNaN(parsedDate.getTime()) ? 0 : parsedDate.getTime();
}

function parseIsoDate(value) {
  const parts = String(value).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getTodayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
