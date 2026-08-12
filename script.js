const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzRFkAugHtoq184VWW2ZSk8Ie_mIYi-9yAU-yt0oB4yd5nbs44vLdvxRPBMPqO7TJVq/exec";
const CLIENT_VERSION = "offline-resilient-dashboard-v1";
const LATEST_BACKEND_VERSION = "cumulative-contribution-target-v1";
const COMPATIBLE_BACKEND_VERSIONS = new Set([
  "payment-tracker-stable-v1",
  "contribution-settings-v2",
  "contribution-email-reminders-v1",
  LATEST_BACKEND_VERSION,
]);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/pdf"];
const VERIFICATION_ATTEMPTS = 8;
const VERIFICATION_DELAY_MS = 2500;
const JSONP_TIMEOUT_MS = 10000;
const FORM_POST_TIMEOUT_MS = 15000;
const OCR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const RECEIPT_AMOUNT_TOLERANCE = 0.01;

const FALLBACK_MEMBERS = [
  "Jhon Lenard Dimaano",
  "Prince Johnel Abe",
  "Michael Orilla",
  "Carmela Elaine Agrao",
  "Darlene Grace Villanueva",
];
const FALLBACK_WEEKLY_AMOUNT = 50;
const FALLBACK_TOTAL_WEEKS = 30;
const FALLBACK_FIRST_DUE_DATE = "2026-06-07";

let dashboardData = null;
let statusHideTimer = null;
let receiptPreviewUrl = "";
let receiptScanState = {
  status: "idle",
  detectedAmounts: [],
  detectedReferences: [],
  matchedAmount: null,
  fileName: "",
};
let receiptScanSequence = 0;
let tesseractScriptPromise = null;
let autoFilledReferenceNumber = "";

const form = document.querySelector("#paymentForm");
const statusBox = document.querySelector("#formStatus");
const submitButton = form ? form.querySelector("button[type='submit']") : null;
const pageTitle = document.querySelector("#pageTitle");
const pageSubtitle = document.querySelector("#pageSubtitle");
const dashboardStatus = document.querySelector("#dashboardStatus");
const weekSelect = document.querySelector("#weekSelect");
const statusTableBody = document.querySelector("#statusTableBody");
const recentPayments = document.querySelector("#recentPayments");
const upcomingDueDates = document.querySelector("#upcomingDueDates");
const memberSummaries = document.querySelector("#memberSummaries");
const proofFileInput = document.querySelector("#proofFile");
const amountPaidInput = document.querySelector("#amountPaid");
const referenceNumberInput = document.querySelector("#referenceNumber");
const receiptPreview = document.querySelector("#receiptPreview");
const receiptFileMeta = document.querySelector("#receiptFileMeta");
const receiptScanBadge = document.querySelector("#receiptScanBadge");
const receiptScanMessage = document.querySelector("#receiptScanMessage");
const scanFieldAmount = document.querySelector("#scanFieldAmount");
const scanDetectedAmounts = document.querySelector("#scanDetectedAmounts");
const scanDetectedReferences = document.querySelector("#scanDetectedReferences");

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

function parseAmountValue(value) {
  const normalizedValue = String(value || "").replace(/,/g, "").trim();
  const amount = Number(normalizedValue);
  return Number.isFinite(amount) ? amount : null;
}

function setReceiptScanState(nextState) {
  receiptScanState = { ...receiptScanState, ...nextState };
  renderReceiptScanState();
}

function updateScanBadge(label, status) {
  if (!receiptScanBadge) {
    return;
  }

  receiptScanBadge.textContent = label;
  receiptScanBadge.className = `scan-badge ${status}`;
}

function renderReceiptScanState() {
  const fieldAmount = parseAmountValue(amountPaidInput && amountPaidInput.value);

  if (scanFieldAmount) {
    scanFieldAmount.textContent = fieldAmount === null ? "--" : formatCurrency(fieldAmount);
  }

  if (scanDetectedAmounts) {
    scanDetectedAmounts.textContent = receiptScanState.detectedAmounts.length
      ? receiptScanState.detectedAmounts.map(formatCurrency).join(", ")
      : "--";
  }

  if (scanDetectedReferences) {
    scanDetectedReferences.textContent = receiptScanState.detectedReferences.length
      ? receiptScanState.detectedReferences.join(", ")
      : "--";
  }

  if (!receiptScanMessage) {
    return;
  }

  if (!receiptScanState.fileName) {
    updateScanBadge("Waiting", "idle");
    receiptScanMessage.textContent = "Kapag image receipt ang in-upload, ise-scan ng system ang amount at reference number bago ito ipadala.";
    return;
  }

  if (receiptScanState.status === "scanning") {
    updateScanBadge("Scanning", "scanning");
    receiptScanMessage.textContent = "Ini-scan ang receipt image. Huwag munang i-submit habang kinukuha ang amount at reference number.";
    return;
  }

  if (receiptScanState.status === "match") {
    updateScanBadge("Matched", "match");
    const referenceMessage = receiptScanState.detectedReferences.length
      ? ` Auto-filled reference: <strong>${escapeHtml(receiptScanState.detectedReferences[0])}</strong>.`
      : " Walang reference number na nabasa; pakilagay ito manually.";
    receiptScanMessage.innerHTML = `Match ang Amount Paid at receipt amount: <strong>${formatCurrency(receiptScanState.matchedAmount)}</strong>.${referenceMessage}`;
    return;
  }

  if (receiptScanState.status === "mismatch") {
    updateScanBadge("Mismatch", "mismatch");
    receiptScanMessage.textContent = "Hindi tugma ang Amount Paid field sa na-detect na amount sa receipt. Pakitama muna bago i-submit.";
    return;
  }

  if (receiptScanState.status === "warning") {
    updateScanBadge("Preview Only", "warning");
    receiptScanMessage.textContent = "PDF preview lang ang available sa browser. Para sa auto amount/reference check, mag-upload ng PNG/JPG/JPEG receipt.";
    return;
  }

  if (receiptScanState.status === "error") {
    updateScanBadge("Needs Review", "error");
    receiptScanMessage.textContent = "Hindi mabasa ang amount/reference sa receipt. Mag-upload ng mas malinaw na image bago i-submit.";
    return;
  }

  updateScanBadge("Waiting", "idle");
  receiptScanMessage.textContent = "Kapag image receipt ang in-upload, ise-scan ng system ang amount at reference number bago ito ipadala.";
}

function clearReceiptPreview() {
  if (receiptPreviewUrl) {
    URL.revokeObjectURL(receiptPreviewUrl);
    receiptPreviewUrl = "";
  }

  if (receiptPreview) {
    receiptPreview.className = "receipt-preview empty";
    receiptPreview.textContent = "No receipt selected yet.";
  }

  if (receiptFileMeta) {
    receiptFileMeta.textContent = "Upload a receipt to preview it here.";
  }

  if (referenceNumberInput && autoFilledReferenceNumber && referenceNumberInput.value.trim() === autoFilledReferenceNumber) {
    referenceNumberInput.value = "";
    autoFilledReferenceNumber = "";
  }

  setReceiptScanState({ status: "idle", detectedAmounts: [], detectedReferences: [], matchedAmount: null, fileName: "" });
}

function renderReceiptPreview(file) {
  if (!receiptPreview || !receiptFileMeta) {
    return;
  }

  if (receiptPreviewUrl) {
    URL.revokeObjectURL(receiptPreviewUrl);
  }

  receiptPreviewUrl = URL.createObjectURL(file);
  receiptFileMeta.textContent = `${file.name} • ${(file.size / 1024 / 1024).toFixed(2)}MB`;
  receiptPreview.className = "receipt-preview";
  receiptPreview.replaceChildren();

  if (getAcceptedMimeType(file) === "application/pdf") {
    const preview = document.createElement("embed");
    preview.src = receiptPreviewUrl;
    preview.type = "application/pdf";
    receiptPreview.append(preview);
    return;
  }

  const image = document.createElement("img");
  image.src = receiptPreviewUrl;
  image.alt = "Uploaded payment receipt preview";
  receiptPreview.append(image);
}

function loadTesseractScript() {
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }

  if (!tesseractScriptPromise) {
    tesseractScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = OCR_SCRIPT_URL;
      script.async = true;
      script.onload = () => resolve(window.Tesseract);
      script.onerror = () => reject(new Error("Hindi ma-load ang receipt scanner. Check internet connection at subukan ulit."));
      document.head.append(script);
    });
  }

  return tesseractScriptPromise;
}

function extractReceiptAmounts(text) {
  const normalizedText = String(text || "").replace(/O/g, "0");
  const amountPattern = /(?:₱|php|p\s*)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.(\d{1,2}))?/gi;
  const amounts = [];
  let match = amountPattern.exec(normalizedText);

  while (match) {
    const wholeNumber = String(match[1] || "").replace(/,/g, "");
    const decimalPart = match[2] ? `.${match[2]}` : "";
    const amount = Number(`${wholeNumber}${decimalPart}`);

    if (Number.isFinite(amount) && amount > 0 && amount < 1000000) {
      amounts.push(Math.round(amount * 100) / 100);
    }

    match = amountPattern.exec(normalizedText);
  }

  return [...new Set(amounts)].sort((a, b) => b - a);
}

function normalizeReceiptReference(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function isLikelyReceiptReference(value) {
  const reference = normalizeReceiptReference(value);

  if (reference.length < 6 || reference.length > 35) {
    return false;
  }

  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(reference) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(reference)) {
    return false;
  }

  if (/^\d{1,2}:?\d{2}(:?\d{2})?$/.test(reference)) {
    return false;
  }

  return /\d/.test(reference);
}

function extractReceiptReferences(text) {
  const normalizedText = String(text || "")
    .replace(/[：]/g, ":")
    .replace(/[|]/g, "I");
  const references = [];
  const addReference = (value) => {
    const reference = normalizeReceiptReference(value);

    if (isLikelyReceiptReference(reference) && !references.includes(reference)) {
      references.push(reference);
    }
  };

  normalizedText.split(/\r?\n/).forEach((line) => {
    const labelMatch = line.match(/(?:gcash|maya|bank|instapay|pesonet|bpi|bdo|metrobank|unionbank)?\s*(?:reference|ref(?:erence)?|transaction|txn|trace|confirmation|control)\s*(?:no\.?|num(?:ber)?|#|id|code)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{5,35})/i);

    if (labelMatch) {
      addReference(labelMatch[1]);
    }
  });

  const inlinePattern = /(?:reference|ref(?:erence)?|transaction|txn|trace|confirmation|control)\s*(?:no\.?|num(?:ber)?|#|id|code)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{5,35})/gi;
  let match = inlinePattern.exec(normalizedText);

  while (match) {
    addReference(match[1]);
    match = inlinePattern.exec(normalizedText);
  }

  if (!references.length) {
    const numericReferences = normalizedText.match(/\b\d{10,18}\b/g) || [];
    numericReferences.forEach(addReference);
  }

  return references.slice(0, 3);
}

function autofillReferenceNumber(detectedReferences) {
  if (!referenceNumberInput) {
    return;
  }

  const currentValue = referenceNumberInput.value.trim();
  const nextReference = detectedReferences[0] || "";

  if (!nextReference) {
    if (autoFilledReferenceNumber && currentValue === autoFilledReferenceNumber) {
      referenceNumberInput.value = "";
      autoFilledReferenceNumber = "";
    }

    return;
  }

  if (!currentValue || currentValue === autoFilledReferenceNumber) {
    referenceNumberInput.value = nextReference;
    autoFilledReferenceNumber = nextReference;
  }
}

function compareReceiptAmount(detectedAmounts) {
  const fieldAmount = parseAmountValue(amountPaidInput && amountPaidInput.value);

  if (fieldAmount === null || detectedAmounts.length === 0) {
    return null;
  }

  return detectedAmounts.find((amount) => Math.abs(amount - fieldAmount) <= RECEIPT_AMOUNT_TOLERANCE) ?? null;
}

async function scanReceiptAmount(file) {
  const sequence = receiptScanSequence;

  try {
    setReceiptScanState({ status: "scanning", detectedAmounts: [], detectedReferences: [], matchedAmount: null, fileName: file.name });
    const Tesseract = await loadTesseractScript();
    const result = await Tesseract.recognize(file, "eng");

    if (sequence !== receiptScanSequence) {
      return;
    }

    const receiptText = result && result.data && result.data.text;
    const detectedAmounts = extractReceiptAmounts(receiptText);
    const detectedReferences = extractReceiptReferences(receiptText);
    const matchedAmount = compareReceiptAmount(detectedAmounts);
    autofillReferenceNumber(detectedReferences);
    setReceiptScanState({
      status: matchedAmount === null ? "mismatch" : "match",
      detectedAmounts,
      detectedReferences,
      matchedAmount,
      fileName: file.name,
    });
  } catch (error) {
    if (sequence === receiptScanSequence) {
      setReceiptScanState({ status: "error", detectedAmounts: [], detectedReferences: [], matchedAmount: null, fileName: file.name });
    }
  }
}

function refreshReceiptAmountComparison() {
  if (!receiptScanState.fileName || receiptScanState.status === "scanning" || receiptScanState.status === "warning") {
    renderReceiptScanState();
    return;
  }

  const matchedAmount = compareReceiptAmount(receiptScanState.detectedAmounts);
  setReceiptScanState({
    status: matchedAmount === null ? "mismatch" : "match",
    matchedAmount,
  });
}

function ensureReceiptAmountVerified(file) {
  if (!file || !(file instanceof File)) {
    return;
  }

  if (getAcceptedMimeType(file) === "application/pdf") {
    return;
  }

  if (receiptScanState.status === "scanning") {
    throw new Error("Ini-scan pa ang receipt amount. Hintayin munang matapos ang auto-scan bago i-submit.");
  }

  const detectedAnyAmount = receiptScanState.detectedAmounts.length > 0;
  if (receiptScanState.status === "mismatch" && detectedAnyAmount) {
    throw new Error("Hindi tugma ang Amount Paid field sa na-detect na amount sa receipt. Pakitama muna bago i-submit.");
  }
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function buildFallbackWeeks() {
  const firstDueDate = new Date(`${FALLBACK_FIRST_DUE_DATE}T00:00:00`);

  return Array.from({ length: FALLBACK_TOTAL_WEEKS }, (_, index) => {
    const dueDate = new Date(firstDueDate);
    dueDate.setDate(firstDueDate.getDate() + (index * 7));
    const id = formatDateInput(dueDate);

    return {
      id,
      label: formatDate(id),
      weekday: dueDate.toLocaleDateString("en-US", { weekday: "long" }),
      weekNumber: index + 1,
      amount: FALLBACK_WEEKLY_AMOUNT,
      cumulativeTarget: (index + 1) * FALLBACK_WEEKLY_AMOUNT,
      isPastDue: dueDate < new Date(new Date().toDateString()),
    };
  });
}

function buildFallbackDashboardData() {
  const weeks = buildFallbackWeeks();
  const currentWeek = weeks.find((week) => !week.isPastDue) || weeks[weeks.length - 1];
  const members = FALLBACK_MEMBERS.map((name) => ({
    name,
    weekPayments: {},
    totalPaid: 0,
    paidWeeks: 0,
    balance: FALLBACK_WEEKLY_AMOUNT * FALLBACK_TOTAL_WEEKS,
  }));

  return normalizeDashboardPayload({
    success: true,
    backendVersion: "offline-fallback",
    sheetName: "offline fallback schedule",
    weeklyAmount: FALLBACK_WEEKLY_AMOUNT,
    totalWeeks: FALLBACK_TOTAL_WEEKS,
    weeks,
    currentWeek,
    members,
    upcomingDueDates: weeks.filter((week) => !week.isPastDue).slice(0, 5),
    recentPayments: [],
  });
}

function renderFallbackDashboard(error) {
  const fallbackData = buildFallbackDashboardData();
  renderDashboard(fallbackData);
  setDashboardStatus(`Live Google Sheets data is unavailable, so the site opened with the saved contribution schedule. Uploads may still work once the Apps Script backend is reachable. Details: ${error.message}`, "warning");
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
  dashboardStatus.className = `dashboard-status ${type}`;
}

function getBackendVersionWarning(backendVersion) {
  if (!backendVersion) {
    return "Backend version is missing. Dashboard data loaded after field validation, but deploy the latest code.gs when possible.";
  }

  if (!isCompatibleBackendVersion(backendVersion)) {
    return `Backend version ${backendVersion} is not in the known-compatible list. Dashboard data loaded after field validation, but deploy the latest code.gs to keep both sides aligned.`;
  }

  return "";
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
    const requiredTarget = getWeekCumulativeTarget(selectedWeek, dashboardData.weeklyAmount);
    const status = (Number(member.totalPaid) || 0) >= requiredTarget
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

function getWeekCumulativeTarget(week, weeklyAmount) {
  const configuredTarget = Number(week && week.cumulativeTarget);
  if (Number.isFinite(configuredTarget) && configuredTarget > 0) {
    return configuredTarget;
  }

  return (Number(week && week.weekNumber) || 0) * (Number(weeklyAmount) || 0);
}

function getMemberNextDueDate(member, weeks, weeklyAmount, fallbackNextDueDate) {
  const requiredAmount = Number(weeklyAmount) || 0;
  if (requiredAmount <= 0) {
    return "";
  }

  const unpaidWeek = (weeks || []).find((week) => (Number(member.totalPaid) || 0) < getWeekCumulativeTarget(week, weeklyAmount));

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

  if (!dueDates.length) {
    upcomingDueDates.textContent = "No upcoming due dates configured.";
    return;
  }

  upcomingDueDates.innerHTML = dueDates.map((week) => `<div class="due-item">
    <div><strong>${escapeHtml(week.label)} (${escapeHtml(week.weekday)})</strong><small>Week ${escapeHtml(week.weekNumber)}</small></div>
    <div class="due-amount">${formatCurrency(getWeekCumulativeTarget(week, dashboardData && dashboardData.weeklyAmount))}</div>
  </div>`).join("");
}

function renderPaymentFormWeeks(weeks) {
  const dueDateSelect = document.querySelector("#dueDate");
  if (!dueDateSelect) {
    return;
  }

  if (!weeks.length) {
    dueDateSelect.innerHTML = '<option value="">No due dates configured</option>';
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
  if (amountInput) {
    amountInput.value = data.weeklyAmount;
    amountInput.defaultValue = data.weeklyAmount;
    refreshReceiptAmountComparison();
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
    const normalizedData = normalizeDashboardPayload(data);
    renderDashboard(normalizedData);
    const versionWarning = getBackendVersionWarning(normalizedData.backendVersion);
    if (versionWarning) {
      setDashboardStatus(versionWarning, "warning");
    }
  } catch (error) {
    renderFallbackDashboard(error);
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
    if (pageTitle) {
      pageTitle.textContent = activeSection.dataset.pageTitle || "Payment Tracker";
    }
    if (pageSubtitle) {
      pageSubtitle.textContent = activeSection.dataset.pageSubtitle || "";
    }
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

function isCompatibleBackendVersion(version) {
  return COMPATIBLE_BACKEND_VERSIONS.has(String(version || ""));
}

function getNumberOrFallback(value, fallbackValue = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallbackValue;
}

function validateDashboardPayload(data) {
  if (!data || !Array.isArray(data.weeks) || !Array.isArray(data.members)) {
    throw new Error("Hindi kumpleto ang dashboard data mula sa Google Apps Script. I-paste ang latest code.gs, run doGet once, then Deploy > New deployment.");
  }

  if (!data.weeks.length) {
    throw new Error("Walang contribution weeks na ibinalik ang Google Apps Script. Check CONTRIBUTION_TOTAL_WEEKS and deploy the latest code.gs.");
  }
}

function normalizeWeek(week, index, weeklyAmount) {
  const weekNumber = getNumberOrFallback(week && week.weekNumber, index + 1);
  const normalizedWeek = {
    ...(week || {}),
    id: String((week && week.id) || ""),
    label: String((week && week.label) || `Week ${weekNumber}`),
    weekday: String((week && week.weekday) || ""),
    weekNumber,
    amount: getNumberOrFallback(week && week.amount, weeklyAmount),
  };

  normalizedWeek.cumulativeTarget = getWeekCumulativeTarget(normalizedWeek, weeklyAmount);
  return normalizedWeek;
}

function normalizeWeekPayments(weekPayments) {
  if (!weekPayments || typeof weekPayments !== "object" || Array.isArray(weekPayments)) {
    return {};
  }

  return weekPayments;
}

function normalizeDashboardPayload(data) {
  validateDashboardPayload(data);

  const weeklyAmount = getNumberOrFallback(data.weeklyAmount, 50);
  const weeks = data.weeks.map((week, index) => normalizeWeek(week, index, weeklyAmount));
  const totalWeeks = getNumberOrFallback(data.totalWeeks, weeks.length);
  const expectedPerMember = weeklyAmount * totalWeeks;
  const currentWeekId = data.currentWeek && data.currentWeek.id;
  const currentWeek = weeks.find((week) => week.id === currentWeekId)
    || weeks.find((week) => !week.isPastDue)
    || weeks[0];

  const members = data.members.map((member) => {
    const weekPayments = normalizeWeekPayments(member && member.weekPayments);
    const totalPaid = getNumberOrFallback(member && member.totalPaid);
    const paidWeeks = getNumberOrFallback(
      member && member.paidWeeks,
      Object.values(weekPayments).filter((payment) => getNumberOrFallback(payment && payment.amount) > 0).length,
    );

    return {
      ...(member || {}),
      name: String((member && member.name) || "Unknown member"),
      weekPayments,
      totalPaid,
      paidWeeks,
      balance: Math.max(expectedPerMember - totalPaid, 0),
    };
  });

  const totalMembers = members.length;
  const expectedTotal = expectedPerMember * totalMembers;
  const totalCollected = members.reduce((total, member) => total + member.totalPaid, 0);
  const currentWeekRequiredAmount = getWeekCumulativeTarget(currentWeek, weeklyAmount);
  const paidThisWeek = members.filter((member) => member.totalPaid >= currentWeekRequiredAmount).length;
  const upcomingDueDates = (Array.isArray(data.upcomingDueDates) && data.upcomingDueDates.length ? data.upcomingDueDates : weeks.filter((week) => !week.isPastDue).slice(0, 5))
    .map((week, index) => normalizeWeek(week, index, weeklyAmount));

  return {
    ...data,
    weeklyAmount,
    totalWeeks,
    weeks,
    currentWeek,
    members,
    totalMembers,
    expectedTotal,
    totalCollected,
    remainingTotal: Math.max(expectedTotal - totalCollected, 0),
    collectionPercent: expectedTotal > 0 ? (totalCollected / expectedTotal) * 100 : 0,
    paidThisWeek,
    pendingThisWeek: Math.max(totalMembers - paidThisWeek, 0),
    upcomingDueDates,
    recentPayments: Array.isArray(data.recentPayments) ? data.recentPayments : [],
  };
}

function validateBackendVersion(backendStatus) {
  if (!backendStatus.success) {
    throw new Error(normalizeBackendError(backendStatus.message));
  }

  if (Number(backendStatus.headerCount) !== 12) {
    throw new Error(`Mali ang Payments sheet headers. Expected 12 columns, pero ${backendStatus.headerCount || "unknown"} ang nakita. Run doGet sa latest Apps Script para maayos ang headers, then deploy again.`);
  }

  if (!isCompatibleBackendVersion(backendStatus.backendVersion)) {
    showStatus(`Warning: backend version is ${backendStatus.backendVersion || "old/unknown"}, habang client ay ${CLIENT_VERSION}. Itutuloy ang upload dahil compatible ang health check, pero i-deploy ang latest code.gs kung may kulang na feature.`, "success");
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

function validatePaymentFields(payload) {
  const requiredFields = [
    ["memberName", "Please select a member."],
    ["dueDate", "Please select a due date."],
    ["paymentMethod", "Please select a payment method."],
    ["amountPaid", "Please enter the amount paid."],
    ["referenceNumber", "Please enter the payment reference number."],
  ];

  requiredFields.forEach(([field, message]) => {
    if (!payload[field]) {
      throw new Error(message);
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

function handleReceiptFileChange() {
  receiptScanSequence += 1;
  const file = proofFileInput && proofFileInput.files && proofFileInput.files[0];

  if (!file) {
    clearReceiptPreview();
    return;
  }

  try {
    validateFile(file);
    renderReceiptPreview(file);

    if (getAcceptedMimeType(file) === "application/pdf") {
      setReceiptScanState({ status: "warning", detectedAmounts: [], detectedReferences: [], matchedAmount: null, fileName: file.name });
      return;
    }

    scanReceiptAmount(file);
  } catch (error) {
    clearReceiptPreview();
    setReceiptScanState({ status: "error", detectedAmounts: [], detectedReferences: [], matchedAmount: null, fileName: file.name });
    showStatus(error.message, "error");
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

if (proofFileInput) {
  proofFileInput.addEventListener("change", handleReceiptFileChange);
}

if (amountPaidInput) {
  amountPaidInput.addEventListener("input", refreshReceiptAmountComparison);
  renderReceiptScanState();
}

if (referenceNumberInput) {
  referenceNumberInput.addEventListener("input", () => {
    if (referenceNumberInput.value.trim() !== autoFilledReferenceNumber) {
      autoFilledReferenceNumber = "";
    }
  });
}

if (form && submitButton) {
  form.addEventListener("reset", () => {
    receiptScanSequence += 1;
    autoFilledReferenceNumber = "";
    window.setTimeout(() => {
      clearReceiptPreview();
      if (dashboardData) {
        renderPaymentFormWeeks(dashboardData.weeks || []);
        const amountInput = document.querySelector("#amountPaid");
        if (amountInput) {
          amountInput.value = dashboardData.weeklyAmount;
          refreshReceiptAmountComparison();
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
        receiptFileName: buildReceiptFileName(String(formData.get("memberName") || "").trim(), String(formData.get("dueDate") || "").trim(), proofFile),
        mimeType: getAcceptedMimeType(proofFile),
        fileBase64: "",
      };
      validatePaymentFields(payload);
      ensureReceiptAmountVerified(proofFile);

      submitButton.disabled = true;
      submitButton.textContent = "Submitting...";
      await checkBackendReady();

      showStatus("Uploading payment. Please wait...", "success");
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
}
