const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { newPage, ensureLoggedIn } = require('./playwright/browser');
const { setJobStatus, setItemStatus, syncJobItems } = require('../db/database');
const { broadcast } = require('../api/broadcaster');

/**
 * resident-photos: downloads the profile photo of every resident on a
 * community's Current Residents tab into a folder + zip, with a manifest CSV.
 *
 * Confirmed live (Nov 2026, medtelligent / community 844):
 *  - The Current tab is a Syncfusion grid (`tr.e-row`, all rows on one page —
 *    same as residentMoveOutPage.js). Each row has
 *    `img[alt="Resident profile image"]` pointing at Cloudinary:
 *      res.cloudinary.com/alis-prod/image/upload/<transform>/<v123/>avatars/<CODE>-IL-<id>
 *    where <transform> is a 100x100 face-cropped thumbnail.
 *  - Swapping <transform> for `d_avatar-placeholder.png,f_jpg` returns the
 *    full-size original, unsigned (plain HTTP GET, no ALIS session needed).
 *  - A resident with NO photo (or a made-up id) still returns HTTP 200 with a
 *    generic placeholder image, so status codes can't detect "no photo" — we
 *    fetch the placeholder once (bogus id) and compare SHA-1s instead.
 *
 * Photos are PHI-adjacent: they're written to local disk only (REPORTS_ROOT),
 * never to the DB, and are served only through the authenticated download route.
 *
 * SSE events: job_start | progress | item_start | item_done | item_fail | job_done | job_error
 */
const REPORTS_ROOT = path.join(__dirname, 'resident-photo-exports');

const safe = (s) => String(s || '').replace(/[^a-z0-9 .\-()]/gi, '_').replace(/\s+/g, ' ').trim();
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/** Thumbnail URL from the page -> full-size original URL (same version + public id). */
function fullSizeUrl(thumbUrl) {
  return thumbUrl.replace(/\/image\/upload\/[^/]+\//, '/image/upload/d_avatar-placeholder.png,f_jpg/');
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Scrapes the Current tab: [{ name, room, profileId, thumbUrl }]. */
async function listResidentsWithPhotos(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForSelector('tr.e-row', { timeout: 20000 });
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('tr.e-row')).map((tr) => {
      const link = tr.querySelector('a[href^="/Residents/Profiles/"]');
      const img = tr.querySelector('img[alt="Resident profile image"]') || tr.querySelector('img[src*="/avatars/"]');
      return {
        name: tr.querySelector('.resident-peek-name')?.textContent.trim() || '',
        room: tr.querySelector('.resident-peek-room')?.textContent.trim() || '',
        profileId: link ? link.getAttribute('href').split('/').pop().split('?')[0] : null,
        thumbUrl: img ? (img.currentSrc || img.src) : null,
      };
    })
  ).then((rows) => rows.filter((r) => r.name && r.profileId));
}

function zipDir(srcDir, zipPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const zip = archiver('zip', { zlib: { level: 6 } });
    out.on('close', resolve);
    zip.on('error', reject);
    zip.pipe(out);
    zip.directory(srcDir, false);
    zip.finalize();
  });
}

async function runResidentPhotosJob(jobId, payload) {
  const { companyName, companyHost, communityId, communityName } = payload;
  const emit = (event, data) => broadcast(jobId, event, data);
  const fail = (error) => { setJobStatus(jobId, 'failed', error); emit('job_error', { error }); };

  if (!companyHost) return fail('ALIS Company Host is required.');
  if (!communityId) return fail('ALIS Community ID is required.');

  setJobStatus(jobId, 'running');
  emit('job_start', { jobId, total: 1, company: companyName });

  let page;
  try {
    const listUrl = `https://${companyHost}.alisonline.com/Residents/${communityId}?tab=Current`;
    page = await newPage();
    await ensureLoggedIn(page, listUrl);
    const residents = await listResidentsWithPhotos(page, listUrl);
    const label = communityName || `${companyHost}-${communityId}`;
    emit('progress', { message: `Found ${residents.length} current residents. Downloading photos…` });
    syncJobItems(jobId, residents.map((r) => r.name));

    const outDir = path.join(REPORTS_ROOT, jobId);
    const photoDir = path.join(outDir, 'photos');
    fs.mkdirSync(photoDir, { recursive: true });

    // Learn what "no photo" looks like, using the same transform + a bogus id.
    const sample = residents.find((r) => r.thumbUrl);
    let placeholderHash = null;
    if (sample) {
      const bogus = fullSizeUrl(sample.thumbUrl).replace(/\/(v\d+\/)?avatars\/.*$/, '/avatars/__no_photo_probe__');
      placeholderHash = sha1(await download(bogus).catch(() => Buffer.alloc(0)));
    }

    const rows = [];
    const used = new Set();
    let saved = 0, noPhoto = 0, failed = 0;
    for (const r of residents) {
      setItemStatus(jobId, r.name, 'running');
      emit('item_start', { name: r.name });
      let file = '', status = '';
      try {
        if (!r.thumbUrl) { status = 'no-photo'; }
        else {
          const buf = await download(fullSizeUrl(r.thumbUrl));
          if (placeholderHash && sha1(buf) === placeholderHash) status = 'no-photo';
          else {
            let base = safe(`${r.name.replace(/"[^"]*"/g, ' ').replace(',', '')}_${r.profileId}`).replace(/ /g, '_');
            while (used.has(base)) base += '_';
            used.add(base);
            file = `${base}.jpg`;
            fs.writeFileSync(path.join(photoDir, file), buf);
            status = 'saved';
          }
        }
        if (status === 'saved') saved++; else noPhoto++;
        setItemStatus(jobId, r.name, 'success', null, { outcome: status, detail: file || 'no photo on file' });
        emit('item_done', { name: r.name, status, detail: file || 'no photo on file' });
      } catch (err) {
        failed++; status = 'error';
        setItemStatus(jobId, r.name, 'failed', err.message);
        emit('item_fail', { name: r.name, error: err.message });
      }
      rows.push({ name: r.name, room: r.room, profileId: r.profileId, status, file });
    }

    fs.writeFileSync(
      path.join(outDir, 'manifest.csv'),
      ['Name,Room,Resident ID,Status,File', ...rows.map((x) => [x.name, x.room, x.profileId, x.status, x.file].map(csvCell).join(','))].join('\r\n')
    );
    fs.copyFileSync(path.join(outDir, 'manifest.csv'), path.join(photoDir, 'manifest.csv'));

    const zipName = `${safe(label)} - Resident Photos.zip`;
    await zipDir(photoDir, path.join(outDir, zipName));
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      filename: zipName,
      community: { companyHost, communityId, communityName: label },
      counts: { residents: residents.length, saved, noPhoto, failed },
    }, null, 2));

    setJobStatus(jobId, 'done');
    emit('job_done', { jobId, company: companyName, total: residents.length, saved, noPhoto, failed });
  } catch (err) {
    console.error(`[resident-photos:${jobId}] Failed:`, err);
    fail(err.message);
  } finally {
    await page?.context().close().catch(() => {});
  }
}

module.exports = { runResidentPhotosJob, REPORTS_ROOT };
