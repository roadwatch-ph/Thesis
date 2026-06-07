const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby9x4MFYG1VhEPDPMnuOlndrKLF3GqTzhQorPMpSqdrbo4VKq4lUN_9LlS8JqLt0_hm-g/exec";
const CLIENT_VERSION = "2026-06-07-verify";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];
const VERIFICATION_ATTEMPTS = 8;
const VERIFICATION_DELAY_MS = 2500;
const JSONP_TIMEOUT_MS = 10000;

const form = document.querySelector("#paymentForm");
const statusBox = document.querySelector("#formStatus");
const submitButton = form.querySelector("button[type='submit']");

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = `form-status ${type}`;
}

function normalizeBackendError(message) {
  if (!message) {
    return "Google Apps Script rejected the payment upload.";
  }

  if (message.includes("Unable to open the configured Google Sheet")) {
    return "Hindi ma-open ang Google Sheet na nasa SPREADSHEET_ID. Pwede mo itong iwanang blank para automatic gumawa ang backend ng storage Sheet, o ilagay ang tamang Sheet ID at siguraduhing may edit access ang script owner.";
  }

  if (message.includes("Permission denied") || message.includes("Authorization")) {
    return "Google Apps Script needs permission to write to your Google Sheet. Open the script, run doGet once, approve access, then deploy a new web app version with access set to Anyone.";
  }

  return message;
}

function buildAppsScriptUrl(params = {}) {
  const url = new URL(APPS_SCRIPT_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function generateSubmissionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function parseBackendResponse(response) {
  if (response.type === "opaque") {
    return {
      success: true,
      assumedSuccess: true,
      message: `Payment upload was sent to Google Apps Script. Client version: ${CLIENT_VERSION}.`,
    };
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Google Apps Script returned HTTP ${response.status}. Check that the web app is deployed and shared with Anyone.`);
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error("Google Apps Script did not return JSON. Make sure APPS_SCRIPT_URL uses the deployed /exec web app URL, not the Apps Script editor URL.");
  }
}

async function sendPaymentPayload(payload) {
  const formPayload = new URLSearchParams();
  formPayload.set("payload", JSON.stringify(payload));

  return fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    body: formPayload,
  });
}

function validateBackendVersion(backendStatus) {
  if (!backendStatus.success) {
    throw new Error(normalizeBackendError(backendStatus.message));
  }

  if (backendStatus.backendVersion !== EXPECTED_BACKEND_VERSION) {
    throw new Error(`Hindi pa latest ang deployed Google Apps Script. Expected backend ${EXPECTED_BACKEND_VERSION}, pero nakuha: ${backendStatus.backendVersion || "old/unknown"}. I-paste ang latest code.gs, run doGet once, then Deploy > New deployment bago mag-submit ulit.`);
  }

  if (Number(backendStatus.headerCount) !== 12) {
    throw new Error(`Mali ang Payments sheet headers. Expected 12 columns, pero ${backendStatus.headerCount || "unknown"} ang nakita. Run doGet sa latest Apps Script para maayos ang headers, then deploy again.`);
  }

  return backendStatus;
}

async function checkBackendReady() {
  showStatus(`Checking Google Sheets backend... (client ${CLIENT_VERSION})`, "success");
  const backendStatus = await requestJsonp({ action: "health" });
  return validateBackendVersion(backendStatus);
}

function requestJsonp(params) {
  return new Promise((resolve, reject) => {
    const callbackName = `paymentTrackerCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let timeoutId;

    function cleanup() {
      delete window[callbackName];
      script.remove();
      window.clearTimeout(timeoutId);
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Unable to contact Google Apps Script for verification. Check the deployed web app URL and access settings."));
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Apps Script verification timed out. Check that the latest code.gs is deployed as a web app."));
    }, JSONP_TIMEOUT_MS);

    script.src = buildAppsScriptUrl({ ...params, callback: callbackName, cacheBust: Date.now() });
    document.head.append(script);
  });
}

async function verifySubmission(submissionId) {
  let lastStatus = null;

  for (let attempt = 1; attempt <= VERIFICATION_ATTEMPTS; attempt += 1) {
    lastStatus = await requestJsonp({ action: "status", submissionId });

    if (!lastStatus.success) {
      throw new Error(normalizeBackendError(lastStatus.message));
    }

    if (lastStatus.found) {
      return lastStatus;
    }

    if (attempt < VERIFICATION_ATTEMPTS) {
      showStatus(`Na-send na ang payment. Vine-verify pa sa Google Sheet... (${attempt}/${VERIFICATION_ATTEMPTS})`, "success");
      await delay(VERIFICATION_DELAY_MS);
    }
  }

  const sheetDetails = lastStatus && lastStatus.spreadsheetUrl
    ? ` Sheet na chineck: ${lastStatus.spreadsheetUrl}`
    : "";
  throw new Error(`Na-send ang payment pero hindi nakita ang record sa Payments sheet pagkatapos ng verification. I-paste ang latest code.gs sa Apps Script, run doGet once, at Deploy > New deployment.${sheetDetails}`);
}

function getFileExtension(fileName) {
  const normalizedName = String(fileName || "").toLowerCase();
  const dotIndex = normalizedName.lastIndexOf(".");
  return dotIndex >= 0 ? normalizedName.slice(dotIndex) : "";
}

function getAcceptedMimeType(file) {
  if (ACCEPTED_TYPES.includes(file.type)) {
    return file.type;
  }

  const extension = getFileExtension(file.name);
  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  return "";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Unable to read the uploaded file."));
    reader.readAsDataURL(file);
  });
}

function validateFile(file) {
  if (!file) {
    throw new Error("Please upload your proof of payment.");
  }

  if (!getAcceptedMimeType(file)) {
    throw new Error("Only PNG, JPG, JPEG, and PDF files are accepted.");
  }

  if (file.size <= 0) {
    throw new Error("Uploaded receipt file is empty. Please choose a valid payment proof file.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File size must not exceed 5MB.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("PASTE_YOUR")) {
      throw new Error("Please update APPS_SCRIPT_URL in script.js with your deployed Google Apps Script web app URL.");
    }

    const formData = new FormData(form);
    const proofFile = formData.get("proofFile");
    validateFile(proofFile);

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";
    await checkBackendReady();

    showStatus("Uploading payment. Please wait...", "success");

    const submissionId = generateSubmissionId();
    const payload = {
      submissionId,
      memberName: String(formData.get("memberName") || "").trim(),
      dueDate: String(formData.get("dueDate") || "").trim(),
      paymentMethod: String(formData.get("paymentMethod") || "").trim(),
      amountPaid: String(formData.get("amountPaid") || "").trim(),
      referenceNumber: String(formData.get("referenceNumber") || "").trim(),
      notes: String(formData.get("notes") || "").trim(),
      fileName: proofFile.name,
      mimeType: getAcceptedMimeType(proofFile),
      fileBase64: await fileToBase64(proofFile),
    };

    const response = await sendPaymentPayload(payload);
    const result = await parseBackendResponse(response);

    if (!result.success) {
      throw new Error(normalizeBackendError(result.message));
    }

    showStatus(`Payment sent. Checking if the row is already in Google Sheets... (client ${CLIENT_VERSION})`, "success");
    const verifiedRecord = result.assumedSuccess ? await verifySubmission(submissionId) : result;

    form.reset();

    const locationDetails = verifiedRecord.sheetName && verifiedRecord.rowNumber
      ? `tab na "${verifiedRecord.sheetName}" row ${verifiedRecord.rowNumber}`
      : "Google Sheets";
    const sheetDetails = verifiedRecord.spreadsheetUrl
      ? `Na-record sa ${locationDetails}. Sheet: ${verifiedRecord.spreadsheetUrl}`
      : `Na-record sa ${locationDetails}.`;
    const receiptDetails = verifiedRecord.receiptSaveStatus && !verifiedRecord.receiptSaveStatus.startsWith("Saved")
      ? ` Receipt file status: ${verifiedRecord.receiptSaveStatus}.`
      : "";
    showStatus(`Payment submitted and verified successfully. ${sheetDetails}${receiptDetails} Client: ${CLIENT_VERSION}.`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Payment";
  }
});
