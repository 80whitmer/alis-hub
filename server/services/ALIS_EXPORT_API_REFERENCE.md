# ALIS Export API Reference

Auto-generated from the live specs at https://api.alisonline.com/specs/v1/openapi.json and .../specs/v2/openapi.json — regenerate this file rather than hand-editing it if the API changes (see the script note at the bottom). Export endpoints only; `/v1/integration/*` and `/v2/integration/*` aren't covered here.

alis-hub deliberately mixes versions — most endpoints are v1, but a few (like invoice charges) are v2-only or have a meaningfully better v2 schema (real date-range filtering, for instance). Check both index sections below before assuming an endpoint doesn't exist.

All export endpoints are account-wide GETs (Basic Auth per `server/services/alisApiClient.js`); most take no date-range query param, so period-based reporting has to filter client-side (see `filterByDateRange` in `server/services/kpiNormalizer.js`) — check each endpoint's "date fields" note, and its query parameters table, to know whether server-side filtering is available.

**Legend:** ✅ = already wired up in `alisApiClient.js` · ⬜ = not yet used by alis-hub

## Index

- [V1 Index](#v1-index)
- [V2 Index](#v2-index)

---

## V1 Index

- ⬜ [`/v1/export/billing/glTransactions`](#v1v1exportbillinggltransactions)
- ⬜ [`/v1/export/billing/incidentalCharges`](#v1v1exportbillingincidentalcharges)
- ⬜ [`/v1/export/billing/invoiceCharges`](#v1v1exportbillinginvoicecharges)
- ✅ [`/v1/export/billing/outstandingInvoices`](#v1v1exportbillingoutstandinginvoices) — `getOutstandingInvoices()`
- ✅ [`/v1/export/billing/recurringCharges`](#v1v1exportbillingrecurringcharges) — `getRecurringCharges()`
- ⬜ [`/v1/export/care/planItems`](#v1v1exportcareplanitems)
- ✅ [`/v1/export/care/recordedCare`](#v1v1exportcarerecordedcare) — `getRecordedCare()`
- ✅ [`/v1/export/clinical/diagnosesAndAllergies`](#v1v1exportclinicaldiagnosesandallergies) — `getDiagnosesAndAllergies()`
- ⬜ [`/v1/export/clinical/evaluationConfiguration`](#v1v1exportclinicalevaluationconfiguration)
- ✅ [`/v1/export/clinical/orderAdministration`](#v1v1exportclinicalorderadministration) — `getOrderAdministration()`
- ⬜ [`/v1/export/clinical/orders`](#v1v1exportclinicalorders)
- ⬜ [`/v1/export/clinical/vaccinations`](#v1v1exportclinicalvaccinations)
- ⬜ [`/v1/export/clinical/vitalRecords`](#v1v1exportclinicalvitalrecords)
- ✅ [`/v1/export/communities`](#v1v1exportcommunities) — `getCommunities()`
- ⬜ [`/v1/export/communities/contacts`](#v1v1exportcommunitiescontacts)
- ⬜ [`/v1/export/communities/floorPlan`](#v1v1exportcommunitiesfloorplan)
- ⬜ [`/v1/export/communities/floorPlan/hqOccupancies`](#v1v1exportcommunitiesfloorplanhqoccupancies)
- ⬜ [`/v1/export/communities/floorPlan/roomMarketRateChanges`](#v1v1exportcommunitiesfloorplanroommarketratechanges)
- ⬜ [`/v1/export/communities/floorPlan/roomStays`](#v1v1exportcommunitiesfloorplanroomstays)
- ⬜ [`/v1/export/communities/floorPlan/unitOccupancies`](#v1v1exportcommunitiesfloorplanunitoccupancies)
- ✅ [`/v1/export/communities/historicalFloorPlan`](#v1v1exportcommunitieshistoricalfloorplan) — `getHistoricalFloorPlan()`
- ⬜ [`/v1/export/communities/productTypes`](#v1v1exportcommunitiesproducttypes)
- ⬜ [`/v1/export/prospects`](#v1v1exportprospects)
- ⬜ [`/v1/export/prospects/referralOrganizations`](#v1v1exportprospectsreferralorganizations)
- ⬜ [`/v1/export/prospects/referralSources`](#v1v1exportprospectsreferralsources)
- ⬜ [`/v1/export/prospects/tasks`](#v1v1exportprospectstasks)
- ✅ [`/v1/export/residents`](#v1v1exportresidents) — `getResidents()`
- ⬜ [`/v1/export/residents/complianceDetails`](#v1v1exportresidentscompliancedetails)
- ✅ [`/v1/export/residents/evaluations`](#v1v1exportresidentsevaluations) — `getEvaluations()`
- ⬜ [`/v1/export/residents/evaluations/xmlDocuments`](#v1v1exportresidentsevaluationsxmldocuments)
- ✅ [`/v1/export/residents/historicalMoveInMoveOuts`](#v1v1exportresidentshistoricalmoveinmoveouts) — `getHistoricalMoveInMoveOuts()`
- ✅ [`/v1/export/residents/incidents`](#v1v1exportresidentsincidents) — `getIncidents()`
- ⬜ [`/v1/export/residents/incidents/{incidentId}/formData`](#v1v1exportresidentsincidentsincidentidformdata)
- ⬜ [`/v1/export/residents/insurances`](#v1v1exportresidentsinsurances)
- ✅ [`/v1/export/residents/leaves`](#v1v1exportresidentsleaves) — `getLeaves()`
- ✅ [`/v1/export/residents/moveInsAndOuts`](#v1v1exportresidentsmoveinsandouts) — `getMoveInsAndOuts()`
- ⬜ [`/v1/export/residents/observations`](#v1v1exportresidentsobservations)
- ⬜ [`/v1/export/residents/productTypeChanges`](#v1v1exportresidentsproducttypechanges)
- ✅ [`/v1/export/staff`](#v1v1exportstaff) — `getStaff()`
- ⬜ [`/v1/export/staff/complianceDetails`](#v1v1exportstaffcompliancedetails)

---

## ⬜ `GET /v1/export/billing/glTransactions`

DEPRECATED: Use '/v2/export/billing/glTransactions' instead

Returns a list of GL transactions for the authenticated user within the specified
            month and year. Limited by company/community access

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `monthAndYear` | string (date-time), nullable | no | The month and year to filter transactions by. Defaults to current month and year. |
| `communityId` | integer (int64), nullable | no | The community identifier to filter transactions by. |
| `payerType` | string, nullable | no | The payer type to filter transactions by. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | string, nullable |  |
| `communityName` | string, nullable |  |
| `communityState` | string, nullable |  |
| `residentId` | string, nullable |  |
| `residentFullName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `glDate` | string, nullable |  |
| `txnNumber` | string, nullable |  |
| `glAccountNumber` | string, nullable |  |
| `payerType` | string, nullable |  |
| `action` | string, nullable |  |
| `debitAmount` | string, nullable |  |
| `creditAmount` | string, nullable |  |
| `class` | string, nullable |  |
| `item` | string, nullable |  |
| `dept` | string, nullable |  |
| `isExported` | string, nullable |  |
| `createdAt` | string, nullable |  |

**Likely date fields for period filtering:** `glDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/billing/incidentalCharges`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `asOfDate` | string (date-time) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `payerType` | string, nullable |  |
| `chargeName` | string, nullable |  |
| `chargeDescription` | string, nullable |  |
| `glAccountNumber` | string, nullable |  |
| `incurredOnDate` | string (date-time), nullable |  |
| `serviceStartDate` | string (date-time), nullable |  |
| `serviceEndDate` | string (date-time), nullable |  |
| `unitPrice` | number (double), nullable |  |
| `quantity` | integer (int32), nullable |  |
| `amount` | number (double) |  |
| `createdAt` | string (date-time), nullable |  |
| `updatedAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `incurredOnDate`, `serviceStartDate`, `serviceEndDate`, `updatedAt`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/billing/invoiceCharges`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `invoiceStartDate` | string (date-time), nullable | no | Defaults to first day of current month, inclusive |
| `invoiceEndDate` | string (date-time), nullable | no | Defaults to last day of current month, inclusive |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `productTypeId` | integer (int64) |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `invoiceId` | integer (int64) |  |
| `invoiceNumber` | integer (int32) |  |
| `invoiceDate` | string (date-time) |  |
| `payerType` | string, nullable |  |
| `type` | string, nullable |  |
| `itemName` | string, nullable |  |
| `itemDescription` | string, nullable |  |
| `unitPrice` | number (double), nullable |  |
| `quantity` | integer (int32), nullable |  |
| `discountPercent` | number (float), nullable |  |
| `discountAmount` | number (double), nullable |  |
| `amount` | number (double) |  |

**Likely date fields for period filtering:** `invoiceDate`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/billing/outstandingInvoices`

**Wired up as:** `getOutstandingInvoices()` in `server/services/alisApiClient.js`

Returns a paged response of outstanding invoices for the authenticated user.
            Limited by company/community access

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no | The community identifier to filter invoices by. |
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `communityState` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentFullName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `payerType` | string, nullable |  |
| `payerFullName` | string, nullable |  |
| `invoiceId` | integer (int64) |  |
| `invoiceDate` | string (date-time) |  |
| `invoiceDueDate` | string (date-time) |  |
| `invoiceTotal` | number (double) |  |
| `appliedPayments` | number (double) |  |
| `appliedCredits` | number (double) |  |
| `appliedDiscounts` | number (double) |  |
| `invoiceBalance` | number (double) |  |

**Likely date fields for period filtering:** `invoiceDate`, `invoiceDueDate`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/billing/recurringCharges`

**Wired up as:** `getRecurringCharges()` in `server/services/alisApiClient.js`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `residentStatus` | string, nullable | no |  |
| `chargeStatus` | string, nullable | no |  |
| `serviceStartDate` | string (date-time), nullable | no |  |
| `serviceEndDate` | string (date-time), nullable | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `payerType` | string, nullable |  |
| `chargeName` | string, nullable |  |
| `chargeDescription` | string, nullable |  |
| `chargeStatus` | string, nullable |  |
| `serviceStartDate` | string (date-time), nullable |  |
| `serviceEndDate` | string (date-time), nullable |  |
| `unitPrice` | number (double), nullable |  |
| `quantity` | integer (int32), nullable |  |
| `isPerDiem` | boolean |  |

**Likely date fields for period filtering:** `serviceStartDate`, `serviceEndDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/care/planItems`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `residentStatus` | string | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `publishDate` | string (date-time) |  |
| `carePlanId` | integer (int64) |  |
| `carePlanDate` | string (date-time), nullable |  |
| `carePlanItemId` | integer (int64) |  |
| `careItemName` | string, nullable |  |
| `careItemAsOfDate` | string (date-time), nullable |  |
| `estimatedTime` | integer (int32), nullable |  |
| `schedulingFrequency` | string, nullable |  |
| `daysOfWeek` | string, nullable |  |
| `nDaysInterval` | integer (int32), nullable |  |
| `intervalsHours` | integer (int32) |  |

**Likely date fields for period filtering:** `publishDate`, `carePlanDate`, `careItemAsOfDate`, `estimatedTime`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/care/recordedCare`

**Wired up as:** `getRecordedCare()` in `server/services/alisApiClient.js`

DEPRECATED: Use '/v2/export/care/recordedCare' instead

Returns a list of recorded care for residents that the authenticated user has access to. The data returned
is within the specified date range (if a date is not provided then that date will default to the start or end of the current month).
Limited by company/community access.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `careStartDate` | string (date-time), nullable | no | Defaults to start of current month, inclusive (Search is limited to past 6 months of data) |
| `careEndDate` | string (date-time), nullable | no | Defaults to end of current month, inclusive. |
| `communityId` | integer (int64), nullable | no | The community identifier to filter records by. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `recordedCareId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `byHour` | string, nullable |  |
| `byShift` | string, nullable |  |
| `byWeekDay` | string, nullable |  |
| `byWeekNo` | string, nullable |  |
| `careDate` | string (date-time), nullable |  |
| `careTime` | string (date-time), nullable |  |
| `careItemName` | string, nullable |  |
| `careItemCategory` | string, nullable |  |
| `careListName` | string, nullable |  |
| `careListGroup` | string, nullable |  |
| `isCareNotRecorded` | boolean |  |
| `isPrnCare` | boolean |  |
| `assignedToID` | integer (int64), nullable |  |
| `recordedByID` | integer (int64), nullable |  |
| `recordedDateTime` | string (date-time), nullable |  |
| `reportingLabel` | string, nullable |  |
| `outcomeText` | string, nullable |  |
| `outcomeNotes` | string, nullable |  |
| `timeEstimated` | integer (int32) |  |
| `timeTaken` | integer (int32) |  |

**Likely date fields for period filtering:** `careDate`, `careTime`, `recordedDateTime`, `timeEstimated`, `timeTaken`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/clinical/diagnosesAndAllergies`

**Wired up as:** `getDiagnosesAndAllergies()` in `server/services/alisApiClient.js`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `structuredDiagnoses` | string, nullable |  |
| `primaryDiagnoses` | string, nullable |  |
| `secondaryDiagnoses` | string, nullable |  |
| `diet` | string, nullable |  |
| `foodAllergies` | string, nullable |  |
| `medicalAllergies` | string, nullable |  |
| `isDiabetic` | string, nullable |  |
| `isTobaccoUser` | string, nullable |  |
| `tobaccoUseNotes` | string, nullable |  |
| `isAlcoholUser` | string, nullable |  |
| `alcoholUseNotes` | string, nullable |  |
| `isIncontinent` | string, nullable |  |
| `incontinentNotes` | string, nullable |  |
| `hearingAid` | string, nullable |  |
| `dentures` | string, nullable |  |
| `additionalDevices` | string, nullable |  |
| `longTermMemory` | string, nullable |  |
| `shortTermMemory` | string, nullable |  |
| `attentionSpan` | string, nullable |  |
| `vision` | string, nullable |  |
| `visionNotes` | string, nullable |  |
| `ambulation` | string, nullable |  |
| `ambulationNotes` | string, nullable |  |
| `hearingNotes` | string, nullable |  |
| `smellNotes` | string, nullable |  |
| `speechNotes` | string, nullable |  |
| `recentSurgeries` | string, nullable |  |
| `chronicConditions` | string, nullable |  |
| `hairColor` | string, nullable |  |
| `eyeColor` | string, nullable |  |

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/clinical/evaluationConfiguration`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `retInstrumentId` | integer (int64) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `evaluationConfigurationId` | integer (int64) |  |
| `evaluationConfigurationName` | string, nullable |  |
| `evaluationConfigurationVersion` | string, nullable |  |
| `evaluationConfigurationXml` | string, nullable |  |

[↑ back to index](#index)

---

## ✅ `GET /v1/export/clinical/orderAdministration`

**Wired up as:** `getOrderAdministration()` in `server/services/alisApiClient.js`

DEPRECATED: Use '/v2/export/clinical/orderAdministration' or '/v3/export/clinical/orderAdministration' instead

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no |  |
| `startDate` | string (date-time) | no | Defaults to start of current month, inclusive (Search is limited to past 3 months of data) |
| `endDate` | string (date-time) | no | Defaults to end of current month, inclusive |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `orderId` | integer (int64) |  |
| `orderName` | string, nullable |  |
| `orderType` | string, nullable |  |
| `scheduledDate` | string (date-time), nullable |  |
| `scheduledTime` | string (date-time), nullable |  |
| `passedTime` | string (date-time), nullable |  |
| `byShift` | string, nullable |  |
| `byHour` | string (date-time), nullable |  |
| `exceptionReason` | string, nullable |  |
| `adminNote` | string, nullable |  |
| `doseAdministered` | string, nullable |  |
| `isPrn` | boolean, nullable |  |
| `isNotRecorded` | boolean, nullable |  |
| `status` | string, nullable |  |
| `statusNote` | string, nullable |  |
| `recordedBy` | integer (int64) |  |
| `recorderName` | string, nullable |  |
| `recorderRole` | string, nullable |  |

**Likely date fields for period filtering:** `scheduledDate`, `scheduledTime`, `passedTime`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/clinical/orders`

DEPRECATED: Use '/v2/export/clinical/orders' instead

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `status` | string, nullable | no |  |
| `createdAtStartDate` | string (date-time), nullable | no | Optional: The start of the date range to filter by clinical order CreatedAt. Requires CreatedAtEndDate to be provided. |
| `createdAtEndDate` | string (date-time), nullable | no | Optional: The end of the date range to filter by clinical order CreatedAt. Requires CreatedAtStartDate to be provided. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `recordedOrderId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `ndcNumber` | string, nullable |  |
| `orderName` | string, nullable |  |
| `orderType` | string, nullable |  |
| `linkedRxOrderId` | string, nullable |  |
| `startDateTime` | string (date-time), nullable |  |
| `endDateTime` | string (date-time), nullable |  |
| `prescriberId` | integer (int64) |  |
| `prescriberName` | string, nullable |  |
| `instructions` | string, nullable |  |
| `frequency` | string, nullable |  |
| `serviceLevel` | string, nullable |  |
| `isSelfAdministered` | boolean |  |
| `schedulingStatus` | string, nullable |  |
| `route` | string, nullable |  |
| `orderStatus` | string, nullable |  |
| `orderTags` | string, nullable |  |
| `isNarcotic` | boolean |  |
| `isInjection` | boolean |  |
| `isControlled` | boolean |  |
| `isPatch` | boolean |  |
| `hasPainScale` | boolean |  |
| `prescriptionNumber` | string, nullable |  |
| `issuedOn` | string (date-time), nullable |  |
| `effectiveOn` | string (date-time), nullable |  |
| `renewOn` | string (date-time), nullable |  |
| `refillsLeft` | integer (int32), nullable |  |
| `refillOn` | string (date-time), nullable |  |
| `createdAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `startDateTime`, `endDateTime`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/clinical/vaccinations`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `vaccineId` | integer (int64) |  |
| `vaccineName` | string, nullable |  |
| `vaccinationStatus` | string, nullable |  |
| `vaccineConfigurationId` | string, nullable |  |
| `manufacturer` | string, nullable |  |
| `dose1AdministrationDate` | string (date-time), nullable |  |
| `dose1Status` | string, nullable |  |
| `dose1HadAdverseReaction` | string, nullable |  |
| `dose1AdverseReactionDetails` | string, nullable |  |
| `dose1ExpirationDate` | string (date-time), nullable |  |
| `dose1BatchNumber` | string, nullable |  |
| `dose1Notes` | string, nullable |  |
| `dose1AdministeredBy` | string, nullable |  |
| `dose1AdministeredClinic` | string, nullable |  |
| `dose2AdministrationDate` | string (date-time), nullable |  |
| `dose2Status` | string, nullable |  |
| `dose2HadAdverseReaction` | string, nullable |  |
| `dose2AdverseReactionDetails` | string, nullable |  |
| `dose2ExpirationDate` | string (date-time), nullable |  |
| `dose2BatchNumber` | string, nullable |  |
| `dose2Notes` | string, nullable |  |
| `dose2AdministeredBy` | string, nullable |  |
| `dose2AdministeredClinic` | string, nullable |  |
| `expectedDoseCount` | integer (int32) |  |
| `isCompleted` | boolean |  |

**Likely date fields for period filtering:** `dose1AdministrationDate`, `dose1ExpirationDate`, `dose2AdministrationDate`, `dose2ExpirationDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/clinical/vitalRecords`

DEPRECATED: Use '/v2/export/clinical/vitalRecords' instead

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `recordedVitalId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `byHour` | string, nullable |  |
| `vitalType` | string, nullable |  |
| `vitalTypeAbbreviation` | string, nullable |  |
| `vitalTypeMeasurement` | string, nullable |  |
| `value1` | number (double), nullable |  |
| `value2` | number (double), nullable |  |
| `recordTime` | string (date-time), nullable |  |
| `recordedBy` | integer (int64), nullable |  |

**Likely date fields for period filtering:** `recordTime`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/communities`

**Wired up as:** `getCommunities()` in `server/services/alisApiClient.js`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyId` | integer (int64) |  |
| `companyKey` | string, nullable |  |
| `companyName` | string, nullable |  |
| `companyUrl` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `city` | string, nullable |  |
| `state` | string, nullable |  |
| `zip` | string, nullable |  |
| `timeZone` | string, nullable |  |
| `region` | string, nullable |  |
| `status` | string, nullable |  |

**Likely date fields for period filtering:** `timeZone`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/contacts`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityID` | integer (int64) | no |  |
| `residentStatus` | string | no |  |
| `contactScope` | string | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `contactId` | integer (int64) |  |
| `contactName` | string, nullable |  |
| `contactFirstName` | string, nullable |  |
| `contactLastName` | string, nullable |  |
| `contactOrganization` | string, nullable |  |
| `contactType` | string, nullable |  |
| `isCommunityContact` | boolean |  |
| `contactScope` | string, nullable |  |
| `personId` | integer (int64), nullable |  |
| `personName` | string, nullable |  |
| `personProductType` | string, nullable |  |
| `personClassification` | string, nullable |  |
| `personStatus` | string, nullable |  |
| `contactHomePhone` | string, nullable |  |
| `contactWorkPhone` | string, nullable |  |
| `contactMobilePhone` | string, nullable |  |
| `contactFaxNumber` | string, nullable |  |
| `contactEmailAddress` | string, nullable |  |
| `contactStreet1` | string, nullable |  |
| `contactStreet2` | string, nullable |  |
| `contactCity` | string, nullable |  |
| `contactState` | string, nullable |  |
| `contactZipCode` | string, nullable |  |
| `contactPreference` | string, nullable |  |
| `contactPriority` | integer (int32) |  |
| `contactTags` | string, nullable |  |
| `contactNotes` | string, nullable |  |
| `contactWebsite` | string, nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `updatedAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `updatedAt`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/floorPlan`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `showDisabled` | boolean | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `unitNumber` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `primaryOccupantId` | integer (int32), nullable |  |
| `secondOccupantId` | integer (int32), nullable |  |
| `assignedToResidents` | string, nullable |  |
| `isDisabled` | boolean |  |
| `isOccupied` | boolean |  |
| `floorId` | integer (int32) |  |
| `floor` | string, nullable |  |
| `hall` | string, nullable |  |
| `category` | string, nullable |  |
| `type` | string, nullable |  |
| `size` | integer (int32), nullable |  |
| `marketRate` | number (double), nullable |  |
| `ceilingPrice` | number (double), nullable |  |
| `floorPrice` | number (double), nullable |  |
| `description` | string, nullable |  |
| `comments` | string, nullable |  |
| `effectiveDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `effectiveDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/floorPlan/hqOccupancies`

DEPRECATED: Use '/v2/export/communities/floorPlan/hqOccupancies' instead — alis-hub switched to v2 (Aug 2026); see that section below for the current wiring.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `monthAndYear` | string (date-time) | no |  |
| `communityId` | integer (int64) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `date` | string (date), nullable |  |
| `forecastStatus` | string, nullable |  |
| `companyId` | integer (int64) |  |
| `companyGuid` | string, nullable |  |
| `companyName` | string, nullable |  |
| `companyUrl` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `residentFirstName` | string, nullable |  |
| `residentLastName` | string, nullable |  |
| `residentRoom` | string, nullable |  |
| `residentCareLevel` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentNameLink` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `alisCommunityRegion` | string, nullable |  |
| `owner` | string, nullable |  |
| `region` | string, nullable |  |
| `state` | string, nullable |  |
| `city` | string, nullable |  |
| `zip` | string, nullable |  |
| `timeZone` | string, nullable |  |
| `moveInFromAddress` | string, nullable |  |
| `physicalMoveInDate` | string (date-time), nullable |  |
| `financialMoveInDate` | string (date), nullable |  |
| `financialMoveOutDate` | string (date), nullable |  |
| `physicalMoveOutDate` | string (date-time), nullable |  |
| `financialMoveOutDateNoHotel` | string (date-time), nullable |  |
| `moveOutDestination` | string, nullable |  |
| `roomId` | integer (int64) |  |
| `roomCategoryId` | integer (int64) |  |
| `unit` | string, nullable |  |
| `unitDisabled` | string, nullable |  |
| `floor` | string, nullable |  |
| `size` | integer (int64), nullable |  |
| `hall` | string, nullable |  |
| `type` | string, nullable |  |
| `rooms` | string, nullable |  |
| `unitDescription` | string, nullable |  |
| `censusValue` | integer (int64), nullable |  |
| `censusMoveIn` | string, nullable |  |
| `censusMoveOut` | integer (int64), nullable |  |
| `censusOcc` | integer (int64), nullable |  |
| `finCensusMoveIn` | integer (int64), nullable |  |
| `finCensusMoveOut` | integer (int64), nullable |  |
| `finCensusOcc` | integer (int64), nullable |  |
| `dataSet` | string, nullable |  |
| `doorNumber` | string, nullable |  |
| `doorknobValue` | number (float), nullable |  |
| `doorCapacity` | number (float), nullable |  |
| `roomChangeDate` | string (date-time), nullable |  |
| `priorDoorNumber` | string, nullable |  |
| `priorIsPrimary` | boolean, nullable |  |
| `priorRoomId` | integer (int64), nullable |  |
| `priorEndDate` | string (date-time), nullable |  |
| `priorBedNumber` | string, nullable |  |
| `priorProductType` | string, nullable |  |
| `priorClassification` | string, nullable |  |
| `priorRoomChangeDate` | string (date-time), nullable |  |
| `priorUnitCategory` | string, nullable |  |
| `isPrimary` | boolean, nullable |  |
| `primaryStatusChange` | integer (int64), nullable |  |
| `residentClassificationChangeDate` | string (date-time), nullable |  |
| `productType` | string, nullable |  |
| `isOnLeave` | boolean, nullable |  |
| `isTransfer` | boolean, nullable |  |
| `moveInType` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `classification` | string, nullable |  |
| `marketRate` | number (double), nullable |  |
| `category` | string, nullable |  |
| `categorySort` | integer (int64), nullable |  |
| `bedMoveIn` | number (float), nullable |  |
| `bedMoveOut` | number (float), nullable |  |
| `bedOcc` | number (float), nullable |  |
| `doorknobMoveIn` | number (float), nullable |  |
| `doorknobMoveOut` | number (float), nullable |  |
| `doorknobOcc` | number (float), nullable |  |
| `roomAssignmentRank` | integer (int64), nullable |  |
| `productTypeChangeDate` | string (date-time), nullable |  |
| `budget` | integer (int64), nullable |  |
| `partition` | string (date), nullable |  |
| `updatedFromAlis` | string (date-time), nullable |  |
| `partitionType` | string, nullable |  |
| `hotelRules` | string, nullable |  |
| `moveOutReason` | string, nullable |  |
| `roomAssignmentStartDate` | string (date-time), nullable |  |
| `roomAssignmentEndDate` | string (date-time), nullable |  |
| `numberOfRooms` | integer (int32), nullable |  |
| `lastRoom` | integer (int32), nullable |  |
| `occStatus` | string, nullable |  |
| `numberOfRoomAssignments` | integer (int32), nullable |  |
| `productTypeReportingLabel` | string, nullable |  |
| `expectedMoveOutReason` | string, nullable |  |
| `moveInFromDescription` | string, nullable |  |
| `bedCapacity` | number (float), nullable |  |
| `numberOfResidents` | integer (int32), nullable |  |
| `referralSourceName` | string, nullable |  |
| `referralType` | string, nullable |  |
| `referralOrganization` | string, nullable |  |
| `prospectSource` | string, nullable |  |
| `sourceCategory` | string, nullable |  |
| `effectiveDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `date`, `timeZone`, `physicalMoveInDate`, `financialMoveInDate`, `financialMoveOutDate`, `physicalMoveOutDate`, `financialMoveOutDateNoHotel`, `roomChangeDate`, `priorEndDate`, `priorRoomChangeDate`, `residentClassificationChangeDate`, `productTypeChangeDate`, `updatedFromAlis`, `roomAssignmentStartDate`, `roomAssignmentEndDate`, `effectiveDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/floorPlan/roomMarketRateChanges`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `unitNumber` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `marketRate` | number (double), nullable |  |
| `ceilingPrice` | number (double), nullable |  |
| `floorPrice` | number (double), nullable |  |
| `createdAt` | string (date-time) |  |
| `createdBy` | integer (int64) |  |

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/floorPlan/roomStays`

**Tested live (Sep 2026, not wired):** considered as a Current Census
source alongside historicalFloorPlan (its capacity counterpart), but its
"assignments active today" count came out lower than the plain
`getResidents()` count for the same account (678 vs. 705 at
"thecottages") — some current residents apparently aren't room-assigned
in ALIS. `getResidents()` remains the census source for the
historicalFloorPlan fallback tier in `accountHealthOccupancy.js`; this
endpoint wasn't worth wiring on its own.

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `assignedToResidentId` | integer (int64) |  |
| `unitNumber` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `occupantType` | string, nullable |  |
| `startDate` | string (date-time) |  |
| `endDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `startDate`, `endDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/floorPlan/unitOccupancies`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `monthAndYear` | string (date-time) | no |  |
| `communityId` | integer (int64) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `date` | string (date-time) |  |
| `companyID` | integer (int64) |  |
| `communityID` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `unit` | string, nullable |  |
| `doorNumber` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `unitType` | string, nullable |  |
| `unitCategory` | string, nullable |  |
| `size` | integer (int32), nullable |  |
| `marketRate` | number (double), nullable |  |
| `primaryDoorOccupancy` | integer (int32) |  |
| `primaryUnitOccupancy` | integer (int32) |  |
| `secondaryDoorOccupancy` | integer (int32) |  |
| `secondaryUnitOccupancy` | integer (int32) |  |
| `doorCapacity` | integer (int32) |  |
| `residentsAssignedCount` | integer (int32) |  |
| `primaryResident` | string, nullable |  |
| `primaryResidentID` | integer (int64), nullable |  |
| `primaryResidentStatus` | string, nullable |  |
| `primaryResidentProductType` | string, nullable |  |
| `primaryResidentClassification` | string, nullable |  |
| `primaryResidentCareLevel` | string, nullable |  |
| `primaryResidentCarePoints` | number (float), nullable |  |
| `primaryResidentFinancialMoveInDate` | string (date-time), nullable |  |
| `primaryResidentFinancialMoveOut` | string (date-time), nullable |  |
| `primaryResidentPhysicalMoveInDate` | string (date-time), nullable |  |
| `primaryResidentPhysicalMoveOutDate` | string (date-time), nullable |  |
| `secondaryResident` | string, nullable |  |
| `secondaryResidentID` | integer (int64), nullable |  |
| `secondaryResidentStatus` | string, nullable |  |
| `secondaryResidentProductType` | string, nullable |  |
| `secondaryResidentClassification` | string, nullable |  |
| `secondaryResidentCareLevel` | string, nullable |  |
| `secondaryResidentCarePoints` | number (float), nullable |  |
| `secondaryResidentFinancialMoveInDate` | string (date-time), nullable |  |
| `secondaryResidentFinancialMoveOut` | string (date-time), nullable |  |
| `secondaryResidentPhysicalMoveInDate` | string (date-time), nullable |  |
| `secondaryResidentPhysicalMoveOutDate` | string (date-time), nullable |  |
| `effectiveDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `date`, `primaryResidentFinancialMoveInDate`, `primaryResidentPhysicalMoveInDate`, `primaryResidentPhysicalMoveOutDate`, `secondaryResidentFinancialMoveInDate`, `secondaryResidentPhysicalMoveInDate`, `secondaryResidentPhysicalMoveOutDate`, `effectiveDate`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/communities/historicalFloorPlan`

**Wired up as:** `getHistoricalFloorPlan()` in `server/services/alisApiClient.js` — used as a Total Capacity fallback (accountHealthOccupancy.js) for accounts whose hqOccupancies pull is empty. This is a room INVENTORY log, not a snapshot — dedupe by (`communityId`, `roomId`) and filter to `!isDisabled` to get each community's current real room/bed count.

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyName` | string, nullable |  |
| `companyId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `createdAt` | string (date-time), nullable |  |
| `isDisabled` | boolean |  |
| `isInitial` | boolean |  |
| `roomId` | integer (int64) |  |
| `unit` | string, nullable |  |
| `doorNumber` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `floor` | string, nullable |  |
| `hall` | string, nullable |  |
| `category` | string, nullable |  |
| `type` | string, nullable |  |
| `size` | integer (int32), nullable |  |
| `description` | string, nullable |  |
| `comments` | string, nullable |  |
| `effectiveDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `effectiveDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/communities/productTypes`

Returns a list of Product Types for the authenticated user. Limited by company/community access

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no | The community identifier to filter product types by. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `productTypeId` | integer (int64) |  |
| `productTypeName` | string, nullable |  |
| `isDisabled` | boolean |  |

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/prospects`

DEPRECATED: Use '/v2/export/prospects' instead

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `communityState` | string, nullable |  |
| `prospectId` | integer (int64) |  |
| `externalCrmId` | string, nullable |  |
| `fullName` | string, nullable |  |
| `firstName` | string, nullable |  |
| `lastName` | string, nullable |  |
| `productType` | string, nullable |  |
| `referralSourceId` | integer (int64), nullable |  |
| `referralSourceName` | string, nullable |  |
| `referralOrganizationId` | integer (int64), nullable |  |
| `referralOrganization` | string, nullable |  |
| `referralType` | string, nullable |  |
| `prospectResidentId` | integer (int64), nullable |  |
| `inquiryDate` | string (date-time) |  |
| `prospectScore` | string, nullable |  |
| `prospectStage` | string, nullable |  |
| `street1` | string, nullable |  |
| `street2` | string, nullable |  |
| `city` | string, nullable |  |
| `state` | string, nullable |  |
| `zip` | string, nullable |  |
| `phoneNumber` | string, nullable |  |
| `email` | string, nullable |  |
| `mainContactFullName` | string, nullable |  |
| `mainContactStreet1` | string, nullable |  |
| `mainContactStreet2` | string, nullable |  |
| `mainContactCity` | string, nullable |  |
| `mainContactState` | string, nullable |  |
| `mainContactZip` | string, nullable |  |
| `mainContactPhoneNumber` | string, nullable |  |
| `mainContactEmail` | string, nullable |  |
| `mainContactContactPreference` | string, nullable |  |
| `marketingStatus` | string, nullable |  |
| `expectedMoveInDate` | string (date-time), nullable |  |
| `moveInDate` | string (date-time), nullable |  |
| `isLocked` | boolean |  |
| `assignedSalesAgentId` | integer (int64), nullable |  |
| `assignedAgentName` | string, nullable |  |
| `assignedAgentRole` | string, nullable |  |
| `prospectSource` | string, nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `lastUpdatedAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `inquiryDate`, `expectedMoveInDate`, `moveInDate`, `lastUpdatedAt`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/prospects/referralOrganizations`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `communityState` | string, nullable |  |
| `organizationId` | integer (int64) |  |
| `organizationName` | string, nullable |  |
| `referralType` | string, nullable |  |
| `street1` | string, nullable |  |
| `street2` | string, nullable |  |
| `city` | string, nullable |  |
| `state` | string, nullable |  |
| `zip` | string, nullable |  |
| `phoneNumber` | string, nullable |  |
| `emailAddress` | string, nullable |  |
| `notes` | string, nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `updatedAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `updatedAt`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/prospects/referralSources`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no |  |
| `isDisabled` | boolean | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `referralSourceId` | integer (int64) |  |
| `fullName` | string, nullable |  |
| `firstName` | string, nullable |  |
| `lastName` | string, nullable |  |
| `referralOrganizationId` | integer (int64), nullable |  |
| `referralOrganization` | string, nullable |  |
| `referralType` | string, nullable |  |
| `isDisabled` | boolean |  |
| `createdAt` | string (date-time), nullable |  |

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/prospects/tasks`

DEPRECATED: Use '/v2/export/prospects/tasks' instead

Returns a list of prospect tasks that the authenticated user has access to.
Limited by company/community access.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64), nullable | no | The community identifier to filter records by. |
| `localTaskDueAtStartDate` | string (date-time), nullable | no | Date used in date range to filter tasks by their due date. Must be supplied with LocalTaskDueAtEndDate |
| `localTaskDueAtEndDate` | string (date-time), nullable | no | Date used in date range to filter tasks by their due date. Must be supplied with LocalTaskDueAtStartDate |
| `isComplete` | boolean, nullable | no | Filters the tasks by whether they are completed or not. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `taskId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `prospectId` | integer (int64) |  |
| `prospectName` | string, nullable |  |
| `prospectProductType` | string, nullable |  |
| `referralSourceId` | integer (int64), nullable |  |
| `referralSourceName` | string, nullable |  |
| `taskType` | string, nullable |  |
| `taskDueAt` | string (date-time), nullable |  |
| `taskEstimatedTime` | integer (int64), nullable |  |
| `assignedToId` | integer (int64), nullable |  |
| `assigneeName` | string, nullable |  |
| `assigneeJobRole` | string, nullable |  |
| `isCompleted` | boolean |  |
| `completedById` | integer (int64), nullable |  |
| `completedByName` | string, nullable |  |
| `completedByJobRole` | string, nullable |  |
| `completedAt` | string (date-time), nullable |  |
| `TaskNote` | string, nullable |  |
| `taskOutcome` | string, nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `age` | integer (int32), nullable |  |

**Likely date fields for period filtering:** `taskEstimatedTime`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/residents`

**Wired up as:** `getResidents()` in `server/services/alisApiClient.js`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `status` | string | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `residentId` | integer (int64) |  |
| `fullName` | string, nullable |  |
| `firstName` | string, nullable |  |
| `lastName` | string, nullable |  |
| `email` | string, nullable |  |
| `mobilePhone` | string, nullable |  |
| `roomPhoneNumber` | string, nullable |  |
| `externalCrmRecordId` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `rooms` | string, nullable |  |
| `clientRecordNumber` | string, nullable |  |
| `productType` | string, nullable |  |
| `classification` | string, nullable |  |
| `age` | integer (int32), nullable |  |
| `gender` | string, nullable |  |
| `careLevelId` | integer (int64) |  |
| `careLevelName` | string, nullable |  |
| `careLevelPoints` | string, nullable |  |
| `careLevelFee` | string, nullable |  |
| `isActiveResident` | boolean |  |
| `isSecondOccupant` | boolean |  |
| `isOnLeave` | boolean |  |
| `isVeteran` | boolean |  |
| `maritalStatus` | string, nullable |  |
| `religion` | string, nullable |  |
| `dob` | string, nullable |  |
| `productTypeId` | integer (int64), nullable |  |

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/residents/complianceDetails`

Returns a paged list of resident compliance details for the authenticated user. Limited by company/community access

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |
| `residentStatus` | string, nullable | no | Optional: Resident status to filter the compliance items by. |
| `includeExpired` | boolean | no | Optional: Filter to include expired compliance items. True by default |
| `includeArchived` | boolean | no | Optional: Filter to include previously applicable compliance items. False by default |
| `includeRetired` | boolean | no | Optional: Filter to include retired compliance items. False by default |
| `expiresOnStartDate` | string (date-time), nullable | no | Optional: Date to filter expired compliance items by. Requires ExpiresOnEndDate to be present. |
| `expiresOnEndDate` | string (date-time), nullable | no | Optional: Date to filter expired compliance items by. Requires ExpiresOnStartDate to be present. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyId` | integer (int64) |  |
| `companyTextKey` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentFirstName` | string, nullable |  |
| `residentLastName` | string, nullable |  |
| `residentStatusId` | integer (int64) |  |
| `residentStatus` | string, nullable |  |
| `complianceItemId` | integer (int64) |  |
| `name` | string, nullable |  |
| `isOptional` | boolean |  |
| `status` | string, nullable |  |
| `expiresOn` | string (date-time), nullable |  |
| `group` | string, nullable |  |
| `isRetired` | boolean |  |
| `inCabinet` | boolean |  |
| `lastUpdated` | string (date-time), nullable |  |
| `latestFormId` | integer (int64), nullable |  |
| `latestFormDisposition` | string, nullable |  |

**Likely date fields for period filtering:** `lastUpdated`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/residents/evaluations`

**Wired up as:** `getEvaluations()` in `server/services/alisApiClient.js`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `status` | string, nullable |  |
| `completedAt` | string (date-time), nullable |  |
| `completedBy` | integer (int64), nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `createdBy` | integer (int64), nullable |  |
| `evaluationDate` | string (date-time), nullable |  |
| `residentEvaluationID` | integer (int64) |  |
| `evaluationConfigurationID` | integer (int64) |  |
| `careLevel` | string, nullable |  |
| `carePlanStatus` | string, nullable |  |
| `carePoints` | number (double), nullable |  |
| `carePackages` | string, nullable |  |
| `carePackagesCost` | number (double) |  |
| `fee` | number (double) |  |
| `preOverrideCareLevel` | string, nullable |  |
| `preOverrideFee` | number (double), nullable |  |
| `reason` | string, nullable |  |
| `expirationDate` | string (date-time), nullable |  |
| `impact` | string, nullable |  |
| `isMostCurrent` | boolean |  |
| `isCompleted` | boolean |  |
| `isExpired` | boolean |  |
| `isImported` | boolean |  |
| `isInProgress` | boolean |  |
| `isSigned` | boolean |  |

**Likely date fields for period filtering:** `evaluationDate`, `expirationDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/residents/evaluations/xmlDocuments`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `status` | string | no |  |
| `sinceEvaluationDate` | string (date-time) | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `retId` | integer (int64) |  |
| `evaluationDate` | string (date-time) |  |
| `retReason` | string, nullable |  |
| `retConfigurationId` | integer (int64) |  |
| `retName` | string, nullable |  |
| `retVersion` | integer (int32) |  |
| `retXml` | string, nullable |  |

**Likely date fields for period filtering:** `evaluationDate`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/residents/historicalMoveInMoveOuts`

**Wired up as:** `getHistoricalMoveInMoveOuts()` in `server/services/alisApiClient.js`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentStayId` | integer (int64), nullable |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `residentGender` | string, nullable |  |
| `physicalMoveInDate` | string (date-time) |  |
| `financialMoveInDate` | string (date-time), nullable |  |
| `moveInFromDescription` | string, nullable |  |
| `moveInFromAddress` | string, nullable |  |
| `moveInFromCounty` | string, nullable |  |
| `moveInType` | string, nullable |  |
| `previouslyLivedIn` | string, nullable |  |
| `previouslyLivedWith` | string, nullable |  |
| `isHeadOfHousehold` | string, nullable |  |
| `householdIncome` | string, nullable |  |
| `numPeopleInHousehold` | string, nullable |  |
| `expectedMoveOutDate` | string (date-time), nullable |  |
| `physicalMoveOutDate` | string (date-time), nullable |  |
| `financialMoveOutDate` | string (date-time), nullable |  |
| `moveOutDestinationId` | integer (int64), nullable |  |
| `moveOutDestination` | string, nullable |  |
| `moveOutDestinationAddress` | string, nullable |  |
| `moveOutDestinationCounty` | string, nullable |  |
| `moveOutReasonId` | integer (int64), nullable |  |
| `moveOutReason` | string, nullable |  |

**Likely date fields for period filtering:** `physicalMoveInDate`, `financialMoveInDate`, `expectedMoveOutDate`, `physicalMoveOutDate`, `financialMoveOutDate`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/residents/incidents`

**Wired up as:** `getIncidents()` in `server/services/alisApiClient.js`

DEPRECATED: Use '/v2/export/residents/incidents' instead

Returns a list of incidents that the authenticated user has access to.
Limited by company/community access.

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentFullName` | string, nullable |  |
| `roomNumber` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `productType` | string, nullable |  |
| `classification` | string, nullable |  |
| `incidentId` | integer (int64) |  |
| `status` | string, nullable |  |
| `isComplete` | boolean |  |
| `createdBy` | string, nullable |  |
| `createdById` | integer (int64) |  |
| `incidentDateTime` | string (date-time) |  |
| `incidentType` | string, nullable |  |
| `incidentLocation` | string, nullable |  |
| `incidentSummary` | string, nullable |  |
| `completedForms` | integer (int32) |  |
| `completedTasks` | integer (int32) |  |
| `incompleteForms` | integer (int32) |  |
| `incompleteTasks` | integer (int32) |  |

**Likely date fields for period filtering:** `incidentDateTime`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/residents/incidents/{incidentId}/formData`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `incidentId` | integer (int64) | yes |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `incidentId` | integer (int64) |  |
| `formName` | string, nullable |  |
| `updatedAt` | string (date-time), nullable |  |
| `data` | string, nullable |  |

**Likely date fields for period filtering:** `updatedAt`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/residents/insurances`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64) | no |  |
| `residentStatus` | string | no |  |
| `insuranceStatus` | string | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `providerName` | string, nullable |  |
| `insuranceType` | string, nullable |  |
| `isDisabled` | boolean |  |
| `accountNumber` | string, nullable |  |
| `groupNumber` | string, nullable |  |
| `effectiveDate` | string (date-time) |  |
| `endDate` | string (date-time) |  |
| `providerPhoneNumber` | string, nullable |  |
| `emergencyPhoneNumber` | string, nullable |  |
| `employer` | string, nullable |  |
| `isPrimary` | boolean |  |

**Likely date fields for period filtering:** `effectiveDate`, `endDate`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/residents/leaves`

**Wired up as:** `getLeaves()` in `server/services/alisApiClient.js`

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `status` | string | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `leaveId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `leaveDestination` | string, nullable |  |
| `isComplete` | boolean |  |
| `leaveStatus` | string, nullable |  |
| `startDateTime` | string (date-time) |  |
| `scheduledEndDateTime` | string (date-time), nullable |  |
| `actualEndDateTime` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `startDateTime`, `scheduledEndDateTime`, `actualEndDateTime`

[↑ back to index](#index)

---

## ✅ `GET /v1/export/residents/moveInsAndOuts`

**Wired up as:** `getMoveInsAndOuts()` in `server/services/alisApiClient.js`

Returns a list containing resident move in and move out information. Limited by company/community access

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `residentGender` | string, nullable |  |
| `physicalMoveInDate` | string (date-time) |  |
| `financialMoveInDate` | string (date-time), nullable |  |
| `moveInFromDescription` | string, nullable |  |
| `moveInFromAddress` | string, nullable |  |
| `moveInFromCounty` | string, nullable |  |
| `moveInType` | string, nullable |  |
| `previouslyLivedIn` | string, nullable |  |
| `previouslyLivedWith` | string, nullable |  |
| `isHeadOfHousehold` | string, nullable |  |
| `householdIncome` | string, nullable |  |
| `numPeopleInHousehold` | string, nullable |  |
| `expectedMoveOutDate` | string (date-time), nullable |  |
| `physicalMoveOutDate` | string (date-time), nullable |  |
| `financialMoveOutDate` | string (date-time), nullable |  |
| `moveOutDestinationId` | integer (int64), nullable |  |
| `moveOutDestination` | string, nullable |  |
| `moveOutDestinationAddress` | string, nullable |  |
| `moveOutDestinationCounty` | string, nullable |  |
| `moveOutReasonId` | integer (int64), nullable |  |
| `moveOutReason` | string, nullable |  |

**Likely date fields for period filtering:** `physicalMoveInDate`, `financialMoveInDate`, `expectedMoveOutDate`, `physicalMoveOutDate`, `financialMoveOutDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/residents/observations`

DEPRECATED: Use '/v2/export/residents/observations' instead

Returns a list of observations that the authenticated user has access to.
Limited by company/community access.

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `observationId` | integer (int64) |  |
| `companyGuid` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64), nullable |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `observationType` | string, nullable |  |
| `observationText` | string, nullable |  |
| `severity` | string, nullable |  |
| `occurredOn` | string (date-time) |  |
| `createdAt` | string (date-time) |  |
| `expiresAt` | string (date-time), nullable |  |
| `recordedBy` | integer (int64), nullable |  |
| `status` | string, nullable |  |

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/residents/productTypeChanges`

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `residentId` | integer (int64) |  |
| `oldProductType` | string, nullable |  |
| `newProductType` | string, nullable |  |
| `createdAt` | string (date-time) |  |

[↑ back to index](#index)

---

## ✅ `GET /v1/export/staff`

**Wired up as:** `getStaff()` in `server/services/alisApiClient.js`

Returns a list of staff for the authenticated user. Limited by company/community access

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `staffId` | integer (int64) |  |
| `dateOfBirth` | string (date-time), nullable |  |
| `dateOfHire` | string (date-time), nullable |  |
| `staffRecordNumber` | string, nullable |  |
| `firstName` | string, nullable |  |
| `lastName` | string, nullable |  |
| `isActive` | boolean |  |
| `isLoginEnabled` | boolean |  |
| `jobRole` | string, nullable |  |
| `status` | string, nullable |  |
| `loginTime` | string (date-time), nullable |  |
| `loginIPAddress` | string, nullable |  |
| `securityRoles` | string[] |  |
| `dischargedDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `dateOfBirth`, `dateOfHire`, `loginTime`, `dischargedDate`

[↑ back to index](#index)

---

## ⬜ `GET /v1/export/staff/complianceDetails`

Returns a paged list of staff compliance details for the authenticated user. Limited by company/community access

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |
| `staffStatus` | string, nullable | no | Optional: Staff status to filter the compliance items by. |
| `includeExpired` | boolean | no | Optional: Filter to include expired compliance items. True by default |
| `expiresOnStartDate` | string (date-time), nullable | no | Optional: Date to filter expired compliance items by. Requires ExpiresOnEndDate to be present. |
| `expiresOnEndDate` | string (date-time), nullable | no | Optional: Date to filter expired compliance items by. Requires ExpiresOnStartDate to be present. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyId` | integer (int32) |  |
| `companyTextKey` | string, nullable |  |
| `communityId` | integer (int32) |  |
| `communityName` | string, nullable |  |
| `staffId` | integer (int64) |  |
| `staffFirstName` | string, nullable |  |
| `staffLastName` | string, nullable |  |
| `jobRole` | string, nullable |  |
| `staffStatusId` | integer (int32) |  |
| `staffStatus` | string, nullable |  |
| `complianceItemId` | integer (int64) |  |
| `name` | string, nullable |  |
| `isOptional` | boolean |  |
| `status` | string, nullable |  |
| `expiresOn` | string (date-time), nullable |  |
| `group` | string, nullable |  |
| `isRetired` | boolean |  |
| `inCabinet` | boolean |  |
| `lastUpdated` | string (date-time), nullable |  |
| `latestFormId` | integer (int64) |  |
| `latestFormDisposition` | string, nullable |  |

**Likely date fields for period filtering:** `lastUpdated`

[↑ back to index](#index)

---

## V2 Index

- ⬜ [`/v2/export/billing/glTransactions`](#v2v2exportbillinggltransactions)
- ✅ [`/v2/export/billing/invoiceCharges`](#v2v2exportbillinginvoicecharges) — `getInvoiceCharges()`
- ⬜ [`/v2/export/care/recordedCare`](#v2v2exportcarerecordedcare)
- ⬜ [`/v2/export/clinical/orderAdministration`](#v2v2exportclinicalorderadministration)
- ⬜ [`/v2/export/clinical/orders`](#v2v2exportclinicalorders)
- ⬜ [`/v2/export/clinical/vitalRecords`](#v2v2exportclinicalvitalrecords)
- ✅ [`/v2/export/communities/floorPlan/hqOccupancies`](#v2v2exportcommunitiesfloorplanhqoccupancies) — `getOccupancy()`
- ⬜ [`/v2/export/prospects`](#v2v2exportprospects)
- ⬜ [`/v2/export/prospects/tasks`](#v2v2exportprospectstasks)
- ⬜ [`/v2/export/residents/complianceDetails`](#v2v2exportresidentscompliancedetails)
- ⬜ [`/v2/export/residents/evaluations`](#v2v2exportresidentsevaluations)
- ⬜ [`/v2/export/residents/incidents`](#v2v2exportresidentsincidents)
- ⬜ [`/v2/export/residents/leaves`](#v2v2exportresidentsleaves)
- ⬜ [`/v2/export/residents/observations`](#v2v2exportresidentsobservations)

---

## ⬜ `GET /v2/export/billing/glTransactions`

Returns a paged response of GL transactions for the authenticated user within the specified
            month and year. Limited by company/community access

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |
| `monthAndYear` | string (date-time), nullable | no | The month and year to filter transactions by. Defaults to current month and year. |
| `communityId` | integer (int64), nullable | no | The community identifier to filter transactions by. |
| `payerType` | string, nullable | no | The payer type to filter transactions by. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | string, nullable |  |
| `communityName` | string, nullable |  |
| `communityState` | string, nullable |  |
| `residentId` | string, nullable |  |
| `residentFullName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `glDate` | string, nullable |  |
| `txnNumber` | string, nullable |  |
| `glAccountNumber` | string, nullable |  |
| `payerType` | string, nullable |  |
| `action` | string, nullable |  |
| `debitAmount` | string, nullable |  |
| `creditAmount` | string, nullable |  |
| `class` | string, nullable |  |
| `item` | string, nullable |  |
| `dept` | string, nullable |  |
| `isExported` | string, nullable |  |
| `createdAt` | string, nullable |  |

**Likely date fields for period filtering:** `glDate`

[↑ back to index](#index)

---

## ✅ `GET /v2/export/billing/invoiceCharges`

**Wired up as:** `getInvoiceCharges()` in `server/services/alisApiClient.js`

[STREAMING] Export invoice charge records.

Returns a streamed list of invoice charge line items including payer type, item details, pricing, and discount information.
Results are filtered by the authenticated user's company and facility access.


Query Parameters:InvoiceStartDate: The start of the date range to filter by invoice date. Defaults to the first day of the current month. Requires InvoiceEndDate to be provided. Date range cannot exceed 1 month.InvoiceEndDate: The end of the date range to filter by invoice date. Defaults to the last day of the current month. Requires InvoiceStartDate to be provided. Date range cannot exceed 1 month.Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `invoiceStartDate` | string (date-time), nullable | no | The start of the date range to filter by invoice date. Defaults to the first day of the current month. Requires InvoiceEndDate to be provided. Date range cannot exceed 1 month. |
| `invoiceEndDate` | string (date-time), nullable | no | The end of the date range to filter by invoice date. Defaults to the last day of the current month. Requires InvoiceStartDate to be provided. Date range cannot exceed 1 month. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `productTypeId` | integer (int64) |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `invoiceId` | integer (int64) |  |
| `invoiceNumber` | integer (int32) |  |
| `invoiceDate` | string (date-time) |  |
| `payerType` | string, nullable |  |
| `type` | string, nullable |  |
| `itemName` | string, nullable |  |
| `itemDescription` | string, nullable |  |
| `unitPrice` | number (double), nullable |  |
| `quantity` | integer (int32), nullable |  |
| `discountPercent` | number (float), nullable |  |
| `discountAmount` | number (double), nullable |  |
| `amount` | number (double) |  |

**Likely date fields for period filtering:** `invoiceDate`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/care/recordedCare`

Returns a paged list of recorded care for residents that the authenticated user has access to.
Utilizes the provided date range to filter data.
If either of the dates are not provided the date range will default to the current month.
Search is limited to 1 month of data.
Limited by company/community access.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |
| `careStartDate` | string (date-time), nullable | no | Date used in date range to filter records by. |
| `careEndDate` | string (date-time), nullable | no | Date used in date range to filter records by. |
| `communityId` | integer (int64), nullable | no | The community identifier to filter records by. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `recordedCareId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `byHour` | string, nullable |  |
| `byShift` | string, nullable |  |
| `byWeekDay` | string, nullable |  |
| `byWeekNo` | string, nullable |  |
| `careDate` | string (date-time), nullable |  |
| `careTime` | string (date-time), nullable |  |
| `careItemName` | string, nullable |  |
| `careItemCategory` | string, nullable |  |
| `careListName` | string, nullable |  |
| `careListGroup` | string, nullable |  |
| `isCareNotRecorded` | boolean |  |
| `isPrnCare` | boolean |  |
| `assignedToID` | integer (int64), nullable |  |
| `recordedByID` | integer (int64), nullable |  |
| `recordedDateTime` | string (date-time), nullable |  |
| `reportingLabel` | string, nullable |  |
| `outcomeText` | string, nullable |  |
| `outcomeNotes` | string, nullable |  |
| `timeEstimated` | integer (int32) |  |
| `timeTaken` | integer (int32) |  |

**Likely date fields for period filtering:** `careDate`, `careTime`, `recordedDateTime`, `timeEstimated`, `timeTaken`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/clinical/orderAdministration`

Returns a paged list medication administration records including scheduled times, pass/refuse status, and recorder information.
Results are filtered by the authenticated user's company and facility access.


Query Parameters:StartDate: The start of the date range to filter records. Defaults to the first day of the current month. Requires EndDate to be provided.EndDate: The end of the date range to filter records. Defaults to the last day of the current month. Requires StartDate to be provided.CommunityId: Optional filter to retrieve records for a specific community.PageNumber: The page number to retrieve. Defaults to 1.PageSize: The number of records per page. Defaults to 10.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number to retrieve. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of records per page. Defaults to 10. |
| `communityId` | integer (int64), nullable | no | Optional: Filter to retrieve records for a specific community. |
| `startDate` | string (date-time), nullable | no | The start of the date range to filter records. Defaults to the first day of the current month. Requires EndDate to be provided. |
| `endDate` | string (date-time), nullable | no | The end of the date range to filter records. Defaults to the last day of the current month. Requires StartDate to be provided. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `orderId` | integer (int64) |  |
| `orderName` | string, nullable |  |
| `orderType` | string, nullable |  |
| `scheduledDate` | string (date-time), nullable |  |
| `scheduledTime` | string (date-time), nullable |  |
| `passedTime` | string (date-time), nullable |  |
| `byShift` | string, nullable |  |
| `byHour` | string (date-time), nullable |  |
| `exceptionReason` | string, nullable |  |
| `adminNote` | string, nullable |  |
| `doseAdministered` | string, nullable |  |
| `isPrn` | boolean, nullable |  |
| `isNotRecorded` | boolean, nullable |  |
| `status` | string, nullable |  |
| `statusNote` | string, nullable |  |
| `recordedBy` | integer (int64) |  |
| `recorderName` | string, nullable |  |
| `recorderRole` | string, nullable |  |

**Likely date fields for period filtering:** `scheduledDate`, `scheduledTime`, `passedTime`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/clinical/orders`

[STREAMING] Export clinical order records.

Returns a streamed list of clinical order records including medication details, prescriber information, scheduling status, and refill information.
Results are filtered by the authenticated user's company and community access.


Query Parameters:CreatedAtStartDate: Optional. The start of the date range to filter by clinical order CreatedAt. Defaults to the first day of the current month. Requires CreatedAtEndDate to be provided. Date range cannot exceed 1 month.CreatedAtEndDate: Optional. The end of the date range to filter by clinical order CreatedAt. Defaults to the last day of the current month. Requires CreatedAtStartDate to be provided. Date range cannot exceed 1 month.Status: Optional filter to retrieve orders in a specific status (Active or Discontinued).Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `status` | string, nullable | no | Optional: Filter to retrieve orders in a specific status (Active or Discontinued). |
| `createdAtStartDate` | string (date-time), nullable | no | Optional: The start of the date range to filter by clinical order CreatedAt. Defaults to the first day of the current month. Requires CreatedAtEndDate to be provided. Date range cannot exceed 1 month. |
| `createdAtEndDate` | string (date-time), nullable | no | Optional: The end of the date range to filter by clinical order CreatedAt. Defaults to the last day of the current month. Requires CreatedAtStartDate to be provided. Date range cannot exceed 1 month. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `recordedOrderId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `ndcNumber` | string, nullable |  |
| `orderName` | string, nullable |  |
| `orderType` | string, nullable |  |
| `linkedRxOrderId` | string, nullable |  |
| `startDateTime` | string (date-time), nullable |  |
| `endDateTime` | string (date-time), nullable |  |
| `prescriberId` | integer (int64) |  |
| `prescriberName` | string, nullable |  |
| `instructions` | string, nullable |  |
| `frequency` | string, nullable |  |
| `serviceLevel` | string, nullable |  |
| `isSelfAdministered` | boolean |  |
| `schedulingStatus` | string, nullable |  |
| `route` | string, nullable |  |
| `orderStatus` | string, nullable |  |
| `orderTags` | string, nullable |  |
| `isNarcotic` | boolean |  |
| `isInjection` | boolean |  |
| `isControlled` | boolean |  |
| `isPatch` | boolean |  |
| `hasPainScale` | boolean |  |
| `prescriptionNumber` | string, nullable |  |
| `issuedOn` | string (date-time), nullable |  |
| `effectiveOn` | string (date-time), nullable |  |
| `renewOn` | string (date-time), nullable |  |
| `refillsLeft` | integer (int32), nullable |  |
| `refillOn` | string (date-time), nullable |  |
| `createdAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `startDateTime`, `endDateTime`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/clinical/vitalRecords`

[STREAMING] Export recorded vital records.

Returns a streamed list of vital record entries including vital type, measured values, and record timestamps.
Results are filtered by the authenticated user's company and community access.


Query Parameters:RecordTimeStartDate: Optional. The start of the date range to filter by vital record RecordTime. Defaults to the first day of the current month. Requires RecordTimeEndDate to be provided. Date range cannot exceed 1 month.RecordTimeEndDate: Optional. The end of the date range to filter by vital record RecordTime. Defaults to the last day of the current month. Requires RecordTimeStartDate to be provided. Date range cannot exceed 1 month.Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `recordTimeStartDate` | string (date-time), nullable | no | Optional: The start of the date range to filter by vital record RecordTime. Defaults to the first day of the current month. Requires RecordTimeEndDate to be provided. Date range cannot exceed 1 month. |
| `recordTimeEndDate` | string (date-time), nullable | no | Optional: The end of the date range to filter by vital record RecordTime. Defaults to the last day of the current month. Requires RecordTimeStartDate to be provided. Date range cannot exceed 1 month. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `recordedVitalId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `byHour` | string, nullable |  |
| `vitalType` | string, nullable |  |
| `vitalTypeAbbreviation` | string, nullable |  |
| `vitalTypeMeasurement` | string, nullable |  |
| `value1` | number (double), nullable |  |
| `value2` | number (double), nullable |  |
| `recordTime` | string (date-time), nullable |  |
| `recordedBy` | integer (int64), nullable |  |

**Likely date fields for period filtering:** `recordTime`

[↑ back to index](#index)

---

## ✅ `GET /v2/export/communities/floorPlan/hqOccupancies`

**Wired up as:** `getOccupancy()` in `server/services/alisApiClient.js` — paginated (auto-loops on `hasNextPage`, `pageSize: 5000`), confirmed field-for-field identical to v1 for the same community/month.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no |  |
| `pageSize` | integer (int32) | no |  |
| `monthAndYear` | string (date-time), nullable | no |  |
| `communityId` | integer (int64), nullable | no |  |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `date` | string (date), nullable |  |
| `forecastStatus` | string, nullable |  |
| `companyId` | integer (int64) |  |
| `companyGuid` | string, nullable |  |
| `companyName` | string, nullable |  |
| `companyUrl` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `residentFirstName` | string, nullable |  |
| `residentLastName` | string, nullable |  |
| `residentRoom` | string, nullable |  |
| `residentCareLevel` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentNameLink` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `alisCommunityRegion` | string, nullable |  |
| `owner` | string, nullable |  |
| `region` | string, nullable |  |
| `state` | string, nullable |  |
| `city` | string, nullable |  |
| `zip` | string, nullable |  |
| `timeZone` | string, nullable |  |
| `moveInFromAddress` | string, nullable |  |
| `physicalMoveInDate` | string (date-time), nullable |  |
| `financialMoveInDate` | string (date), nullable |  |
| `financialMoveOutDate` | string (date), nullable |  |
| `physicalMoveOutDate` | string (date-time), nullable |  |
| `financialMoveOutDateNoHotel` | string (date-time), nullable |  |
| `moveOutDestination` | string, nullable |  |
| `roomId` | integer (int64) |  |
| `roomCategoryId` | integer (int64) |  |
| `unit` | string, nullable |  |
| `unitDisabled` | string, nullable |  |
| `floor` | string, nullable |  |
| `size` | integer (int64), nullable |  |
| `hall` | string, nullable |  |
| `type` | string, nullable |  |
| `rooms` | string, nullable |  |
| `unitDescription` | string, nullable |  |
| `censusValue` | integer (int64), nullable |  |
| `censusMoveIn` | string, nullable |  |
| `censusMoveOut` | integer (int64), nullable |  |
| `censusOcc` | integer (int64), nullable |  |
| `finCensusMoveIn` | integer (int64), nullable |  |
| `finCensusMoveOut` | integer (int64), nullable |  |
| `finCensusOcc` | integer (int64), nullable |  |
| `dataSet` | string, nullable |  |
| `doorNumber` | string, nullable |  |
| `doorknobValue` | number (float), nullable |  |
| `doorCapacity` | number (float), nullable |  |
| `roomChangeDate` | string (date-time), nullable |  |
| `priorDoorNumber` | string, nullable |  |
| `priorIsPrimary` | boolean, nullable |  |
| `priorRoomId` | integer (int64), nullable |  |
| `priorEndDate` | string (date-time), nullable |  |
| `priorBedNumber` | string, nullable |  |
| `priorProductType` | string, nullable |  |
| `priorClassification` | string, nullable |  |
| `priorRoomChangeDate` | string (date-time), nullable |  |
| `priorUnitCategory` | string, nullable |  |
| `isPrimary` | boolean, nullable |  |
| `primaryStatusChange` | integer (int64), nullable |  |
| `residentClassificationChangeDate` | string (date-time), nullable |  |
| `productType` | string, nullable |  |
| `isOnLeave` | boolean, nullable |  |
| `isTransfer` | boolean, nullable |  |
| `moveInType` | string, nullable |  |
| `bedNumber` | string, nullable |  |
| `classification` | string, nullable |  |
| `marketRate` | number (double), nullable |  |
| `category` | string, nullable |  |
| `categorySort` | integer (int64), nullable |  |
| `bedMoveIn` | number (float), nullable |  |
| `bedMoveOut` | number (float), nullable |  |
| `bedOcc` | number (float), nullable |  |
| `doorknobMoveIn` | number (float), nullable |  |
| `doorknobMoveOut` | number (float), nullable |  |
| `doorknobOcc` | number (float), nullable |  |
| `roomAssignmentRank` | integer (int64), nullable |  |
| `productTypeChangeDate` | string (date-time), nullable |  |
| `budget` | integer (int64), nullable |  |
| `partition` | string (date), nullable |  |
| `updatedFromAlis` | string (date-time), nullable |  |
| `partitionType` | string, nullable |  |
| `hotelRules` | string, nullable |  |
| `moveOutReason` | string, nullable |  |
| `roomAssignmentStartDate` | string (date-time), nullable |  |
| `roomAssignmentEndDate` | string (date-time), nullable |  |
| `numberOfRooms` | integer (int32), nullable |  |
| `lastRoom` | integer (int32), nullable |  |
| `occStatus` | string, nullable |  |
| `numberOfRoomAssignments` | integer (int32), nullable |  |
| `productTypeReportingLabel` | string, nullable |  |
| `expectedMoveOutReason` | string, nullable |  |
| `moveInFromDescription` | string, nullable |  |
| `bedCapacity` | number (float), nullable |  |
| `numberOfResidents` | integer (int32), nullable |  |
| `referralSourceName` | string, nullable |  |
| `referralType` | string, nullable |  |
| `referralOrganization` | string, nullable |  |
| `prospectSource` | string, nullable |  |
| `sourceCategory` | string, nullable |  |
| `effectiveDate` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `date`, `timeZone`, `physicalMoveInDate`, `financialMoveInDate`, `financialMoveOutDate`, `physicalMoveOutDate`, `financialMoveOutDateNoHotel`, `roomChangeDate`, `priorEndDate`, `priorRoomChangeDate`, `residentClassificationChangeDate`, `productTypeChangeDate`, `updatedFromAlis`, `roomAssignmentStartDate`, `roomAssignmentEndDate`, `effectiveDate`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/prospects`

[STREAMING] Export prospect records.

Returns a streamed list of prospect records including contact details, referral information, and assigned agent details.
Results are filtered by the authenticated user's company and community access.


Query Parameters:CommunityId: Optional filter to retrieve prospects for a specific community.CreatedAtStartDate / CreatedAtEndDate: Optional date range to filter by prospect CreatedAt. If either is provided, both must be provided. Date range cannot exceed 3 months.InquiryStartDate / InquiryEndDate: Optional date range to filter by prospect InquiryDate. If either is provided, both must be provided. Date range cannot exceed 3 months.Defaulting: if no date bounds are provided on either range, the CreatedAt range defaults to the current month. If any date bound is provided (on either range), no defaulting occurs and only the explicitly-provided ranges apply. When both ranges are provided, both filters apply (AND).


Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `communityId` | integer (int64), nullable | no | Optional: Filter to retrieve prospects for a specific community. |
| `createdAtStartDate` | string (date-time), nullable | no | Optional: The start of the date range to filter by prospect CreatedAt. Requires CreatedAtEndDate to be provided. Date range cannot exceed 3 months. If no date range (CreatedAt or InquiryDate) is provided, defaults to the current month on CreatedAt. |
| `createdAtEndDate` | string (date-time), nullable | no | Optional: The end of the date range to filter by prospect CreatedAt. Requires CreatedAtStartDate to be provided. Date range cannot exceed 3 months. If no date range (CreatedAt or InquiryDate) is provided, defaults to the current month on CreatedAt. |
| `inquiryStartDate` | string (date-time), nullable | no | Optional: The start of the date range to filter by prospect InquiryDate. Requires InquiryEndDate to be provided. Date range cannot exceed 3 months. |
| `inquiryEndDate` | string (date-time), nullable | no | Optional: The end of the date range to filter by prospect InquiryDate. Requires InquiryStartDate to be provided. Date range cannot exceed 3 months. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `communityState` | string, nullable |  |
| `prospectId` | integer (int64) |  |
| `externalCrmId` | string, nullable |  |
| `fullName` | string, nullable |  |
| `firstName` | string, nullable |  |
| `lastName` | string, nullable |  |
| `productType` | string, nullable |  |
| `referralSourceId` | integer (int64), nullable |  |
| `referralSourceName` | string, nullable |  |
| `referralOrganizationId` | integer (int64), nullable |  |
| `referralOrganization` | string, nullable |  |
| `referralType` | string, nullable |  |
| `prospectResidentId` | integer (int64), nullable |  |
| `inquiryDate` | string (date-time) |  |
| `prospectScore` | string, nullable |  |
| `prospectStage` | string, nullable |  |
| `street1` | string, nullable |  |
| `street2` | string, nullable |  |
| `city` | string, nullable |  |
| `state` | string, nullable |  |
| `zip` | string, nullable |  |
| `phoneNumber` | string, nullable |  |
| `email` | string, nullable |  |
| `mainContactFullName` | string, nullable |  |
| `mainContactStreet1` | string, nullable |  |
| `mainContactStreet2` | string, nullable |  |
| `mainContactCity` | string, nullable |  |
| `mainContactState` | string, nullable |  |
| `mainContactZip` | string, nullable |  |
| `mainContactPhoneNumber` | string, nullable |  |
| `mainContactEmail` | string, nullable |  |
| `mainContactContactPreference` | string, nullable |  |
| `marketingStatus` | string, nullable |  |
| `expectedMoveInDate` | string (date-time), nullable |  |
| `moveInDate` | string (date-time), nullable |  |
| `isLocked` | boolean |  |
| `assignedSalesAgentId` | integer (int64), nullable |  |
| `assignedAgentName` | string, nullable |  |
| `assignedAgentRole` | string, nullable |  |
| `prospectSource` | string, nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `lastUpdatedAt` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `inquiryDate`, `expectedMoveInDate`, `moveInDate`, `lastUpdatedAt`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/prospects/tasks`

Returns a paged list of prospect tasks that the authenticated user has access to.
Limited by company/community access.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |
| `communityId` | integer (int64), nullable | no | The community identifier to filter records by. |
| `localTaskDueAtStartDate` | string (date-time), nullable | no | Date used in date range to filter tasks by their due date. Must be supplied with LocalTaskDueAtEndDate |
| `localTaskDueAtEndDate` | string (date-time), nullable | no | Date used in date range to filter tasks by their due date. Must be supplied with LocalTaskDueAtStartDate |
| `isComplete` | boolean, nullable | no | Filters the tasks by whether they are completed or not. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `taskId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `prospectId` | integer (int64) |  |
| `prospectName` | string, nullable |  |
| `prospectProductType` | string, nullable |  |
| `referralSourceId` | integer (int64), nullable |  |
| `referralSourceName` | string, nullable |  |
| `taskType` | string, nullable |  |
| `taskDueAt` | string (date-time), nullable |  |
| `taskEstimatedTime` | integer (int64), nullable |  |
| `assignedToId` | integer (int64), nullable |  |
| `assigneeName` | string, nullable |  |
| `assigneeJobRole` | string, nullable |  |
| `isCompleted` | boolean |  |
| `completedById` | integer (int64), nullable |  |
| `completedByName` | string, nullable |  |
| `completedByJobRole` | string, nullable |  |
| `completedAt` | string (date-time), nullable |  |
| `TaskNote` | string, nullable |  |
| `taskOutcome` | string, nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `age` | integer (int32), nullable |  |

**Likely date fields for period filtering:** `taskEstimatedTime`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/residents/complianceDetails`

[STREAMING] Export resident compliance details.

Returns a streamed list of resident compliance details including item status, expiration, group, and form disposition.
Results are filtered by the authenticated user's company and facility access.


Query Parameters:ResidentStatus: Optional filter by resident status (e.g., CurrentResident, Applicant).IncludeExpired: Include expired compliance items. Defaults to true.IncludeArchived: Include previously applicable compliance items. Defaults to false.IncludeRetired: Include retired compliance items. Defaults to false.ExpiresOnStartDate / ExpiresOnEndDate: Optional date range filter for expiration. Both must be provided together.Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `residentStatus` | string, nullable | no | Optional: Resident status to filter the compliance items by. |
| `includeExpired` | boolean | no | Optional: Filter to include expired compliance items. True by default |
| `includeArchived` | boolean | no | Optional: Filter to include previously applicable compliance items. False by default |
| `includeRetired` | boolean | no | Optional: Filter to include retired compliance items. False by default |
| `expiresOnStartDate` | string (date-time), nullable | no | Optional: Date to filter expired compliance items by. Requires ExpiresOnEndDate to be present. |
| `expiresOnEndDate` | string (date-time), nullable | no | Optional: Date to filter expired compliance items by. Requires ExpiresOnStartDate to be present. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `companyId` | integer (int64) |  |
| `companyTextKey` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentFirstName` | string, nullable |  |
| `residentLastName` | string, nullable |  |
| `residentStatusId` | integer (int64) |  |
| `residentStatus` | string, nullable |  |
| `complianceItemId` | integer (int64) |  |
| `name` | string, nullable |  |
| `isOptional` | boolean |  |
| `status` | string, nullable |  |
| `expiresOn` | string (date-time), nullable |  |
| `group` | string, nullable |  |
| `isRetired` | boolean |  |
| `inCabinet` | boolean |  |
| `lastUpdated` | string (date-time), nullable |  |
| `latestFormId` | integer (int64), nullable |  |
| `latestFormDisposition` | string, nullable |  |

**Likely date fields for period filtering:** `lastUpdated`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/residents/evaluations`

[STREAMING] Export evaluation records.

Returns a streamed list of resident evaluation records including care level, fee, completion status, and care packages.
Results are filtered by the authenticated user's company and facility access.


Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:** none — account-wide pull, returns full history

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `status` | string, nullable |  |
| `completedAt` | string (date-time), nullable |  |
| `completedBy` | integer (int64), nullable |  |
| `createdAt` | string (date-time), nullable |  |
| `createdBy` | integer (int64), nullable |  |
| `evaluationDate` | string (date-time), nullable |  |
| `residentEvaluationID` | integer (int64) |  |
| `evaluationConfigurationID` | integer (int64) |  |
| `careLevel` | string, nullable |  |
| `carePlanStatus` | string, nullable |  |
| `carePoints` | number (double), nullable |  |
| `carePackages` | string, nullable |  |
| `carePackagesCost` | number (double) |  |
| `fee` | number (double) |  |
| `preOverrideCareLevel` | string, nullable |  |
| `preOverrideFee` | number (double), nullable |  |
| `reason` | string, nullable |  |
| `expirationDate` | string (date-time), nullable |  |
| `impact` | string, nullable |  |
| `isMostCurrent` | boolean |  |
| `isCompleted` | boolean |  |
| `isExpired` | boolean |  |
| `isImported` | boolean |  |
| `isInProgress` | boolean |  |
| `isSigned` | boolean |  |

**Likely date fields for period filtering:** `evaluationDate`, `expirationDate`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/residents/incidents`

Returns a paged list of incidents that the authenticated user has access to.
Limited by company/community access.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentFullName` | string, nullable |  |
| `roomNumber` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `productType` | string, nullable |  |
| `classification` | string, nullable |  |
| `incidentId` | integer (int64) |  |
| `status` | string, nullable |  |
| `isComplete` | boolean |  |
| `createdBy` | string, nullable |  |
| `createdById` | integer (int64) |  |
| `incidentDateTime` | string (date-time) |  |
| `incidentType` | string, nullable |  |
| `incidentLocation` | string, nullable |  |
| `incidentSummary` | string, nullable |  |
| `completedForms` | integer (int32) |  |
| `completedTasks` | integer (int32) |  |
| `incompleteForms` | integer (int32) |  |
| `incompleteTasks` | integer (int32) |  |

**Likely date fields for period filtering:** `incidentDateTime`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/residents/leaves`

[STREAMING] Export resident leave-of-absence records.

Returns a streamed list of resident leave records including community, resident, destination, and start/end times.
Results are filtered by the authenticated user's company and community access.


Query Parameters:StartDate: Optional. Start of the date range filtered against the leave's StartDateTime. Defaults to the first day of the current month. Requires EndDate to be provided. Date range cannot exceed 1 year.EndDate: Optional. End of the date range filtered against the leave's StartDateTime. Defaults to the last day of the current month. Requires StartDate to be provided. Date range cannot exceed 1 year.Status: Optional. Resident status to filter leaves by (e.g., CurrentResident, MovedOut).Additional Info:Data Transfer: Streaming — rows are sent as a JSON array using chunked transfer encoding, one row at a time without buffering the full result set.Content Type: JSON only (application/json, text/json). CSV is not supported — requesting text/csv will return 406.Rate Limiting: Concurrency-based. 1 active stream per user, up to 5 queued. Requests beyond that return 429.Compression: GZip applied when client sends Accept-Encoding: gzip. Typically reduces payload 80-90%.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `startDate` | string (date-time), nullable | no | Optional: The start of the date range to filter leaves by StartDateTime. Defaults to the first day of the current month. Requires EndDate to be provided. Date range cannot exceed 1 year. |
| `endDate` | string (date-time), nullable | no | Optional: The end of the date range to filter leaves by StartDateTime. Defaults to the last day of the current month. Requires StartDate to be provided. Date range cannot exceed 1 year. |
| `status` | string, nullable | no | Optional: Resident status to filter leaves by. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `leaveId` | integer (int64) |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64) |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `leaveDestination` | string, nullable |  |
| `isComplete` | boolean |  |
| `leaveStatus` | string, nullable |  |
| `startDateTime` | string (date-time) |  |
| `scheduledEndDateTime` | string (date-time), nullable |  |
| `actualEndDateTime` | string (date-time), nullable |  |

**Likely date fields for period filtering:** `startDateTime`, `scheduledEndDateTime`, `actualEndDateTime`

[↑ back to index](#index)

---

## ⬜ `GET /v2/export/residents/observations`

Returns a paged list of observations that the authenticated user has access to.
Limited by company/community access.

**Query parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `pageNumber` | integer (int32) | no | The page number of results to return. Defaults to 1. |
| `pageSize` | integer (int32) | no | The number of items per page. Defaults to 10. Limit 10000. |

**Response fields** (array of objects):

| Field | Type | Enum values |
|---|---|---|
| `observationId` | integer (int64) |  |
| `companyGuid` | string, nullable |  |
| `communityId` | integer (int64) |  |
| `communityName` | string, nullable |  |
| `state` | string, nullable |  |
| `residentId` | integer (int64), nullable |  |
| `residentName` | string, nullable |  |
| `residentProductType` | string, nullable |  |
| `residentClassification` | string, nullable |  |
| `residentStatus` | string, nullable |  |
| `observationType` | string, nullable |  |
| `observationText` | string, nullable |  |
| `severity` | string, nullable |  |
| `occurredOn` | string (date-time) |  |
| `createdAt` | string (date-time) |  |
| `expiresAt` | string (date-time), nullable |  |
| `recordedBy` | integer (int64), nullable |  |
| `status` | string, nullable |  |

[↑ back to index](#index)

---


## Regenerating this file

```bash
curl -s https://api.alisonline.com/specs/v1/openapi.json -o /tmp/alis_openapi_v1.json
curl -s https://api.alisonline.com/specs/v2/openapi.json -o /tmp/alis_openapi_v2.json
node scripts/gen-alis-api-reference.js /tmp/alis_openapi_v1.json /tmp/alis_openapi_v2.json server/services/ALIS_EXPORT_API_REFERENCE.md
```

Generated 2026-08-23.
