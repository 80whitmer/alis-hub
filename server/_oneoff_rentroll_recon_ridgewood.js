require('dotenv').config();
const { getCommunities, getOccupancy, getRecurringCharges } = require('./services/alisApiClient');

const COMPANY_HOST = 'viva';
const SNAPSHOT_DATE = '2026-07-31';

// GL 310000 (per JW Ridgewood's own Report Configuration "Rent" column) is the
// only account actual per-unit room/rent charges post to -- these are the
// Billing Item names mapped to 310000 (Deluxe Flat A/B/C, Memory Care A/B,
// One Bedroom A/B/C, Respite Stay, Second Person Fee - AL). Everything else
// (Community Fee 313000, Level of Care 321000/323000/324000, Medication
// Management 332200, ancillary items) is Care/Other/Ancillary, not Rent.
const RENT_CHARGE_NAMES = new Set([
  'Deluxe Flat - A',
  'Deluxe Flat - B',
  'Deluxe Flat - C',
  'Memory Care - A',
  'Memory Care - B',
  'One Bedroom - A',
  'One Bedroom - B',
  'One Bedroom - C',
  'Respite Stay',
  'Second Person Fee - AL',
]);

const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const communities = await getCommunities(COMPANY_HOST);
  const ridgewood = communities.find((c) => String(c.communityName || '').toLowerCase().includes('ridgewood'));
  const communityId = ridgewood.communityId || ridgewood.id;

  const occRows = await getOccupancy(COMPANY_HOST, { communityId, monthAndYear: '2026-07-01' });
  const snapshot = occRows.filter((r) => r.date === SNAPSHOT_DATE && r.isPrimary && (r.dataSet === 'Occupied' || r.censusOcc === 1));
  console.log(`Occupied primary units on ${SNAPSHOT_DATE}:`, snapshot.length);

  const marketRateByResident = new Map();
  const unitByResident = new Map();
  for (const row of snapshot) {
    marketRateByResident.set(row.residentId, row.marketRate);
    unitByResident.set(row.residentId, row.unit);
  }
  const totalMarketRate = [...marketRateByResident.values()].reduce((a, b) => a + (b || 0), 0);

  // IMPORTANT: residentStatus/chargeStatus on this endpoint reflect status AS
  // OF TODAY (query time), not status during the historical service period --
  // a resident who has since moved out shows "Moved Out"/"Ended" even for a
  // charge whose serviceStartDate/serviceEndDate fully covered July. Passing
  // '' (not omitting the key) skips the wrapper's CurrentResident/Active
  // defaults so we don't silently drop anyone who was actually there in July.
  const chargeRows = await getRecurringCharges(COMPANY_HOST, {
    residentStatus: '',
    chargeStatus: '',
    serviceStartDate: '2026-07-01',
    serviceEndDate: '2026-07-31',
  });
  const ridgewoodCharges = chargeRows.filter((r) => r.communityId === communityId);
  console.log('recurringCharges rows (unfiltered by status) in July window:', ridgewoodCharges.length);

  // Overlap check client-side too, in case the API's date filter is looser
  // than expected -- keep only rows whose service period actually intersects July.
  const julStart = new Date('2026-07-01').getTime();
  const julEnd = new Date('2026-07-31').getTime();
  // ALIS timestamps are "YYYY-MM-DDT00:00:00.0000000" with no timezone
  // suffix, which Date parses as LOCAL time -- while julStart/julEnd (from
  // plain "YYYY-MM-DD" strings) parse as UTC per spec. On a US server that
  // mismatch shifts every comparison by the local UTC offset. Truncate to
  // just the date part so both sides parse as UTC midnight consistently.
  const parseAlisDate = (s) => (s ? new Date(s.slice(0, 10)).getTime() : null);
  const overlapsJuly = (r) => {
    const start = parseAlisDate(r.serviceStartDate) ?? -Infinity;
    const end = parseAlisDate(r.serviceEndDate) ?? Infinity;
    return start <= julEnd && end >= julStart;
  };

  const rentByResident = new Map();
  for (const row of ridgewoodCharges) {
    if (!RENT_CHARGE_NAMES.has(normalize(row.chargeName))) continue;
    if (!overlapsJuly(row)) continue;
    const amt = (row.unitPrice || 0) * (row.quantity || 1);
    rentByResident.set(row.residentId, (rentByResident.get(row.residentId) || 0) + amt);
  }

  let totalRent = 0;
  let totalLossToLease = 0;
  const rows = [];
  for (const [residentId, marketRate] of marketRateByResident) {
    const rent = rentByResident.get(residentId) || 0;
    totalRent += rent;
    const lossToLease = marketRate - rent;
    totalLossToLease += lossToLease;
    rows.push({ residentId, unit: unitByResident.get(residentId), marketRate, rent, lossToLease });
  }

  const unmatchedRentResidents = [...rentByResident.keys()].filter((id) => !marketRateByResident.has(id));
  const zeroRentRows = rows.filter((r) => r.rent === 0);

  console.log('\n--- Reconstructed from raw ALIS API data (occupancy + recurringCharges) ---');
  console.log('Total Market Rate (occupied units, primary occupant, 7/31 snapshot):', totalMarketRate.toFixed(2));
  console.log('Total Rent (GL 310000 rent-coded charges, matched to those residents):', totalRent.toFixed(2));
  console.log('Reconstructed Loss to Lease:', totalLossToLease.toFixed(2));
  console.log('Residents with a Rent charge but no matching 7/31 occupied-primary row:', unmatchedRentResidents.length, unmatchedRentResidents);
  console.log('Occupied residents still showing $0 matched rent:', zeroRentRows.length, zeroRentRows);
})();
