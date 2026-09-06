require('dotenv').config();
const { getRecordedCare } = require('./services/alisApiClient');

(async () => {
  const companyHost = 'novellus';
  const communityId = 121; // Novellus Clairemont Assisted Living

  try {
    const rows = await getRecordedCare(companyHost, {
      communityId,
      careStartDate: '2025-09-01',
      careEndDate: '2025-10-31',
    });
    console.log('v1 recordedCare Sept-Oct 2025: rows =', Array.isArray(rows) ? rows.length : typeof rows);
    if (Array.isArray(rows) && rows.length) {
      console.log('sample:', JSON.stringify(rows[0], null, 2));
      const dates = rows.map(r => r.careDate).sort();
      console.log('date range in response:', dates[0], 'to', dates[dates.length - 1]);
    }
  } catch (err) {
    console.log('v1 recordedCare Sept-Oct 2025 ERROR:', err.message);
    if (err.response) {
      console.log('status:', err.response.status, 'body:', JSON.stringify(err.response.data).slice(0, 500));
    }
  }
})();
