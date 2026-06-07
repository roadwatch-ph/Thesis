const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzzmrLsaG7MLnbK0ZhxwxBOQ-dHURPTZTG3Ae7MAeYG5RpnW-IqFlo7nqR0NWGkaGru/exec";
const CLIENT_VERSION = "receipt-amount-match-v3";
const EXPECTED_BACKEND_VERSION = "receipt-amount-match-v3";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];
const VERIFICATION_ATTEMPTS = 8;
const VERIFICATION_DELAY_MS = 2500;
const JSONP_TIMEOUT_MS = 10000;
const FORM_POST_TIMEOUT_MS = 15000;

let dashboardData = null;
let statusHideTimer = null;

const form = document.querySelector("#paymentForm");
const statusBox = document.querySelector("#formStatus");
const submitButton = form.querySelector("button[type='submit']");
const pageTitle = document.querySelector("#pageTitle");
const pageSubtitle = document.querySelector("#pageSubtitle");
const dashboardStatus = document.querySelector("#dashboardStatus");
const weekSelect = document.querySelector("#weekSelect");
const statusTableBody = document.querySelector("#statusTableBody");
const recentPayments = document.querySelector("#recentPayments");
const upcomingDueDates = document.querySelector("#upcomingDueDates");
const memberSummaries = document.querySelector("#memberSummaries");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function safeExternalUrl(value) {
  const url = String(value || "");
  return /^https:\/\/drive\.google\.com\//.test(url) || /^https:\/\/docs\.google\.com\//.test(url) ? url : "";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) {
    return "--";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatWeekOption(week) {
  return `${week.label} (${week.weekday})`;
}

function getInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";
}

function setDashboardText(key, value) {
  document.querySelectorAll(`[data-dashboard="${key}"]`).forEach((element) => {
    element.textContent = value;
  });
}

function setRing(element, percent) {
  if (!element) {
    return;
  }

  const normalizedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
  element.style.setProperty("--percent", normalizedPercent);
  element.innerHTML = `<span>${normalizedPercent.toFixed(1)}%</span>`;
}

function setDashboardStatus(message, type = "success") {
  if (!dashboardStatus) {
    return;
  }

  dashboardStatus.textContent = message;
  dashboardStatus.className = `dashboard-status ${type === "error" ? "error" : ""}`.trim();
}

function renderWeekOptions(weeks, selectedWeekId) {
  if (!weekSelect) {
    return;
  }

  weekSelect.innerHTML = weeks.map((week) => (
    `<option value="${escapeAttribute(week.id)}" ${week.id === selectedWeekId ? "selected" : ""}>${escapeHtml(formatWeekOption(week))}</option>`
  )).join("");
}

function renderMemberRows(weekId) {
  if (!statusTableBody || !dashboardData) {
    return;
  }

  const selectedWeek = dashboardData.weeks.find((week) => week.id === weekId) || dashboardData.currentWeek;
  const rows = dashboardData.members.map((member) => {
    const weekPayment = member.weekPayments[selectedWeek.id] || { amount: 0, receiptUrl: "" };
    const status = weekPayment.amount >= dashboardData.weeklyAmount
      ? "paid"
      : (selectedWeek.isPastDue ? "missing" : "pending");
    const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
    const receiptUrl = safeExternalUrl(weekPayment.receiptUrl);
    const receiptMarkup = receiptUrl
      ? `<a class="receipt-link" href="${escapeAttribute(receiptUrl)}" target="_blank" rel="noopener">View</a>`
      : "—";

    return `<tr>
      <td><span class="member-cell"><span class="avatar">${escapeHtml(getInitials(member.name))}</span>${escapeHtml(member.name)}</span></td>
      <td><span class="status-pill ${status}">● ${statusLabel}</span></td>
      <td>${receiptMarkup}</td>
      <td>${formatCurrency(member.totalPaid)}</td>
      <td>${member.paidWeeks} / ${dashboardData.totalWeeks}</td>
      <td>${formatCurrency(member.balance)}</td>
      <td><button class="details-button" type="button" title="${escapeAttribute(member.name)} details">›</button></td>
    </tr>`;
  });

  statusTableBody.innerHTML = rows.join("");
}


function getMemberProgressPercent(member, totalWeeks, weeklyAmount) {
  const expectedContribution = (Number(totalWeeks) || 0) * (Number(weeklyAmount) || 0);
  if (expectedContribution <= 0) {
    return 0;
  }

  return ((Number(member.totalPaid) || 0) / expectedContribution) * 100;
}

function getMemberNextDueDate(member, weeks, weeklyAmount, fallbackNextDueDate) {
  const requiredAmount = Number(weeklyAmount) || 0;
  if (requiredAmount <= 0) {
    return "";
  }

  const unpaidWeek = (weeks || []).find((week) => {
    const weekPayment = member.weekPayments && member.weekPayments[week.id];
    return !weekPayment || (Number(weekPayment.amount) || 0) < requiredAmount;
  });

  if (unpaidWeek) {
    return unpaidWeek.id;
  }

  return member.balance > 0 ? fallbackNextDueDate : "";
}

function renderMemberSummaries(members, totalWeeks, weeklyAmount, weeks, fallbackNextDueDate) {
  if (!memberSummaries) {
    return;
  }

  if (!members.length) {
    memberSummaries.textContent = "No members configured yet.";
    return;
  }

  memberSummaries.innerHTML = members.map((member) => {
    const progressPercent = getMemberProgressPercent(member, totalWeeks, weeklyAmount);
    const normalizedPercent = Math.max(0, Math.min(100, progressPercent));
    const lastPayment = member.lastPaymentDate ? formatDate(member.lastPaymentDate) : "No payment yet";
    const memberNextDueDate = getMemberNextDueDate(member, weeks, weeklyAmount, fallbackNextDueDate);
    const nextPayment = memberNextDueDate ? formatDate(memberNextDueDate) : "Completed";

    return `<article class="member-summary-card">
      <div class="member-summary-person">
        <span class="avatar">${escapeHtml(getInitials(member.name))}</span>
        <div>
          <strong>${escapeHtml(member.name)}</strong>
          <small>${member.paidWeeks} of ${totalWeeks} weeks paid</small>
        </div>
      </div>
      <div class="member-summary-content">
        <div class="member-summary-metrics">
          <div class="member-summary-stat total-paid"><small>Total Contribution</small><strong>${formatCurrency(member.totalPaid)}</strong></div>
          <div class="member-summary-stat"><small>Paid Weeks</small><strong>${member.paidWeeks} / ${totalWeeks}</strong></div>
          <div class="member-summary-stat balance"><small>Remaining Balance</small><strong>${formatCurrency(member.balance)}</strong></div>
        </div>
        <div class="member-summary-progress">
          <div class="progress-row"><span>Progress to Goal</span><strong>${normalizedPercent.toFixed(1)}%</strong></div>
          <div class="progress-track"><span style="width: ${normalizedPercent}%"></span></div>
        </div>
        <div class="member-summary-dates">
          <span><small>Last Payment</small><strong>${escapeHtml(lastPayment)}</strong></span>
          <span><small>Next Due Date</small><strong>${escapeHtml(nextPayment)}</strong></span>
          <span><small>Amount per Week</small><strong>${formatCurrency(weeklyAmount)}</strong></span>
        </div>
      </div>
    </article>`;
  }).join("");
}

function renderRecentPayments(payments) {
  if (!recentPayments) {
    return;
  }

  if (!payments.length) {
    recentPayments.textContent = "No payments recorded in Google Sheets yet.";
    return;
  }

  recentPayments.innerHTML = payments.map((payment) => `<div class="recent-item">
    <div><strong>${escapeHtml(formatDate(payment.dueDate))}</strong><small>${escapeHtml(payment.memberName)}<br>${escapeHtml(payment.referenceNumber || "No reference")}</small></div>
    <div class="recent-amount">${formatCurrency(payment.amountPaid)}<span>Paid</span></div>
  </div>`).join("");
}

function renderDueDates(dueDates) {
  if (!upcomingDueDates) {
    return;
  }

  upcomingDueDates.innerHTML = dueDates.map((week) => `<div class="due-item">
    <div><strong>${escapeHtml(week.label)} (${escapeHtml(week.weekday)})</strong><small>Week ${escapeHtml(week.weekNumber)}</small></div>
    <div class="due-amount">${formatCurrency(week.amount)}</div>
  </div>`).join("");
}

function renderPaymentFormWeeks(weeks) {
  const dueDateSelect = document.querySelector("#dueDate");
  if (!dueDateSelect) {
    return;
  }

  dueDateSelect.innerHTML = weeks.map((week) => (
    `<option value="${escapeAttribute(week.id)}">${escapeHtml(week.label)} (${escapeHtml(week.weekday)})</option>`
  )).join("");
}

function renderDashboard(data) {
  dashboardData = data;
  const percentCollected = Number(data.collectionPercent) || 0;
  const selectedWeek = data.currentWeek || data.weeks[0];
  const paidPercent = data.totalMembers ? ((data.paidThisWeek / data.totalMembers) * 100).toFixed(0) : "0";
  const pendingPercent = data.totalMembers ? ((data.pendingThisWeek / data.totalMembers) * 100).toFixed(0) : "0";

  setDashboardText("totalMembers", data.totalMembers);
  setDashboardText("paidThisWeek", data.paidThisWeek);
  setDashboardText("pendingThisWeek", data.pendingThisWeek);
  setDashboardText("paidPercent", `${paidPercent}% of members`);
  setDashboardText("pendingPercent", `${pendingPercent}% of members`);
  setDashboardText("collectedAmount", formatCurrency(data.totalCollected));
  setDashboardText("collectionTarget", `of ${formatCurrency(data.expectedTotal)}`);
  setDashboardText("collectionPercent", `${percentCollected.toFixed(1)}%`);
  setDashboardText("donutPercent", `${percentCollected.toFixed(1)}%`);
  setDashboardText("expectedTotal", formatCurrency(data.expectedTotal));
  setDashboardText("collectedLine", formatCurrency(data.totalCollected));
  setDashboardText("remainingLine", formatCurrency(data.remainingTotal));
  setDashboardText("legendCollected", formatCurrency(data.totalCollected));
  setDashboardText("legendRemaining", formatCurrency(data.remainingTotal));
  setDashboardText("weeklyAmount", formatCurrency(data.weeklyAmount));

  document.querySelectorAll("[data-weekly-amount]").forEach((element) => { element.textContent = formatCurrency(data.weeklyAmount); });
  document.querySelectorAll("[data-total-weeks]").forEach((element) => { element.textContent = data.totalWeeks; });
  const amountInput = document.querySelector("#amountPaid");
  const receiptAmountInput = document.querySelector("#receiptAmount");
  if (amountInput) {
    amountInput.value = data.weeklyAmount;
    amountInput.defaultValue = data.weeklyAmount;
  }
  if (receiptAmountInput) {
    receiptAmountInput.value = data.weeklyAmount;
    receiptAmountInput.defaultValue = data.weeklyAmount;
  }

  setRing(document.querySelector(".mini-ring"), percentCollected);
  setRing(document.querySelector(".donut"), percentCollected);
  renderWeekOptions(data.weeks, selectedWeek.id);
  renderMemberRows(selectedWeek.id);
  renderPaymentFormWeeks(data.weeks || []);
  renderRecentPayments(data.recentPayments || []);
  renderDueDates(data.upcomingDueDates || []);

  renderMemberSummaries(data.members || [], data.totalWeeks, data.weeklyAmount, data.weeks || [], data.nextDueDate);

  setDashboardStatus(`Live data loaded from ${data.sheetName} in Google Sheets. Receipts open from Google Drive when available.`, "success");
}

async function loadDashboard() {
  try {
    setDashboardStatus("Loading live dashboard data from Google Sheets and Google Drive...", "success");
    const data = await requestJsonp({ action: "dashboard" });
    if (!data.success) {
      throw new Error(normalizeBackendError(data.message));
    }
    if (data.backendVersion !== EXPECTED_BACKEND_VERSION) {
      throw new Error(`Hindi pa latest ang deployed Google Apps Script. Expected backend ${EXPECTED_BACKEND_VERSION}, pero nakuha: ${data.backendVersion || "old/unknown"}.`);
    }
    renderDashboard(data);
  } catch (error) {
    setDashboardStatus(error.message, "error");
  }
}

function activatePage(pageId) {
  document.querySelectorAll(".page-section").forEach((section) => {
    section.classList.toggle("active", section.id === pageId);
  });

  document.querySelectorAll("[data-page-link]").forEach((link) => {
    const isActive = link.dataset.pageLink === pageId;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const activeSection = document.getElementById(pageId);
  if (activeSection) {
    pageTitle.textContent = activeSection.dataset.pageTitle || "Payment Tracker";
    pageSubtitle.textContent = activeSection.dataset.pageSubtitle || "";
  }
}

function initializeNavigation() {
  document.querySelectorAll("[data-page-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const pageId = link.dataset.pageLink;
      window.history.replaceState(null, "", `#${pageId}`);
      activatePage(pageId);
      if (pageId === "dashboard" && !dashboardData) {
        loadDashboard();
      }
    });
  });

  const initialPage = window.location.hash.replace("#", "") === "upload-payment" ? "upload-payment" : "dashboard";
  activatePage(initialPage);
}

function clearStatus() {
  if (!statusBox) {
    return;
  }

  statusBox.textContent = "";
  statusBox.className = "form-status";
}

function showStatus(message, type, autoHideMs = 0) {
  if (!statusBox) {
    return;
  }

  if (statusHideTimer) {
    window.clearTimeout(statusHideTimer);
    statusHideTimer = null;
  }

  statusBox.textContent = message;
  statusBox.className = `form-status ${type}`;

  if (autoHideMs > 0) {
    statusHideTimer = window.setTimeout(() => {
      clearStatus();
      statusHideTimer = null;
    }, autoHideMs);
  }
}

function normalizeBackendError(message) {
  if (!message) {
    return "Google Apps Script rejected the payment upload.";
  }

  if (message.includes("Unable to open the configured Google Sheet")) {
    return "Hindi ma-open ang Google Sheet na naka-force sa SPREADSHEET_ID. Iwanang blank ang SPREADSHEET_ID sa code.gs para Web App URL lang ang kailangan ng frontend at automatic ang storage Sheet, o siguraduhing tama ang Sheet ID at may edit access ang script owner.";
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

function submitPaymentPayloadViaIframe(payload) {
  return new Promise((resolve, reject) => {
    const frameName = `paymentTrackerPost_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const iframe = document.createElement("iframe");
    const postForm = document.createElement("form");
    const payloadInput = document.createElement("input");
    let settled = false;
    let timeoutId;

    function cleanup() {
      window.clearTimeout(timeoutId);
      postForm.remove();
      iframe.remove();
    }

    function isGoogleResponseLoad() {
      try {
        return iframe.contentWindow.location.href !== "about:blank";
      } catch (error) {
        return true;
      }
    }

    function finish() {
      if (settled || !isGoogleResponseLoad()) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        success: true,
        assumedSuccess: true,
        message: `Payment upload was sent to Google Apps Script. Client version: ${CLIENT_VERSION}.`,
      });
    }

    iframe.name = frameName;
    iframe.hidden = true;
    iframe.title = "Payment upload target";
    iframe.addEventListener("load", finish);

    payloadInput.type = "hidden";
    payloadInput.name = "payload";
    payloadInput.value = JSON.stringify(payload);

    postForm.hidden = true;
    postForm.method = "POST";
    postForm.action = APPS_SCRIPT_URL;
    postForm.target = frameName;
    postForm.enctype = "application/x-www-form-urlencoded";
    postForm.acceptCharset = "UTF-8";
    postForm.append(payloadInput);

    timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(new Error("Hindi natapos ang pagpapadala sa Google Apps Script. I-check ang deployed web app URL at access setting na Anyone."));
    }, FORM_POST_TIMEOUT_MS);

    document.body.append(iframe, postForm);
    postForm.submit();
  });
}

async function sendPaymentPayload(payload) {
  return submitPaymentPayloadViaIframe(payload);
}

function validateBackendVersion(backendStatus) {
  if (!backendStatus.success) {
    throw new Error(normalizeBackendError(backendStatus.message));
  }

  if (backendStatus.backendVersion !== EXPECTED_BACKEND_VERSION) {
    throw new Error(`Hindi pa latest ang deployed Google Apps Script. Expected backend ${EXPECTED_BACKEND_VERSION}, pero nakuha: ${backendStatus.backendVersion || "old/unknown"}. I-paste ang latest code.gs, run doGet once, then Deploy > New deployment bago mag-submit ulit.`);
  }

  if (Number(backendStatus.headerCount) !== 14) {
    throw new Error(`Mali ang Payments sheet headers. Expected 14 columns, pero ${backendStatus.headerCount || "unknown"} ang nakita. Run doGet sa latest Apps Script para maayos ang headers, then deploy again.`);
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

function sanitizeReceiptNamePart(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function buildReceiptFileName(memberName, dueDate, file) {
  const extension = getAcceptedReceiptExtension(file);
  return `${sanitizeReceiptNamePart(memberName)}_${sanitizeReceiptNamePart(dueDate)}${extension}`;
}

function getAcceptedReceiptExtension(file) {
  const extension = getFileExtension(file && file.name);

  if ([".png", ".jpg", ".jpeg", ".pdf"].includes(extension)) {
    return extension;
  }

  return getFileExtensionForMimeType(getAcceptedMimeType(file));
}

function getFileExtensionForMimeType(mimeType) {
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      const base64Data = commaIndex >= 0 ? result.slice(commaIndex + 1) : "";

      if (!base64Data) {
        reject(new Error("Unable to read receipt data. Please choose the file again."));
        return;
      }

      resolve(base64Data);
    };
    reader.onerror = () => reject(new Error("Unable to read the uploaded file."));
    reader.readAsDataURL(file);
  });
}

function isValidMoneyAmount(value) {
  return /^\d+(\.\d{1,2})?$/.test(String(value || ""));
}

function toCentavos(value) {
  return Math.round((Number(value) || 0) * 100);
}

function validatePaymentFields(payload) {
  const requiredFields = [
    ["memberName", "Please select a member."],
    ["dueDate", "Please select a due date."],
    ["paymentMethod", "Please select a payment method."],
    ["amountPaid", "Please enter the amount paid."],
    ["receiptAmount", "Please enter the amount shown on the receipt."],
    ["referenceNumber", "Please enter the payment reference number."],
  ];

  requiredFields.forEach(([field, message]) => {
    if (!payload[field]) {
      throw new Error(message);
    }
  });

  if (!isValidMoneyAmount(payload.amountPaid)) {
    throw new Error("Amount paid must be a valid number with up to 2 decimal places.");
  }

  if (!isValidMoneyAmount(payload.receiptAmount)) {
    throw new Error("Receipt amount must be a valid number with up to 2 decimal places.");
  }

  const amount = Number(payload.amountPaid);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount paid must be greater than zero.");
  }

  if (toCentavos(payload.amountPaid) !== toCentavos(payload.receiptAmount)) {
    throw new Error("Hindi tugma ang Amount Paid at ang amount na nakalagay sa uploaded receipt. Pakisuri ang receipt bago mag-submit.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)) {
    throw new Error("Due date must use YYYY-MM-DD format.");
  }
}

function validateFile(file) {
  if (!file || !(file instanceof File)) {
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

initializeNavigation();
loadDashboard();

if (weekSelect) {
  weekSelect.addEventListener("change", () => renderMemberRows(weekSelect.value));
}

document.querySelectorAll("[data-refresh-dashboard]").forEach((button) => {
  button.addEventListener("click", loadDashboard);
});

form.addEventListener("reset", () => {
  window.setTimeout(() => {
    if (dashboardData) {
      renderPaymentFormWeeks(dashboardData.weeks || []);
      const amountInput = document.querySelector("#amountPaid");
      const receiptAmountInput = document.querySelector("#receiptAmount");
      if (amountInput) {
        amountInput.value = dashboardData.weeklyAmount;
      }
      if (receiptAmountInput) {
        receiptAmountInput.value = dashboardData.weeklyAmount;
      }
    }
  }, 0);
});

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
      receiptAmount: String(formData.get("receiptAmount") || "").trim(),
      referenceNumber: String(formData.get("referenceNumber") || "").trim(),
      notes: String(formData.get("notes") || "").trim(),
      fileName: proofFile.name,
      receiptFileName: buildReceiptFileName(String(formData.get("memberName") || "").trim(), String(formData.get("dueDate") || "").trim(), proofFile),
      mimeType: getAcceptedMimeType(proofFile),
      fileBase64: "",
    };
    validatePaymentFields(payload);
    payload.fileBase64 = await fileToBase64(proofFile);

    const result = await sendPaymentPayload(payload);

    if (!result.success) {
      throw new Error(normalizeBackendError(result.message));
    }

    showStatus(`Payment sent. Checking if the row is already in Google Sheets... (client ${CLIENT_VERSION})`, "success");
    if (result.assumedSuccess) {
      await verifySubmission(submissionId);
    }

    form.reset();
    showStatus("Payment submitted and verified successfully", "success", 2000);
    loadDashboard();
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Payment";
  }
});
