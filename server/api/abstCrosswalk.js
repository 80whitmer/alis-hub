const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { REPORTS_ROOT } = require('../automation/abstCrosswalkJob');
const { buildAbstCrosswalkWorkbook, buildResidentListWorkbook, buildResidentTabsWorkbook, selectResident, filterReport } = require('../services/abstCrosswalkWorkbook');

/** jobIds are UUIDs — reject anything else before it touches the filesystem. */
function jobDir(jobId) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  return path.join(REPORTS_ROOT, jobId);
}

function readReport(jobId) {
  const dir = jobDir(jobId);
  const file = dir && path.join(dir, 'report.json');
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// GET /api/abst-crosswalk/:jobId — header, community summary, resident picker list (no per-element detail)
router.get('/:jobId', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job (has it completed yet?)' });
    res.json({
      meta: report.meta,
      filename: report.filename,
      summary: report.summary,
      summaryCarePlan: report.summaryCarePlan,
      residents: report.residents.map((r) => ({
        residentId: r.residentId,
        name: r.name,
        unit: r.unit,
        productType: r.productType,
        evaluationDate: r.evaluation?.date ?? null,
        weeklyCaregiverMinutes: r.weeklyCaregiverMinutes,
        gaps: r.elements.filter((e) => e.status === 'assessed_no_minutes').length,
        notAssessed: r.elements.filter((e) => e.status === 'not_assessed').length,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abst-crosswalk/:jobId/resident/:residentId — one resident, all 22 elements
router.get('/:jobId/resident/:residentId', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job.' });
    const resident = report.residents.find((r) => String(r.residentId) === req.params.residentId);
    if (!resident) return res.status(404).json({ error: 'Resident not found in this report.' });
    res.json({ meta: report.meta, resident });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abst-crosswalk/:jobId/roster?excludeIndependent=1 — the numbers-only resident summary (both bases, no care item detail)
router.get('/:jobId/roster', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job.' });
    const filtered = req.query.excludeIndependent === '1' ? filterReport(report, { excludeProductTypes: ['Independent'] }) : report;
    const slim = (elements) => elements.map((e) => ({ id: e.id, status: e.status, weeklyMinutes: e.weeklyMinutes }));
    res.json({
      meta: filtered.meta,
      elements: report.summary.map((s) => ({ id: s.id, name: s.name })),
      residents: filtered.residents.map((r) => ({
        residentId: r.residentId,
        name: r.name,
        unit: r.unit,
        productType: r.productType,
        evaluationDate: r.evaluation?.date ?? null,
        assessment: { elements: slim(r.elements), weeklyCaregiverMinutes: r.weeklyCaregiverMinutes, averageDailyMinutes: r.averageDailyMinutes },
        carePlan: { elements: slim(r.carePlanView.elements), weeklyCaregiverMinutes: r.carePlanView.weeklyCaregiverMinutes, averageDailyMinutes: r.carePlanView.averageDailyMinutes },
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abst-crosswalk/:jobId/residents?excludeIndependent=1 — every resident's full page (care item detail stripped; the printed crosswalk doesn't show it)
router.get('/:jobId/residents', (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job.' });
    const filtered = req.query.excludeIndependent === '1' ? filterReport(report, { excludeProductTypes: ['Independent'] }) : report;
    res.json({
      meta: filtered.meta,
      residents: filtered.residents.map((r) => ({
        ...r,
        elements: r.elements.map(({ careItems, ...el }) => el),
      })),

    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/abst-crosswalk/:jobId/download — the .xlsx
//   (no params)            full internal workbook, every resident, care item detail
//   ?excludeIndependent=1  survey-facing workbook: Independent-living residents removed, no care item columns
router.get('/:jobId/download', async (req, res) => {
  try {
    const report = readReport(req.params.jobId);
    if (!report) return res.status(404).json({ error: 'No ABST crosswalk report found for this job.' });
    if (req.query.format === 'resident-tabs') {
      // One tab per resident plus an index sheet (Independent-living excluded when asked).
      const basis = ['assessment', 'care_plan', 'both'].includes(req.query.basis) ? req.query.basis : 'assessment';
      const excl = req.query.excludeIndependent === '1';
      const scoped = excl ? filterReport(report, { excludeProductTypes: ['Independent'] }) : report;
      const wb = buildResidentTabsWorkbook(scoped, basis);
      const sfx = { assessment: '', care_plan: ' (care plan basis)', both: ' (side by side, internal)' }[basis];
      const full = `${report.meta.communityName} - Residents, one tab each${excl ? ' - excl Independent' : ''}${sfx}.xlsx`;
      const safe = full.replace(/[^a-z0-9 .\-()]/gi, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(full)}`);
      await wb.xlsx.write(res);
      return res.end();
    }
    if (req.query.format === 'resident-list') {
      // Standalone "Resident by element" workbook: all residents (optionally excl. Independent) or one resident.
      const basis = ['assessment', 'care_plan', 'both'].includes(req.query.basis) ? req.query.basis : 'assessment';
      let scoped = report;
      let label = req.query.excludeIndependent === '1' ? ' - excl Independent' : '';
      if (req.query.residentId) {
        scoped = selectResident(report, req.query.residentId);
        if (!scoped.residents.length) return res.status(404).json({ error: 'Resident not found in this report.' });
        label = ` - ${scoped.residents[0].name}`;
      } else if (req.query.excludeIndependent === '1') {
        scoped = filterReport(report, { excludeProductTypes: ['Independent'] });
      }
      const wb = buildResidentListWorkbook(scoped, basis);
      const sfx = { assessment: '', care_plan: ' (care plan basis)', both: ' (side by side, internal)' }[basis];
      const full = `${report.meta.communityName} - Resident by element${label}${sfx}.xlsx`;
      const safe = full.replace(/[^a-z0-9 .\-()]/gi, '_');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(full)}`);
      await wb.xlsx.write(res);
      return res.end();
    }
    if (req.query.excludeIndependent === '1') {
      const basis = ['assessment', 'care_plan', 'both'].includes(req.query.basis) ? req.query.basis : 'assessment';
      const wb = buildAbstCrosswalkWorkbook(filterReport(report, { excludeProductTypes: ['Independent'] }), { surveyor: true, basis });
      const suffix = { assessment: '', care_plan: ' (care plan basis)', both: ' (side by side, internal)' }[basis];
      const name = report.filename.replace(/\.xlsx$/i, ` - excl Independent${suffix}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      await wb.xlsx.write(res);
      return res.end();
    }
    const file = path.join(jobDir(req.params.jobId), path.basename(report.filename));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Workbook file is missing on disk.' });
    res.download(file, report.filename);
  } catch (err) {
    console.error('[abst-crosswalk GET /:jobId/download] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
