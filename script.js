const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby9MV1EbzVjUmXTtifTmpjmIJW0s3PLN09ZTgZ1eKbhPVlSSWvBn7CYgHe-XpMwGE7Vlw/exec";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];

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

  if (message.includes("Please configure SPREADSHEET_ID")) {
    return "Hindi pa naka-configure ang Google Sheet ID sa code.gs. Ilagay ang spreadsheet ID ng Sheet na gusto mong lagyan ng data, pagkatapos mag-deploy ng bagong Apps Script web app version.";
  }

  if (message.includes("Permission denied") || message.includes("Authorization")) {
    return "Google Apps Script needs permission to write to your Google Sheet. Open the script, run doGet once, approve access, then deploy a new web app version with access set to Anyone.";
  }

  return message;
}

async function parseBackendResponse(response) {
  if (response.type === "opaque") {
    return {
      success: true,
      assumedSuccess: true,
      message: "Payment upload was sent to Google Apps Script.",
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

  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Only PNG, JPG, JPEG, and PDF files are accepted.");
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
    showStatus("Uploading payment. Please wait...", "success");

    const payload = {
      memberName: String(formData.get("memberName") || "").trim(),
      dueDate: String(formData.get("dueDate") || "").trim(),
      paymentMethod: String(formData.get("paymentMethod") || "").trim(),
      amountPaid: String(formData.get("amountPaid") || "").trim(),
      referenceNumber: String(formData.get("referenceNumber") || "").trim(),
      notes: String(formData.get("notes") || "").trim(),
      fileName: proofFile.name,
      mimeType: proofFile.type,
      fileBase64: await fileToBase64(proofFile),
    };

    const response = await sendPaymentPayload(payload);
    const result = await parseBackendResponse(response);

    if (!result.success) {
      throw new Error(normalizeBackendError(result.message));
    }

    form.reset();

    if (result.assumedSuccess) {
      showStatus("Payment sent successfully. Pakicheck ang Payments sheet kung lumabas ang bagong record; kung wala pa rin, siguraduhing updated ang SPREADSHEET_ID sa code.gs at naka-deploy ang latest Apps Script version.", "success");
      return;
    }

    const locationDetails = result.sheetName && result.rowNumber
      ? `tab na "${result.sheetName}" row ${result.rowNumber}`
      : "Google Sheets";
    const sheetDetails = result.spreadsheetUrl
      ? `Na-record sa ${locationDetails}. Sheet: ${result.spreadsheetUrl}`
      : `Na-record sa ${locationDetails}.`;
    showStatus(`Payment submitted successfully. ${sheetDetails}`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Payment";
  }
});
