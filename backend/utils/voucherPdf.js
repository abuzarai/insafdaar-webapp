import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import pool from "../db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOUCHER_DIR = path.join(__dirname, "..", "uploads", "vouchers");
const LOGO_PATH = path.join(__dirname, "..", "assets", "insaafdar-logo.png");

function ensureDir() {
  if (!fs.existsSync(VOUCHER_DIR)) fs.mkdirSync(VOUCHER_DIR, { recursive: true });
}

function fmtMoney(n) {
  const num = Number(n ?? 0);
  return Number.isFinite(num) ? num.toFixed(2) : "0.00";
}

function safeText(x) {
  const s = String(x ?? "").trim();
  return s ? s : "—";
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

export async function generateVoucherPdfForBillingId(billingId) {
  ensureDir();

  const r = await pool.query(
    `
    SELECT
      b.id,
      b.title,
      b.description,
      b.amount,
      b.due_date,
      b.created_at,
      b.case_id,
      b.advocate_id,
      b.bank_name,
      b.bank_account_title,
      b.bank_account_number,
      b.bank_branch,
      u.name AS client_name,
      u.email AS client_email,
      c.title AS case_title,
      adv.name AS advocate_name
    FROM public.client_billing b
    JOIN public.users u ON u.id = b.user_id
    LEFT JOIN public.client_cases c ON c.id = b.case_id
    LEFT JOIN public.users adv ON adv.id = b.advocate_id
    WHERE b.id = $1
    `,
    [billingId]
  );

  if (r.rowCount === 0) throw new Error("Billing record not found for PDF generation");
  const row = r.rows[0];

  const filename = `insaafdar_voucher_${billingId}.pdf`;
  const absPath = path.join(VOUCHER_DIR, filename);
  const publicUrl = `/uploads/vouchers/${filename}`;

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
  const stream = fs.createWriteStream(absPath);
  doc.pipe(stream);

  // Page / panel sizes
  const pageW = doc.page.width; // ~842
  const pageH = doc.page.height; // ~595
  const margin = 18;
  const gap = 12;

  const panelW = (pageW - margin * 2 - gap * 2) / 3;
  const panelH = pageH - margin * 2;

  const startX = margin;
  const startY = margin;

  const copies = ["ADMIN COPY", "CLIENT COPY", "BANK COPY"];

  function drawPanel(x, y, w, h, copyLabel) {
    // Panel border
    doc.save();
    doc.lineWidth(1);
    doc.strokeColor("#111");
    doc.roundedRect(x, y, w, h, 6);
    doc.stroke();
    doc.restore();

    // Header band
    doc.save();
    doc.fillColor("#0B2A5B");
    doc.rect(x, y, w, 36);
    doc.fillOpacity(0.06);
    doc.fill();
    doc.fillOpacity(1);
    doc.restore();

    // ✅ Logo (safe)
    const logoX = x + 14;
    const logoY = y + 8;

    try {
      if (fs.existsSync(LOGO_PATH)) {
        // keep width small so it fits every panel nicely
        doc.image(LOGO_PATH, logoX, logoY, { width: 34 });
      } else {
        // fallback box if logo missing
        doc.save();
        doc.strokeColor("#0B2A5B").lineWidth(1);
        doc.rect(logoX, y + 10, 28, 28);
        doc.stroke();
        doc.fillColor("#0B2A5B").font("Helvetica-Bold").fontSize(7);
        doc.text("LOGO", logoX, y + 20, { width: 28, align: "center" });
        doc.restore();
      }
    } catch (e) {
      // fallback if image fails to render
      doc.save();
      doc.strokeColor("#0B2A5B").lineWidth(1);
      doc.rect(logoX, y + 10, 28, 28);
      doc.stroke();
      doc.restore();
    }

    // Header text
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(16);
    doc.text("INSAFDAR", x, y + 18, { width: w, align: "center" });

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(copyLabel, x, y + 40, { width: w, align: "center" });

    const headerH = 90;

    // Divider
    doc.strokeColor("#111").lineWidth(1);
    doc.moveTo(x + 10, y + headerH);
    doc.lineTo(x + w - 10, y + headerH);
    doc.stroke();

    // Fields
    const bodyX = x + 14;
    let cy = y + headerH + 14;

    doc.font("Helvetica").fontSize(9).fillColor("#111");

    function line(label, value) {
      doc.text(`${label}:`, bodyX, cy);
      doc.text("______________________________", bodyX + 72, cy);
      if (value) {
        doc.font("Helvetica-Bold").text(String(value).slice(0, 28), bodyX + 78, cy + 1, {
          width: w - 110,
        });
        doc.font("Helvetica");
      }
      cy += 18;
    }

    line("Client Name", row.client_name || "");
    line("Advocate Name", row.advocate_name || "");

    // Case/Voucher row
    doc.text("Case ID:", bodyX, cy);
    doc.text("__________", bodyX + 44, cy);
    if (row.case_id) {
      doc.font("Helvetica-Bold").text(String(row.case_id), bodyX + 48, cy + 1);
      doc.font("Helvetica");
    }

    doc.text("Voucher ID:", bodyX + 126, cy);
    doc.text("__________", bodyX + 184, cy);
    doc.font("Helvetica-Bold").text(String(row.id), bodyX + 188, cy + 1);
    doc.font("Helvetica");
    cy += 18;

    doc.text("Service / Issue:", bodyX, cy);
    doc.text("______________________________", bodyX + 78, cy);
    doc.font("Helvetica-Bold").text(safeText(row.title || row.case_title || ""), bodyX + 84, cy + 1, {
      width: w - 110,
    });
    doc.font("Helvetica");
    cy += 22;

    // Particulars table
    const tableX = bodyX;
    const tableY = cy + 10;
    const tableW = w - 28;
    const col1 = Math.floor(tableW * 0.65);
    const col2 = tableW - col1;

    // Table header bg
    doc.save();
    doc.fillColor("#000");
    doc.rect(tableX, tableY, tableW, 18);
    doc.fillOpacity(0.12);
    doc.fill();
    doc.fillOpacity(1);
    doc.restore();

    doc.strokeColor("#111").lineWidth(1);
    doc.rect(tableX, tableY, tableW, 18);
    doc.stroke();

    doc.moveTo(tableX + col1, tableY);
    doc.lineTo(tableX + col1, tableY + 18);
    doc.stroke();

    doc.font("Helvetica-Bold").fontSize(9).fillColor("#111");
    doc.text("Particulars", tableX + 6, tableY + 5, { width: col1 - 12 });
    doc.text("Amount (PKR)", tableX + col1 + 6, tableY + 5, { width: col2 - 12 });

    const rowH = 18;
    const rows = [
      ["Professional Fee", ""],
      ["Case Processing & Issue Framing", ""],
      ["Other Charges", ""],
      ["Total", `PKR ${fmtMoney(row.amount)}`],
    ];

    let ry = tableY + 18;
    doc.font("Helvetica").fontSize(9);

    for (let i = 0; i < rows.length; i++) {
      doc.rect(tableX, ry, tableW, rowH);
      doc.stroke();

      doc.moveTo(tableX + col1, ry);
      doc.lineTo(tableX + col1, ry + rowH);
      doc.stroke();

      doc.font("Helvetica");
      doc.text(rows[i][0], tableX + 6, ry + 5, { width: col1 - 12 });

      doc.font(i === rows.length - 1 ? "Helvetica-Bold" : "Helvetica");
      doc.text(rows[i][1], tableX + col1 + 6, ry + 5, { width: col2 - 12 });

      ry += rowH;
    }

    // Authorized banks
    const bankTitleY = ry + 18;
    doc.font("Helvetica-Bold").fontSize(9).text("Authorized Banks", tableX, bankTitleY);

    const bankTableY = bankTitleY + 10;
    const bankRowH = 18;
    const splitX = tableX + Math.floor(tableW * 0.6);

    const bankRows = [
      ["National Bank of Pakistan", "XXXX-XXXX"],
      ["Meezan Bank", "XXXX-XXXX"],
      ["Bank of Punjab", "XXXX-XXXX"],
    ];

    // Outer box
    doc.rect(tableX, bankTableY, tableW, bankRowH * bankRows.length);
    doc.stroke();

    // Vertical split
    doc.moveTo(splitX, bankTableY);
    doc.lineTo(splitX, bankTableY + bankRowH * bankRows.length);
    doc.stroke();

    let by = bankTableY;
    doc.font("Helvetica").fontSize(9);
    for (let i = 0; i < bankRows.length; i++) {
      if (i > 0) {
        doc.moveTo(tableX, by);
        doc.lineTo(tableX + tableW, by);
        doc.stroke();
      }
      doc.text(bankRows[i][0], tableX + 6, by + 5, { width: splitX - tableX - 12 });
      doc.text(bankRows[i][1], splitX + 6, by + 5, { width: tableX + tableW - splitX - 12 });
      by += bankRowH;
    }

    // Signatures
    const signY = bankTableY + bankRowH * bankRows.length + 24;
    doc.font("Helvetica").fontSize(9);
    doc.text("Client Signature: ____________________", tableX, signY);
    doc.text("Cashier Signature: ___________________", tableX, signY + 18);
    doc.text("Bank Stamp: _________________________", tableX, signY + 36);

    // Footer note
    doc.font("Helvetica").fontSize(7).fillColor("#666");
    doc.text(
      "Payment is mandatory before case processing and issue framing begins.",
      x,
      y + h - 22,
      { width: w, align: "center" }
    );

    // Dates small right top
    doc.fillColor("#111").font("Helvetica").fontSize(7);
    doc.text(`Issue: ${fmtDate(row.created_at)}`, x + w - 120, y + 8, {
      width: 110,
      align: "right",
    });
    doc.text(`Due: ${fmtDate(row.due_date)}`, x + w - 120, y + 20, {
      width: 110,
      align: "right",
    });
  }

  // draw 3 panels
  for (let i = 0; i < 3; i++) {
    const px = startX + i * (panelW + gap);
    drawPanel(px, startY, panelW, panelH, copies[i]);
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { publicUrl };
}
