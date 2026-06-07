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
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message || "Google Apps Script rejected the payment upload.");
    }

    form.reset();
    showStatus("Payment submitted successfully and recorded in Google Sheets.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Payment";
  }
});
