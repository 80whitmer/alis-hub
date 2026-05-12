/**
 * master-list-map.js
 *
 * Maps field labels to ALIS/generic codes based on the Master List
 * and common form labels. This is initialized from the actual Master List
 * but we start with a core set for testing.
 */

// ALIS field mappings extracted from Master List
const alisFields = {
  'alis.facility.name': {
    label: 'Community Name',
    read_only: true,
    type: 'facility',
    description: 'Facility/community name'
  },
  'alis.facility.full_address': {
    label: 'Address',
    read_only: true,
    type: 'facility',
    description: 'Full facility address'
  },
  'alis.facility.city': {
    label: 'City',
    read_only: true,
    type: 'facility',
    description: 'Facility city'
  },
  'alis.facility.state': {
    label: 'State',
    read_only: true,
    type: 'facility',
    description: 'Facility state'
  },
  'alis.facility.zip': {
    label: 'Zip',
    read_only: true,
    type: 'facility',
    description: 'Facility ZIP code'
  },
  'alis.facility.phone': {
    label: 'Phone Number',
    read_only: true,
    type: 'facility',
    description: 'Facility phone'
  },
  'alis.facility.fax': {
    label: 'Fax',
    read_only: true,
    type: 'facility',
    description: 'Facility fax'
  },
  'alis.resident.full_name': {
    label: 'Resident Name',
    read_only: true,
    type: 'resident',
    description: 'Full resident name (read-only composite)'
  },
  'alis.resident.first_name': {
    label: 'First Name',
    read_only: false,
    type: 'resident'
  },
  'alis.resident.last_name': {
    label: 'Last Name',
    read_only: false,
    type: 'resident'
  },
  'alis.resident.dob': {
    label: 'Date of Birth',
    read_only: true,
    type: 'resident',
    description: 'Resident DOB'
  },
  'alis.resident.ssn': {
    label: 'Social Security Number',
    read_only: true,
    type: 'resident'
  },
  'alis.resident.phone': {
    label: 'Phone',
    read_only: false,
    type: 'resident'
  },
  'alis.resident.email': {
    label: 'Email',
    read_only: false,
    type: 'resident'
  }
};

// Generic field patterns
const genericPatterns = {
  'generic.text_allergies.1': {
    patterns: ['allerg', 'allergy'],
    type: 'text',
    required: true,
    read_only: false,
    confidence: 0.95
  },
  'generic.text_medication.1': {
    patterns: ['medication', 'med ', 'meds'],
    type: 'text',
    required: false,
    read_only: false,
    confidence: 0.85
  },
  'generic.text_diagnosis.1': {
    patterns: ['diagnosis', 'diagnoses'],
    type: 'text',
    required: false,
    read_only: false,
    confidence: 0.90
  },
  'generic.text_health_history.1': {
    patterns: ['health history', 'medical history', 'history'],
    type: 'text',
    required: false,
    read_only: false,
    confidence: 0.80
  },
  'generic.date_assessment.1': {
    patterns: ['assessment date', 'assessment'],
    type: 'date',
    required: true,
    read_only: false,
    confidence: 0.90
  },
  'generic.date_signature.1': {
    patterns: ['date', 'signature date', 'sign date'],
    type: 'date',
    required: false,
    read_only: false,
    confidence: 0.75
  },
  'generic.signature_physician.1': {
    patterns: ['physician signature', 'physician sig', 'doctor signature', 'md signature'],
    type: 'signature',
    required: true,
    read_only: false,
    confidence: 0.95
  },
  'generic.signature_staff.1': {
    patterns: ['staff signature', 'nurse signature', 'administrator signature'],
    type: 'signature',
    required: true,
    read_only: false,
    confidence: 0.90
  },
  'generic.check_dnr.1': {
    patterns: ['dnr', 'do not resuscitate'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.98
  },
  'generic.check_medication_assistance.1': {
    patterns: ['medication assistance', 'med assistance', 'needs med'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.85
  },
  'generic.check_wheelchair.1': {
    patterns: ['wheelchair'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.98
  },
  'generic.check_walker.1': {
    patterns: ['walker'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.98
  },
  'generic.check_hearing_aids.1': {
    patterns: ['hearing aids', 'hearing aid'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.95
  },
  'generic.check_glasses.1': {
    patterns: ['glasses', 'spectacles'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.95
  },
  'generic.check_dentures.1': {
    patterns: ['dentures'],
    type: 'checkbox',
    required: false,
    read_only: false,
    confidence: 0.98
  }
};

// Form-specific mappings for known templates
const formMappings = {
  'move-in-assessment-v1': {
    'Community Name': { code: 'alis.facility.name', confidence: 0.99, read_only: true },
    'Address': { code: 'alis.facility.full_address', confidence: 0.99, read_only: true },
    'City': { code: 'alis.facility.city', confidence: 0.99, read_only: true },
    'State': { code: 'alis.facility.state', confidence: 0.99, read_only: true },
    'Zip': { code: 'alis.facility.zip', confidence: 0.99, read_only: true },
    'Phone Number': { code: 'alis.facility.phone', confidence: 0.99, read_only: true },
    'Fax': { code: 'alis.facility.fax', confidence: 0.99, read_only: true },
    'Resident Name': { code: 'alis.resident.full_name', confidence: 0.99, read_only: true, required: true },
    'Assessment Date': { code: 'generic.date_assessment.1', confidence: 0.98, required: true },
    'D.O.B.': { code: 'alis.resident.dob', confidence: 0.99, read_only: true },
    'Weight': { code: 'generic.text_weight.1', confidence: 0.95 },
    'Height': { code: 'generic.text_height.1', confidence: 0.95 },
    'BP': { code: 'generic.text_bp.1', confidence: 0.95 },
    'Pulse': { code: 'generic.text_pulse.1', confidence: 0.95 },
    'Temp': { code: 'generic.text_temp.1', confidence: 0.95 },
    'Allergies': { code: 'generic.text_allergies.1', confidence: 0.99, required: true },
    'DNR': { code: 'generic.check_dnr.1', confidence: 0.99 },
    'Diagnosis': { code: 'generic.text_diagnosis.1', confidence: 0.95 },
    'Health History': { code: 'generic.text_health_history.1', confidence: 0.95 },
    'Recent Mantoux Test': { code: 'generic.text_mantoux.1', confidence: 0.90 },
    'Date of Last Chest X-Ray': { code: 'generic.date_chest_xray.1', confidence: 0.90 },
    'Evidence of Pulmonary Tuberculosis': { code: 'generic.check_tb_evidence.1', confidence: 0.95 },
    'TB Test Needed': { code: 'generic.check_tb_test_needed.1', confidence: 0.90 },
    'Wheelchair': { code: 'generic.check_wheelchair.1', confidence: 0.99 },
    'Walker': { code: 'generic.check_walker.1', confidence: 0.99 },
    'Hearing Aids': { code: 'generic.check_hearing_aids.1', confidence: 0.95 },
    'Cane': { code: 'generic.check_cane.1', confidence: 0.98 },
    'Motorized Wheelchair': { code: 'generic.check_motorized_wheelchair.1', confidence: 0.95 },
    'Glasses': { code: 'generic.check_glasses.1', confidence: 0.98 },
    'Dentures': { code: 'generic.check_dentures.1', confidence: 0.98 },
    'Other': { code: 'generic.check_other_devices.1', confidence: 0.80 },
    'Capable of Self-Admin': { code: 'generic.check_self_admin_meds.1', confidence: 0.95 },
    'Needs Medication Assistance': { code: 'generic.check_needs_med_assist.1', confidence: 0.95 },
    'Medication List Attached': { code: 'generic.check_med_list_attached.1', confidence: 0.95 },
    'Physical and History Attached': { code: 'generic.check_history_attached.1', confidence: 0.95 },
    'Assisted Living': { code: 'generic.check_assisted_living.1', confidence: 0.98 },
    'Memory Care': { code: 'generic.check_memory_care.1', confidence: 0.98 },
    'Physician Signature': { code: 'generic.signature_physician.1', confidence: 0.99, required: true }
  }
};

module.exports = {
  alisFields,
  genericPatterns,
  formMappings,
  getAllFields() {
    const allFields = { ...alisFields };
    for (const [code, config] of Object.entries(genericPatterns)) {
      allFields[code] = {
        label: code,
        type: config.type,
        read_only: config.read_only,
        required: config.required
      };
    }
    return allFields;
  }
};
