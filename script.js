const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzETLvdCJVSvocbI0_yeTA3tA6k7wlgWhn61RHOd3mh2R97ZQE9Yj29nJ4V0OlyL3nE/exec";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];

const form = document.querySelector("#paymentForm");
const statusBox = document.querySelector("#formStatus");
const submitButton = form.querySelector("button[type='submit']");

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = `form-status ${type}`;
}

function showSuccessStatus(result) {
  statusBox.className = "form-status success";
  statusBox.replaceChildren();

  const message = document.createElement("span");
  message.textContent = "Payment submitted successfully and recorded in Google Sheets.";
  statusBox.append(message);

  if (result.spreadsheetUrl) {
    statusBox.append(" ");

    const link = document.createElement("a");
    link.href = result.spreadsheetUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open recorded sheet";
    statusBox.append(link);
  }

  if (result.sheetName) {
    statusBox.append(` (${result.sheetName})`);
  }
}

function normalizeBackendError(message) {
  if (!message) {
    return "Google Apps Script rejected the payment upload.";
  }

  if (message === "Please configure SPREADSHEET_ID in code.gs.") {
    return "The deployed Google Apps Script is outdated. Replace the deployed script with the latest code.gs, then deploy a new web app version; this version automatically creates the spreadsheet when SPREADSHEET_ID is blank.";
  }

  if (message.includes("Permission denied") || message.includes("Authorization")) {
    return "Google Apps Script needs permission to write to your Google Sheet. Open the script, run doGet once, approve access, then deploy a new web app version with access set to Anyone.";
  }

  return message;
}

async function parseBackendResponse(response) {
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
      memberName: formData.get("memberName"),
      dueDate: formData.get("dueDate"),
      paymentMethod: formData.get("paymentMethod"),
      amountPaid: formData.get("amountPaid"),
      referenceNumber: formData.get("referenceNumber"),
      notes: formData.get("notes"),
      fileName: proofFile.name,
      mimeType: proofFile.type,
      fileBase64: await fileToBase64(proofFile),
    };

    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    const result = await parseBackendResponse(response);

    if (!result.success) {
      throw new Error(normalizeBackendError(result.message));
    }

    form.reset();
    showSuccessStatus(result);
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Payment";
  }
});
