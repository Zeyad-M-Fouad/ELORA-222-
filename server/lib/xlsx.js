import ExcelJS from 'exceljs';

/**
 * Build an .xlsx workbook from column definitions + rows.
 * columns: [{ header, key, width? }] — cell values are scalars.
 * Returns a Buffer.
 */
export async function buildXlsx({ sheetName = 'Export', columns, rows, title }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Eloria';
  const ws = wb.addWorksheet(sheetName.slice(0, 30));

  if (title) {
    ws.addRow([title]);
    ws.getRow(1).font = { bold: true, size: 13 };
    ws.addRow([`Exported: ${new Date().toISOString()}`]);
    ws.addRow([]);
  }

  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 22 }));
  const headerRow = ws.getRow(title ? 4 : 1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAD9C9' } };

  for (const row of rows) {
    ws.addRow(row);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function sendXlsx(res, filename, payload) {
  return buildXlsx(payload).then((buf) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  });
}
