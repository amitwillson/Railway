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

async function finalise(doc, { verifyUrl, title, qrAt = 'top-right' }) {
  const range = doc.bufferedPageRange();
  if (verifyUrl) {
    try {
      const img = dataUrlToBuffer(await qrDataUrl(verifyUrl));
      // A letter carries its verification code at the foot of the last page; a
      // report carries it beside the title, where a reader looks for it first.
      if (qrAt === 'bottom-left') {
        doc.switchToPage(range.start + range.count - 1);
        const y = doc.page.height - 118;
        doc.image(img, 56, y, { width: 52 });
        doc
          .font('Helvetica')
          .fontSize(6)
          .fillColor(MUTED)
          .text('Scan to verify', 56, y + 54, { width: 52, align: 'center' });
      } else {
        doc.switchToPage(range.start);
        doc.image(img, doc.page.width - 100, 36, { width: 58 });
        doc
          .font('Helvetica')
          .fontSize(6)
          .fillColor(MUTED)
          .text('Scan to verify', doc.page.width - 100, 96, { width: 58, align: 'center' });
      }
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
  const left = doc.page.margins?.left ?? 40;
  const right = doc.page.margins?.right ?? 40;
  doc
    .strokeColor(color)
    .lineWidth(0.7)
    .moveTo(left, doc.y)
    .lineTo(doc.page.width - right, doc.y)
    .stroke();
}

/**
 * Minimal table renderer with wrapped cells, zebra striping and page breaks.
 * columns: [{ label, key|value, width (fraction of available width), align }]
 */
function table(doc, columns, rows, opts = {}) {
  const left = opts.left ?? doc.page.margins?.left ?? 40;
  const available =
    opts.width ?? doc.page.width - left - (doc.page.margins?.right ?? 40);
  const widths = columns.map((c) => Math.round((c.width ?? 1 / columns.length) * available));
  const pad = 4;
  const fontSize = opts.fontSize ?? 8.5;

  const drawHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(fontSize);
    // A narrow column wraps its heading, so the band is as tall as the tallest
    // heading rather than a fixed 16pt that the text would spill out of.
    const height = Math.max(
      16,
      ...columns.map((c, i) => doc.heightOfString(c.label, { width: widths[i] - pad * 2 }) + 9)
    );
    doc.rect(left, y, available, height).fill('#eef4f9');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(fontSize);
    let x = left;
    columns.forEach((c, i) => {
      doc.text(c.label, x + pad, y + 4.5, { width: widths[i] - pad * 2, align: c.align ?? 'left' });
      x += widths[i];
    });
    doc.y = y + height;
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
    if (doc.y + height > doc.page.height - (opts.bottom ?? 54)) {
      doc.addPage();
      doc.y = doc.page.margins?.top ?? 40;
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

/* --------------------------- PDF: letter format ---------------------------- */

/**
 * Streams an Inspection Note as a letter rather than as a report: centred office
 * block, number and date on one line, subject, addressee, the observations
 * tabulated by serial number, the signature block, and the copy-to list. The
 * layout follows the office letter it replaces, so what the system prints is what
 * the division already circulates.
 *
 * note: the row from inspection_notes, with `observations` attached.
 */
export function streamNotePdf(res, note, { fileName, verifyUrl, groups = null } = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 46, bottom: 54, left: 56, right: 50 },
    bufferPages: true,
    info: { Title: `${note.note_no} - ${note.subject}` },
  });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${fileName ?? 'inspection-note.pdf'}"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // Letterhead.
  const headLines = String(note.letterhead ?? '').split(/\r?\n/).filter(Boolean);
  headLines.forEach((line, i) => {
    doc
      .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(i === 0 ? 14 : 10)
      .fillColor(INK)
      .text(line.toUpperCase() === line && i === 0 ? line : line, left, i === 0 ? 46 : doc.y, {
        width,
        align: 'center',
      });
  });
  doc.moveDown(0.5);
  hr(doc, INK);
  doc.moveDown(0.6);

  // No. ... / Date ...
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK);
  doc.text(`No. ${note.note_no}`, left, y, { width: width * 0.62 });
  doc.text(`Date: ${formatLetterDate(note.letter_date)}`, left + width * 0.62, y, {
    width: width * 0.38,
    align: 'right',
  });
  doc.y = Math.max(doc.y, y + 14);
  doc.moveDown(0.8);

  // Addressee and subject.
  if (note.addressee) {
    doc.font('Helvetica').fontSize(10).fillColor(INK).text('To,', left, doc.y, { width });
    doc.font('Helvetica').fontSize(10).text(String(note.addressee), left + 18, doc.y + 2, { width: width - 18 });
    doc.moveDown(0.8);
  }
  doc.font('Helvetica-Bold').fontSize(10).text('Sub: ', left, doc.y, { continued: true });
  doc.font('Helvetica-Bold').text(String(note.subject), { width });
  if (note.inspection_ref) {
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Ref: Inspection ${note.inspection_ref}`, { width });
    doc.fillColor(INK);
  }
  doc.moveDown(0.9);

  if (note.salutation) {
    doc.font('Helvetica').fontSize(10).text(String(note.salutation), left, doc.y, { width });
    doc.moveDown(0.6);
  }
  if (note.preamble) {
    doc.font('Helvetica').fontSize(10).text(String(note.preamble), left, doc.y, { width, align: 'justify', lineGap: 1.5 });
    doc.moveDown(0.9);
  }

  // The observations, tabulated. Grouped by department when asked for.
  const columns = [
    { label: 'Sl.', value: (r) => r.sl_no, width: 0.05, align: 'center' },
    { label: 'Location / Unit', value: (r) => [r.unit_name, r.coach && `Coach ${r.coach}`].filter(Boolean).join(' - ') || '-', width: 0.15 },
    { label: 'Item', key: 'item_name', width: 0.13 },
    { label: 'Deficiency noticed', key: 'observation', width: 0.33 },
    { label: 'Action by', key: 'department_name', width: 0.11 },
    { label: 'Supervisor', value: (r) => r.supervisor_name ?? 'Not mapped', width: 0.12 },
    // A numeric date in the column, so it does not wrap; the letter head carries
    // the date written out in full.
    { label: 'TDC', value: (r) => (r.tdc ? formatShortDate(r.tdc) : 'Not fixed'), width: 0.11, align: 'center' },
  ];
  if (groups?.length) {
    for (const group of groups) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(ACCENT).text(group.department, left, doc.y, { width });
      doc.fillColor(INK).moveDown(0.25);
      table(doc, columns, group.observations, { fontSize: 8.5, left, width });
      doc.moveDown(0.3);
    }
  } else {
    table(doc, columns, note.observations ?? [], { fontSize: 8.5, left, width });
  }

  doc.moveDown(0.6);
  if (note.closing) {
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(String(note.closing), left, doc.y, { width, align: 'justify', lineGap: 1.5 });
    doc.moveDown(1.6);
  }

  // Signature block, right aligned the way the office letter carries it.
  const signature = [note.signatory_name, note.signatory_designation, note.office].filter(Boolean);
  if (doc.y > doc.page.height - 140) doc.addPage();
  signature.forEach((line, i) => {
    doc
      .font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(i === 0 ? 10 : 9)
      .fillColor(INK)
      .text(line, left + width * 0.5, doc.y + (i === 0 ? 6 : 1), { width: width * 0.5, align: 'right' });
  });
  doc.moveDown(1.4);

  if (note.copy_to) {
    hr(doc);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(9).text('Copy to: ', left, doc.y, { continued: true });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(String(note.copy_to), { width });
    doc.fillColor(INK);
  }

  return finalise(doc, { verifyUrl, title: `${note.note_no}`, qrAt: 'bottom-left' });
}

/** 30.09.2026 - a date inside a narrow table column. */
export function formatShortDate(iso) {
  if (!iso) return '-';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
}

/** 30 September 2026 - how a date is written in the letter. */
export function formatLetterDate(iso) {
  if (!iso) return '-';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

/** Resolves a stored attachment to an absolute path if it still exists. */
export function attachmentPath(storedName) {
  if (!storedName) return null;
  const abs = path.join(config.uploadDir, path.basename(storedName));
  return fs.existsSync(abs) ? abs : null;
}

/* ----------------------- PDF: the inspection report ------------------------ */

/**
 * Streams one inspection as an inspection report.
 *
 * It is written around the inspection rather than around any one area, because
 * that is what the record is: one officer, one visit, as many areas as were
 * attended to. The parts follow the order a commercial inspection report has
 * always had - the previous inspection's outstanding items first, then the areas
 * covered, then the deficiencies with responsibility and target date, then what
 * was found in order, then general remarks.
 *
 * Part IV is the part a list of deficiencies cannot have. It is printed from the
 * item results on the sheet, so an inspection that found a station in good order
 * produces a report that says so instead of an empty page.
 *
 * report: the model from lib/inspectionReport.js reportFor().
 */
export function streamInspectionReportPdf(res, report, { fileName, verifyUrl, photos = [], attachmentPath = null } = {}) {
  const { inspection, defaults, place, coverage } = report;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 44,
    bufferPages: true,
    info: { Title: `Inspection Report ${inspection.inspection_no ?? inspection.ref_no}` },
  });
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${fileName}"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const date = (inspection.started_at ?? inspection.created_at ?? '').slice(0, 10);

  /* ------------------------------- letterhead ----------------------------- */
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12);
  for (const line of String(defaults.letterhead).split('\n')) {
    doc.text(line.trim(), { align: 'center' });
    doc.font('Helvetica').fontSize(9.5);
  }
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12.5).fillColor(INK).text('INSPECTION REPORT', { align: 'center' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`${inspection.module_name} · ${inspection.inspection_type_name}`, { align: 'center' });
  doc.moveDown(0.5);

  // Number on the left, date on the right - as on the office letter.
  const numberY = doc.y;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5);
  doc.text(`No. ${inspection.inspection_no ?? inspection.ref_no}`, left, numberY, { width: width * 0.6 });
  doc.text(formatLetterDate(inspection.report_issued_at ?? inspection.started_at ?? inspection.created_at), left + width * 0.6, numberY, {
    width: width * 0.4,
    align: 'right',
  });
  doc.y = numberY + 16;
  if (inspection.report_status !== 'issued') {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text('Draft - not yet issued', left, doc.y);
    doc.y += 12;
  }
  hr(doc);
  doc.moveDown(0.45);

  /* --------------------------------- header ------------------------------- */
  const meta = [
    [place.preposition === 'on' ? 'Train / section' : 'Station', place.name],
    ['Category', inspection.station_category ?? '-'],
    ['Date of inspection', date],
    [
      'Time',
      inspection.from_time
        ? `${inspection.from_time}${inspection.to_time ? ` to ${inspection.to_time}` : ''} hrs`
        : '-',
    ],
    [
      'Inspecting officer',
      `${inspection.inspector_name}${inspection.inspector_designation ? `, ${inspection.inspector_designation}` : ''}`,
    ],
    ['Accompanied by', inspection.joint_with || '-'],
    [
      'Previous inspection',
      inspection.previous_ref_no
        ? `${inspection.previous_ref_no} (${String(inspection.previous_started_at ?? '').slice(0, 10)})`
        : 'None on record',
    ],
    ['Inspection ID', inspection.ref_no],
  ];
  // Two columns of label/value. A long value wraps, so each row advances by the
  // height of its taller cell - a fixed step would print the next row on top of it.
  doc.fontSize(9);
  const col = width / 2;
  let metaY = doc.y;
  for (let i = 0; i < meta.length; i += 2) {
    const pair = meta.slice(i, i + 2);
    let rowHeight = 0;
    pair.forEach(([label, value], j) => {
      const x = left + j * col;
      doc.font('Helvetica-Bold').fillColor(INK).text(`${label}: `, x, metaY, {
        continued: true,
        width: col - 12,
      });
      doc.font('Helvetica').fillColor(MUTED).text(String(value ?? '-'), { width: col - 12 });
      rowHeight = Math.max(rowHeight, doc.y - metaY);
    });
    metaY += Math.max(rowHeight, 13) + 1;
    doc.y = metaY;
  }
  doc.y = metaY + 6;

  /* -------------------------------- coverage ------------------------------ */
  // The headline of an inspection report is how much of the station was seen, not
  // how many things were wrong.
  const strip = [
    ['Areas on sheet', coverage.areas_on_sheet],
    ['Attended to', coverage.areas_covered],
    ['Found in order', coverage.areas_satisfactory],
    ['With deficiencies', coverage.areas_with_deficiencies],
    ['Not inspected', coverage.areas_not_inspected],
    ['Items checked', coverage.items_checked],
  ];
  const boxTop = doc.y;
  const boxWidth = width / strip.length;
  doc.rect(left, boxTop, width, 30).fill('#eef4f9');
  strip.forEach(([label, value], i) => {
    const x = left + i * boxWidth;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(String(value ?? 0), x, boxTop + 4, {
      width: boxWidth,
      align: 'center',
    });
    doc.fillColor(MUTED).font('Helvetica').fontSize(6.5).text(label.toUpperCase(), x, boxTop + 19, {
      width: boxWidth,
      align: 'center',
    });
  });
  doc.y = boxTop + 38;
  if (coverage.coverage_pct != null) {
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `${coverage.coverage_pct}% of the areas on the sheet were attended to during this visit.`,
        left,
        doc.y,
        { width, align: 'right' }
      );
    doc.y += 12;
  }

  /* -------------------------------- narrative ----------------------------- */
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text('Summary', left, doc.y);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8.5).fillColor('#33475b').text(report.narrative, { align: 'justify', width });
  doc.fillColor(INK).moveDown(0.7);

  /* ----------------------------------- parts ------------------------------ */
  const part = (label, subtitle) => {
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(label, left, doc.y);
    if (subtitle) {
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(subtitle, { width });
    }
    doc.fillColor(INK).moveDown(0.25);
  };
  const none = (text) => {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED).text(text, { width });
    doc.fillColor(INK).moveDown(0.6);
  };

  // Part I - the previous inspection.
  part('PART I - Review of the previous inspection', 'Items left outstanding by the last inspection of this location, and their position at this visit.');
  if (!report.previous_inspection) {
    none('No previous inspection of this location is on record.');
  } else if (report.previous_items.length === 0) {
    none(`Nothing was left outstanding by ${report.previous_inspection.ref_no}.`);
  } else {
    table(
      doc,
      [
        { label: 'Sl', key: 'sl', width: 0.035, align: 'right' },
        { label: 'Ref', key: 'ref_no', width: 0.105 },
        { label: 'Area', key: 'unit_name', width: 0.09 },
        { label: 'Deficiency', key: 'observation', width: 0.25 },
        { label: 'Action by', key: 'department_name', width: 0.11 },
        { label: 'TDC', key: 'tdc_short', width: 0.085 },
        { label: 'Position', key: 'finding_label', width: 0.1 },
        { label: 'Remarks', key: 'review_remarks', width: 0.225 },
      ],
      report.previous_items.map((item, i) => ({
        ...item,
        sl: i + 1,
        tdc_short: item.tdc ? formatShortDate(item.tdc) : '-',
        review_remarks: item.review?.remarks ?? '-',
      }))
    );
  }

  // Part II - the areas.
  part('PART II - Areas inspected', 'Every area on the sheet, including those found in order and those that could not be attended to.');
  table(
    doc,
    [
      { label: 'Sl', key: 'sl', width: 0.04, align: 'right' },
      { label: 'Area', key: 'unit_name', width: 0.2 },
      { label: 'Result', key: 'result_label', width: 0.17 },
      { label: 'Checked', key: 'items_count', width: 0.07, align: 'right' },
      { label: 'In order', key: 'ok_count', width: 0.07, align: 'right' },
      { label: 'Def.', key: 'deficiency_count', width: 0.05, align: 'right' },
      { label: 'Remarks', key: 'remarks_text', width: 0.4 },
    ],
    report.areas.map((area, i) => ({
      ...area,
      sl: i + 1,
      items_count: area.items.length,
      ok_count: area.items_ok.length,
      deficiency_count: area.observations.length,
      remarks_text:
        area.remarks ??
        (area.observations.length
          ? area.observations.map((o) => o.ref_no).join(', ')
          : area.result === 'satisfactory'
            ? 'Nothing to report'
            : '-'),
    }))
  );

  // Part III - the deficiencies.
  part('PART III - Deficiencies noticed', 'Each one has been advised to the department shown, with the target date of compliance against it.');
  if (report.observations.length === 0) {
    none('No deficiency was noticed during this inspection.');
  } else {
    table(
      doc,
      [
        { label: 'Sl', key: 'sl', width: 0.04, align: 'right' },
        { label: 'Ref', key: 'ref_no', width: 0.11 },
        { label: 'Area', key: 'unit_name', width: 0.11 },
        { label: 'Item', key: 'item_name', width: 0.11 },
        { label: 'Observation', key: 'observation', width: 0.26 },
        { label: 'Sev.', key: 'severity_name', width: 0.07 },
        { label: 'Action by', key: 'department_name', width: 0.1 },
        { label: 'Supervisor', key: 'supervisor_name', width: 0.11 },
        { label: 'TDC', key: 'tdc_short', width: 0.09 },
      ],
      report.observations.map((o, i) => ({
        ...o,
        sl: i + 1,
        tdc_short: o.tdc ? formatShortDate(o.tdc) : '-',
      }))
    );
  }

  // Part IV - what was found in order. This is the record of a proper inspection.
  part('PART IV - Checked and found in order', 'Recorded so that the report shows what was inspected, not only what was found wanting.');
  const inOrder = report.areas
    .filter((a) => a.items_ok.length > 0)
    .map((a) => ({
      unit_name: a.unit_name,
      items: a.items_ok.map((r) => r.item_name).join(', '),
      count: a.items_ok.length,
    }));
  if (inOrder.length === 0) {
    none('No item was recorded as checked and found in order during this inspection.');
  } else {
    table(
      doc,
      [
        { label: 'Area', key: 'unit_name', width: 0.22 },
        { label: 'No.', key: 'count', width: 0.06, align: 'right' },
        { label: 'Items checked and found in order', key: 'items', width: 0.72 },
      ],
      inOrder
    );
  }

  // Part V - general remarks.
  part('PART V - General remarks');
  if (inspection.general_remarks || inspection.summary) {
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#33475b')
      .text(inspection.general_remarks ?? inspection.summary, { align: 'justify', width });
    doc.fillColor(INK).moveDown(0.6);
  } else {
    none('Nil.');
  }
  doc.font('Helvetica').fontSize(8.5).fillColor('#33475b').text(defaults.closing, { align: 'justify', width });
  doc.fillColor(INK).moveDown(0.8);

  /* ------------------------------- signatures ----------------------------- */
  if (doc.y > doc.page.height - 190) doc.addPage();
  for (const a of report.approvals) {
    const top = doc.y;
    if (a.signature_data?.startsWith('data:image')) {
      try {
        doc.image(Buffer.from(a.signature_data.split(',')[1], 'base64'), left, top, { fit: [110, 38] });
      } catch {
        /* ignore a malformed signature */
      }
    }
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(
        `${a.user_name}${a.designation ? `, ${a.designation}` : ''} (${a.approval_role})`
          + ` - ${String(a.signed_at).slice(0, 19).replace('T', ' ')}${a.remarks ? ` - ${a.remarks}` : ''}`,
        left + 120,
        top + 10,
        { width: width - 120 }
      );
    doc.y = Math.max(doc.y, top + 44);
  }
  doc.fillColor(INK).moveDown(1.2);
  const signTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).text(inspection.inspector_name, left + width * 0.55, signTop, {
    width: width * 0.45,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(inspection.inspector_designation ?? 'Inspecting Officer', {
    width: width * 0.45,
    align: 'right',
  });
  doc.moveDown(0.9);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text('Submitted to:', left, doc.y);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(defaults.submitted_to, { width });
  doc.moveDown(0.3);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text('Copy to:', left, doc.y);
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(defaults.copy_to, { width });

  /* ---------------------------------- photos ------------------------------ */
  if (photos.length && attachmentPath) {
    doc.addPage();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Annexure - photographic evidence', left, doc.y);
    doc.moveDown(0.4);
    for (const entry of photos) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor(INK)
        .text(
          `${entry.observation.ref_no} - ${entry.observation.item_name ?? ''}`
            + `${entry.observation.unit_name ? ` (${entry.observation.unit_name})` : ''}`,
          left,
          doc.y
        );
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(entry.observation.observation, { width: width - 20 });
      doc.fillColor(INK).moveDown(0.2);
      let x = left;
      const top = doc.y;
      let bottom = top;
      for (const photo of entry.photos) {
        const abs = attachmentPath(photo.stored_name);
        if (!abs) continue;
        try {
          doc.image(abs, x, top, { fit: [120, 90] });
          x += 128;
          bottom = Math.max(bottom, top + 90);
        } catch {
          /* unreadable image - skip */
        }
      }
      doc.y = bottom + 12;
    }
  }

  return finalise(doc, { verifyUrl, title: 'Inspection Report', qrAt: 'bottom-left' });
}
