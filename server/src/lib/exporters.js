import path from 'node:path';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import config from '../config.js';

/* ----------------------------------- CSV ---------------------------------- */

const csvCell = (value) => {
  if (value == null) return '';
  const s = String(value).replace(/\r?\n/g, ' ');
  return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** columns: [{ key, label }] */
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(pick(r, c))).join(','));
  // BOM keeps Excel happy with UTF-8 station names.
  return `﻿${[head, ...body].join('\r\n')}\r\n`;
}

const pick = (row, col) => (typeof col.value === 'function' ? col.value(row) : row[col.key]);

/* ---------------------------------- Excel --------------------------------- */

/** sheets: [{ name, columns:[{key,label,width}], rows, title }] */
export async function toXlsx(sheets, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.creator ?? 'Railway Inspection & Compliance Management System';
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Sheet1', {
      views: [{ state: 'frozen', ySplit: sheet.title ? 3 : 1 }],
    });
    let headerRowIndex = 1;
    if (sheet.title) {
      ws.mergeCells(1, 1, 1, Math.max(1, sheet.columns.length));
      const cell = ws.getCell(1, 1);
      cell.value = sheet.title;
      cell.font = { bold: true, size: 14, color: { argb: 'FF0B2E4F' } };
      ws.getRow(2).values = [sheet.subtitle ?? ''];
      ws.getRow(2).font = { italic: true, size: 10, color: { argb: 'FF5A6B7B' } };
      headerRowIndex = 3;
    }
    const header = ws.getRow(headerRowIndex);
    header.values = sheet.columns.map((c) => c.label);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4F6C' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9AB3C4' } } };
    });
    sheet.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width ?? Math.min(42, Math.max(12, c.label.length + 4));
    });
    for (const row of sheet.rows) {
      ws.addRow(sheet.columns.map((c) => pick(row, c) ?? ''));
    }
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: sheet.columns.length },
    };
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* ----------------------------------- PDF ---------------------------------- */

const INK = '#0b2e4f';
const MUTED = '#5a6b7b';
const RULE = '#c9d6e2';
const ACCENT = '#0b6b6b';

export async function qrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
}

function dataUrlToBuffer(dataUrl) {
  return Buffer.from(String(dataUrl).split(',')[1] ?? '', 'base64');
}

/**
 * Streams a PDF into `res`. `build(doc)` draws the body; the header, footer,
 * page numbers and the verification QR are handled here so every report in
 * the system looks the same.
 */
export function streamPdf(res, { fileName, title, subtitle, meta = [], verifyUrl }, build) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: title } });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${fileName}"`);
  doc.pipe(res);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(title, { align: 'left' });
  if (subtitle) doc.moveDown(0.15).font('Helvetica').fontSize(10).fillColor(MUTED).text(subtitle);
  doc.moveDown(0.4);
  if (meta.length) {
    doc.fontSize(9).fillColor(INK);
    const col = (doc.page.width - 80) / 2;
    const startY = doc.y;
    meta.forEach((m, i) => {
      const x = 40 + (i % 2) * col;
      const y = startY + Math.floor(i / 2) * 14;
      doc.font('Helvetica-Bold').text(`${m.label}: `, x, y, { continued: true, width: col - 10 });
      doc.font('Helvetica').fillColor(MUTED).text(String(m.value ?? '-'), { width: col - 10 });
      doc.fillColor(INK);
    });
    doc.y = startY + Math.ceil(meta.length / 2) * 14 + 6;
  }
  hr(doc);
  doc.moveDown(0.5);

  build(doc, { hr, table, INK, MUTED, RULE, ACCENT });

  return finalise(doc, { verifyUrl, title });
}

async function finalise(doc, { verifyUrl, title }) {
  const range = doc.bufferedPageRange();
  if (verifyUrl) {
    try {
      const img = dataUrlToBuffer(await qrDataUrl(verifyUrl));
      doc.switchToPage(range.start);
      doc.image(img, doc.page.width - 100, 36, { width: 58 });
      doc
        .font('Helvetica')
        .fontSize(6)
        .fillColor(MUTED)
        .text('Scan to verify', doc.page.width - 100, 96, { width: 58, align: 'center' });
    } catch {
      /* QR is decorative - never fail a report because of it */
    }
  }
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 34;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `${title}  |  Generated ${new Date().toLocaleString('en-IN')}  |  Page ${i - range.start + 1} of ${range.count}`,
        40,
        bottom,
        { width: doc.page.width - 80, align: 'center' }
      );
  }
  doc.end();
  return doc;
}

function hr(doc, color = RULE) {
  doc
    .strokeColor(color)
    .lineWidth(0.7)
    .moveTo(40, doc.y)
    .lineTo(doc.page.width - 40, doc.y)
    .stroke();
}

/**
 * Minimal table renderer with wrapped cells, zebra striping and page breaks.
 * columns: [{ label, key|value, width (fraction of available width), align }]
 */
function table(doc, columns, rows, opts = {}) {
  const left = 40;
  const available = doc.page.width - 80;
  const widths = columns.map((c) => Math.round((c.width ?? 1 / columns.length) * available));
  const pad = 4;
  const fontSize = opts.fontSize ?? 8.5;

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, available, 16).fill('#eef4f9');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(fontSize);
    let x = left;
    columns.forEach((c, i) => {
      doc.text(c.label, x + pad, y + 4.5, { width: widths[i] - pad * 2, align: c.align ?? 'left' });
      x += widths[i];
    });
    doc.y = y + 16;
  };

  drawHeader();
  let zebra = false;
  for (const row of rows) {
    const cells = columns.map((c, i) => ({
      text: String(pick(row, c) ?? '-'),
      width: widths[i] - pad * 2,
      align: c.align ?? 'left',
    }));
    doc.font('Helvetica').fontSize(fontSize);
    const height =
      Math.max(...cells.map((c) => doc.heightOfString(c.text, { width: c.width }))) + pad * 2;
    if (doc.y + height > doc.page.height - 50) {
      doc.addPage();
      drawHeader();
      zebra = false;
    }
    const y = doc.y;
    if (zebra) doc.rect(left, y, available, height).fill('#f8fbfd');
    zebra = !zebra;
    doc.fillColor(INK).font('Helvetica').fontSize(fontSize);
    let x = left;
    cells.forEach((c, i) => {
      doc.text(c.text, x + pad, y + pad, { width: c.width, align: c.align });
      x += widths[i];
    });
    doc.y = y + height;
    doc
      .strokeColor('#e6eef5')
      .lineWidth(0.5)
      .moveTo(left, doc.y)
      .lineTo(left + available, doc.y)
      .stroke();
  }
  doc.moveDown(0.6);
}

/** Resolves a stored attachment to an absolute path if it still exists. */
export function attachmentPath(storedName) {
  if (!storedName) return null;
  const abs = path.join(config.uploadDir, path.basename(storedName));
  return fs.existsSync(abs) ? abs : null;
}

export const pdfHelpers = { hr, table };
