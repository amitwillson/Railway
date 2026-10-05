/**
 * Inspection catalogue for the three inspection streams.
 *
 * Every entry here is ordinary master data: the Admin Panel can add, rename,
 * reassign or deactivate any of it without a code change. The defaults below
 * only decide what the New Inspection screen pre-selects, so that an inspector
 * normally touches nothing but the observation text.
 *
 *   dept     - department pre-selected in "Action By"
 *   category - observation category pre-selected
 *   severity - severity pre-selected
 *   applies  - station | train | both  (controls where the item is offered)
 *   kinds    - the areas this group belongs to, as unit kinds. Omitted means the
 *              group applies in every area, which is right for the station-wide
 *              groups; naming kinds is what stops the inspection sheet offering
 *              the booking-office checks on a platform.
 */

/* ========================================================================== */
/* MODULE A - PASSENGER AMENITIES & SERVICES                                  */
/* ========================================================================== */

export const passengerAmenities = [
  {
    group: 'Water & Sanitation',
    items: [
      { name: 'Drinking Water', dept: 'ENGG', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Water Cooler', dept: 'ELEC', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Water Booth', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Water Tap', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Water Supply', dept: 'ENGG', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Toilet', dept: 'ENGG', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Divyangjan Toilet', dept: 'ENGG', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Pay & Use Toilet', dept: 'COM', category: 'Contract' },
      { name: 'Sanitation', dept: 'ENGG', category: 'Cleanliness', severity: 'Major' },
      { name: 'Wash Basin', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Drainage', dept: 'ENGG', category: 'Passenger Amenity' },
    ],
  },
  {
    group: 'Passenger Facilities',
    items: [
      { name: 'Waiting Hall', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Waiting Room', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Seating', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Benches', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Platform Shelter', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Retiring Room', dept: 'COM', category: 'Contract' },
      { name: 'Dormitory', dept: 'COM', category: 'Contract' },
      { name: 'Cloak Room', dept: 'COM', category: 'Contract' },
      { name: 'Charging Facility', dept: 'ELEC', category: 'Passenger Amenity' },
      { name: 'Mobile Charging Point', dept: 'ELEC', category: 'Passenger Amenity' },
      { name: 'Fan', dept: 'ELEC', category: 'Passenger Amenity' },
      { name: 'Lighting', dept: 'ELEC', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Air Conditioning', dept: 'ELEC', category: 'Passenger Amenity' },
    ],
  },
  {
    group: 'Passenger Information',
    kinds: 'platform,concourse,waiting hall,booking office,reservation office,circulating area,entrance,exit,fob,subway',
    items: [
      { name: 'Station Name Board', dept: 'ENGG', category: 'Passenger Information' },
      { name: 'Platform Number Board', dept: 'ENGG', category: 'Passenger Information' },
      { name: 'Direction Signage', dept: 'ENGG', category: 'Passenger Information' },
      { name: 'Coach Guidance', dept: 'SNT', category: 'Passenger Information', severity: 'Major' },
      { name: 'Train Display Board', dept: 'SNT', category: 'Passenger Information' },
      { name: 'Train Information Display', dept: 'SNT', category: 'Passenger Information' },
      { name: 'Public Address System', dept: 'SNT', category: 'Passenger Information', severity: 'Major' },
      { name: 'Announcement', dept: 'COM', category: 'Passenger Information' },
      { name: 'Clock', dept: 'SNT', category: 'Passenger Information', severity: 'Minor' },
      { name: 'Enquiry Facility', dept: 'COM', category: 'Passenger Service' },
      { name: 'Help Desk', dept: 'COM', category: 'Passenger Service' },
      { name: 'Passenger Information System', dept: 'SNT', category: 'Passenger Information' },
    ],
  },
  {
    group: 'Accessibility',
    kinds: 'platform,concourse,booking office,reservation office,circulating area,entrance,exit,fob,subway,parking',
    items: [
      { name: 'Foot Over Bridge', dept: 'ENGG', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Ramp', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Lift', dept: 'ELEC', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Escalator', dept: 'ELEC', category: 'Passenger Amenity', severity: 'Major' },
      { name: 'Wheelchair', dept: 'COM', category: 'Passenger Service' },
      { name: 'Divyangjan Path', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Tactile Path', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Accessible Toilet', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Accessible Drinking Water', dept: 'ENGG', category: 'Passenger Amenity' },
      { name: 'Reserved Seating', dept: 'COM', category: 'Passenger Service' },
    ],
  },
  {
    group: 'Other Amenities',
    items: [
      { name: 'Dustbin', dept: 'ENGG', category: 'Cleanliness' },
      { name: 'Waste Disposal', dept: 'ENGG', category: 'Cleanliness' },
      { name: 'Cleanliness', dept: 'ENGG', category: 'Cleanliness', severity: 'Major' },
      { name: 'Illumination', dept: 'ELEC', category: 'Passenger Amenity' },
      { name: 'Queue Management', dept: 'COM', category: 'Passenger Service' },
      { name: 'Security-related passenger facility', dept: 'RPF', category: 'Passenger Service' },
      { name: 'Other', dept: 'COM', category: 'Other' },
    ],
  },
];

/* ========================================================================== */
/* MODULE B - COMMERCIAL INSPECTION                                           */
/* ========================================================================== */

export const commercialInspection = [
  {
    group: 'Ticketing',
    kinds: 'booking office,reservation office,concourse',
    items: [
      { name: 'UTS', dept: 'COM', category: 'Ticketing' },
      { name: 'PRS', dept: 'COM', category: 'Ticketing' },
      { name: 'Booking Counter', dept: 'COM', category: 'Ticketing' },
      { name: 'Reservation Counter', dept: 'COM', category: 'Ticketing' },
      { name: 'Current Booking', dept: 'COM', category: 'Ticketing' },
      { name: 'Season Ticket', dept: 'COM', category: 'Ticketing' },
      { name: 'Ticket Cancellation', dept: 'COM', category: 'Ticketing' },
      { name: 'Refund', dept: 'COM', category: 'Ticketing' },
      { name: 'Ticket Accountal', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Ticket Stock', dept: 'COM', category: 'Ticketing' },
      { name: 'Cash Handling', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Rate Display', dept: 'COM', category: 'Ticketing' },
      { name: 'Queue Management', dept: 'COM', category: 'Passenger Service' },
      { name: 'Ticket Checking', dept: 'COM', category: 'Revenue' },
    ],
  },
  {
    group: 'Catering Units',
    kinds: 'catering,platform,concourse,waiting hall',
    items: [
      { name: 'Static Catering', dept: 'COM', category: 'Catering' },
      { name: 'Mobile Catering', dept: 'COM', category: 'Catering', applies: 'both' },
      { name: 'Food Stall', dept: 'COM', category: 'Catering' },
      { name: 'Refreshment Room', dept: 'COM', category: 'Catering' },
      { name: 'Food Plaza', dept: 'COM', category: 'Catering' },
      { name: 'Jan Aahar', dept: 'COM', category: 'Catering' },
      { name: 'Tea Stall', dept: 'COM', category: 'Catering' },
      { name: 'Milk Stall', dept: 'COM', category: 'Catering' },
      { name: 'Vending Machine', dept: 'COM', category: 'Catering' },
    ],
  },
  {
    group: 'Catering Inspection Items',
    kinds: 'catering,platform,concourse,waiting hall,pantry',
    items: [
      { name: 'Licence', dept: 'COM', category: 'Licensing', applies: 'both' },
      { name: 'Rate List', dept: 'COM', category: 'Catering', applies: 'both' },
      { name: 'Menu', dept: 'COM', category: 'Catering', applies: 'both' },
      { name: 'Bill/Receipt', dept: 'COM', category: 'Catering', applies: 'both' },
      { name: 'Overcharging', dept: 'COM', category: 'Revenue', severity: 'Major', applies: 'both' },
      { name: 'Quality', dept: 'COM', category: 'Catering', severity: 'Major', applies: 'both' },
      { name: 'Quantity', dept: 'COM', category: 'Catering', applies: 'both' },
      { name: 'Hygiene', dept: 'COM', category: 'Catering', severity: 'Major', applies: 'both' },
      { name: 'Cleanliness', dept: 'COM', category: 'Cleanliness', applies: 'both' },
      { name: 'Staff Uniform', dept: 'COM', category: 'Catering', severity: 'Minor', applies: 'both' },
      { name: 'FSSAI compliance', dept: 'COM', category: 'Licensing', severity: 'Major', applies: 'both' },
      { name: 'Weighing facility', dept: 'COM', category: 'Catering', applies: 'both' },
      { name: 'Food storage', dept: 'COM', category: 'Catering', severity: 'Major', applies: 'both' },
      { name: 'Expired items', dept: 'COM', category: 'Catering', severity: 'Critical', applies: 'both' },
      { name: 'Water quality', dept: 'COM', category: 'Catering', severity: 'Major', applies: 'both' },
    ],
  },
  {
    group: 'Parcel',
    kinds: 'parcel office,brake van',
    items: [
      { name: 'Parcel Booking', dept: 'COM', category: 'Parcel' },
      { name: 'Parcel Delivery', dept: 'COM', category: 'Parcel' },
      { name: 'Weighment', dept: 'COM', category: 'Parcel' },
      { name: 'Loading', dept: 'COM', category: 'Parcel', applies: 'both' },
      { name: 'Unloading', dept: 'COM', category: 'Parcel', applies: 'both' },
      { name: 'Storage', dept: 'COM', category: 'Parcel' },
      { name: 'Accountal', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Luggage Booking', dept: 'COM', category: 'Parcel' },
      { name: 'Packaging', dept: 'COM', category: 'Parcel' },
      { name: 'Delivery Procedure', dept: 'COM', category: 'Parcel' },
    ],
  },
  {
    group: 'Commercial Contracts',
    items: [
      { name: 'Catering Contract', dept: 'COM', category: 'Contract' },
      { name: 'Parking Contract', dept: 'COM', category: 'Contract' },
      { name: 'Advertisement Contract', dept: 'COM', category: 'Contract' },
      { name: 'Pay & Use Toilet Contract', dept: 'COM', category: 'Contract' },
      { name: 'Cloak Room Contract', dept: 'COM', category: 'Contract' },
      { name: 'Retiring Room Contract', dept: 'COM', category: 'Contract' },
      { name: 'Parcel Handling Contract', dept: 'COM', category: 'Contract' },
      { name: 'Vending Contract', dept: 'COM', category: 'Contract' },
      { name: 'Stall Contract', dept: 'COM', category: 'Contract' },
      { name: 'Book Stall Contract', dept: 'COM', category: 'Contract' },
      { name: 'Other Contract', dept: 'COM', category: 'Contract' },
    ],
  },
  {
    group: 'Revenue',
    kinds: 'booking office,reservation office,parcel office',
    items: [
      { name: 'Short Collection', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Non-collection', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Undercharging', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Overcharging by staff', dept: 'COM', category: 'Revenue', severity: 'Major' },
      { name: 'Revenue Leakage', dept: 'COM', category: 'Revenue', severity: 'Critical' },
      { name: 'Outstanding Dues', dept: 'ACC', category: 'Revenue', severity: 'Major' },
      { name: 'Licence Fee Recovery', dept: 'ACC', category: 'Revenue' },
      { name: 'Contract Fee Recovery', dept: 'ACC', category: 'Revenue' },
      { name: 'Penalty Recovery', dept: 'COM', category: 'Revenue' },
      { name: 'Other Revenue Item', dept: 'COM', category: 'Revenue' },
    ],
  },
  {
    group: 'Licensing',
    items: [
      { name: 'Licence Validity', dept: 'COM', category: 'Licensing', severity: 'Major' },
      { name: 'Agreement', dept: 'COM', category: 'Licensing' },
      { name: 'Security Deposit', dept: 'ACC', category: 'Licensing' },
      { name: 'Licence Fee', dept: 'ACC', category: 'Licensing' },
      { name: 'Contract Conditions', dept: 'COM', category: 'Licensing' },
      { name: 'Display of Licence', dept: 'COM', category: 'Licensing', severity: 'Minor' },
      { name: 'Contractor Identity', dept: 'COM', category: 'Licensing' },
      { name: 'Staff Verification', dept: 'RPF', category: 'Licensing', severity: 'Major' },
      { name: 'Contract Expiry', dept: 'COM', category: 'Licensing', severity: 'Major' },
      { name: 'Violation of Conditions', dept: 'COM', category: 'Licensing', severity: 'Major' },
    ],
  },
];

/* ========================================================================== */
/* MODULE C - SAFE RUNNING OF TRAIN - COMMERCIAL DEPARTMENT                   */
/*                                                                            */
/* Only commercial / passenger-service items that bear on safe, orderly and    */
/* compliant running of passenger trains. Technical safety items belonging     */
/* exclusively to other departments are deliberately absent; where such a      */
/* defect is noticed during inspection, the observation is simply assigned to  */
/* that department through "Action By".                                        */
/* ========================================================================== */

export const safeRunningCommercial = [
  {
    group: 'A. Passenger Entry/Exit & Boarding',
    kinds: 'platform,entrance,exit,fob,subway,concourse,door',
    items: [
      { name: 'Passenger movement at platform', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Boarding arrangements', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Alighting arrangements', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Crowd management', dept: 'COM', category: 'Passenger Movement', severity: 'Critical', applies: 'both' },
      { name: 'Unauthorised boarding areas', dept: 'RPF', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Passenger obstruction', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Platform-side commercial activity affecting passenger movement', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major' },
      { name: 'Obstruction near coach doors', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Critical', applies: 'both' },
      { name: 'Unauthorised vending near coach doors', dept: 'RPF', category: 'Safe Running - Commercial', severity: 'Critical', applies: 'both' },
    ],
  },
  {
    group: 'B. Coach/Train Commercial Working',
    kinds: 'coach,compartment,vestibule,door,gangway,toilet,platform',
    items: [
      { name: 'Coach number/display', dept: 'MECH', category: 'Train Working', severity: 'Major', applies: 'both' },
      { name: 'Coach identification', dept: 'MECH', category: 'Train Working', severity: 'Major', applies: 'both' },
      { name: 'Coach position information', dept: 'COM', category: 'Passenger Information', severity: 'Major', applies: 'both' },
      { name: 'Reservation chart/display', dept: 'COM', category: 'Passenger Information', severity: 'Major', applies: 'both' },
      { name: 'Passenger information on train', dept: 'COM', category: 'Passenger Information', applies: 'both' },
      { name: 'Coach guidance display', dept: 'SNT', category: 'Passenger Information', severity: 'Major' },
      { name: 'Reserved/unreserved identification', dept: 'COM', category: 'Train Working', severity: 'Major', applies: 'both' },
      { name: 'Passenger announcement', dept: 'COM', category: 'Passenger Information', severity: 'Major' },
      { name: 'Train composition information', dept: 'OPS', category: 'Train Working', severity: 'Major', applies: 'both' },
      { name: 'Commercial signage', dept: 'COM', category: 'Passenger Information', applies: 'both' },
      { name: 'Passenger information display', dept: 'SNT', category: 'Passenger Information', applies: 'both' },
    ],
  },
  {
    group: 'C. Catering-Related Passenger Movement & Safety',
    kinds: 'catering,pantry,platform,coach',
    items: [
      { name: 'Unauthorised vendors', dept: 'RPF', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Obstruction by catering activity', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Unsafe movement of catering staff', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Unauthorised commercial activity', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Improper storage of catering material', dept: 'COM', category: 'Catering', severity: 'Major', applies: 'both' },
      { name: 'Obstruction in passenger areas', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Movement of trolleys affecting passenger movement', dept: 'COM', category: 'Passenger Movement', applies: 'both' },
      { name: 'Other commercial irregularity affecting safe passenger movement', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
    ],
  },
  {
    group: 'D. Parcel/Luggage',
    kinds: 'parcel office,brake van,platform',
    items: [
      { name: 'Unauthorised loading', dept: 'COM', category: 'Parcel', severity: 'Major', applies: 'both' },
      { name: 'Improperly placed luggage', dept: 'COM', category: 'Parcel', severity: 'Major', applies: 'both' },
      { name: 'Obstruction of passenger movement by parcel', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Material obstructing doors', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Critical', applies: 'both' },
      { name: 'Excess/unauthorised luggage', dept: 'COM', category: 'Parcel', applies: 'both' },
      { name: 'Improper storage of parcel', dept: 'COM', category: 'Parcel', applies: 'both' },
      { name: 'Unsafe handling of parcel/luggage', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Obstruction of gangway', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Critical', applies: 'train' },
      { name: 'Obstruction of emergency access', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Critical', applies: 'both' },
    ],
  },
  {
    group: 'E. Passenger Amenities Affecting Safe Train Working',
    items: [
      { name: 'Defective/unsafe passenger information', dept: 'SNT', category: 'Passenger Information', severity: 'Major', applies: 'both' },
      { name: 'Missing coach identification', dept: 'MECH', category: 'Train Working', severity: 'Major', applies: 'both' },
      { name: 'Incorrect coach guidance', dept: 'SNT', category: 'Passenger Information', severity: 'Major' },
      { name: 'Improper platform information', dept: 'COM', category: 'Passenger Information', severity: 'Major' },
      { name: 'Incorrect announcement', dept: 'COM', category: 'Passenger Information', severity: 'Major' },
      { name: 'Passenger confusion due to incorrect display', dept: 'SNT', category: 'Passenger Information', severity: 'Major' },
      { name: 'Obstruction at boarding area', dept: 'COM', category: 'Passenger Movement', severity: 'Critical', applies: 'both' },
      { name: 'Defective lighting affecting passenger movement', dept: 'ELEC', category: 'Passenger Amenity', severity: 'Major', applies: 'both' },
      { name: 'Other amenity affecting safe train working', dept: 'COM', category: 'Safe Running - Commercial', applies: 'both' },
    ],
  },
  {
    group: 'F. Commercial Staff / Vendor Conduct',
    items: [
      { name: 'Unauthorised person', dept: 'RPF', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Unauthorised vendor', dept: 'RPF', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Staff without identity card', dept: 'COM', category: 'Safe Running - Commercial', applies: 'both' },
      { name: 'Improper uniform', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Minor', applies: 'both' },
      { name: 'Unauthorised activity', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Obstruction to passengers by staff/vendor', dept: 'COM', category: 'Passenger Movement', applies: 'both' },
      { name: 'Misconduct affecting train working', dept: 'COM', category: 'Train Working', severity: 'Major', applies: 'both' },
      { name: 'Non-compliance with commercial instructions', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
    ],
  },
  {
    group: 'G. Emergency/Passenger Facilitation',
    items: [
      { name: 'Emergency information', dept: 'COM', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Emergency signage', dept: 'ENGG', category: 'Safe Running - Commercial', severity: 'Major', applies: 'both' },
      { name: 'Passenger guidance during emergency', dept: 'COM', category: 'Passenger Service', severity: 'Major', applies: 'both' },
      { name: 'Accessibility during boarding/alighting', dept: 'COM', category: 'Passenger Movement', severity: 'Major', applies: 'both' },
      { name: 'Clear access to emergency exits/areas', dept: 'ENGG', category: 'Safe Running - Commercial', severity: 'Critical', applies: 'both' },
      { name: 'Other commercial/passenger-related observation', dept: 'COM', category: 'Other', applies: 'both' },
    ],
  },
];

export const catalogue = {
  PA: passengerAmenities,
  CI: commercialInspection,
  SR: safeRunningCommercial,
};

/**
 * Checklist parameters offered for an item, by group. The Admin Panel can
 * override this per item; these are the sensible starting points.
 */
export const parameterProfiles = {
  default: ['Available', 'Functional', 'Clean', 'Adequate', 'Properly maintained', 'Not available', 'Not functional', 'Not applicable'],
  water: ['Available', 'Functional', 'Clean', 'Adequate', 'Safe for passenger use', 'Requires repair', 'Requires replacement', 'Not available', 'Not functional', 'Not applicable'],
  information: ['Available', 'Functional', 'Properly displayed', 'Adequate', 'Requires repair', 'Not available', 'Not functional', 'Not applicable'],
  accessibility: ['Available', 'Functional', 'Accessible', 'Adequate', 'Safe for passenger use', 'Requires repair', 'Not available', 'Not functional', 'Not applicable'],
  commercial: ['Available', 'Adequate', 'Properly displayed', 'Properly maintained', 'Requires repair', 'Not available', 'Not applicable'],
  safety: ['Available', 'Adequate', 'Safe for passenger use', 'Accessible', 'Requires repair', 'Not available', 'Not applicable'],
};

/** Maps an item group to its parameter profile. */
export function profileForGroup(moduleCode, groupName) {
  if (moduleCode === 'SR') return 'safety';
  if (moduleCode === 'CI') return 'commercial';
  if (/Water|Sanitation/i.test(groupName)) return 'water';
  if (/Information/i.test(groupName)) return 'information';
  if (/Accessibility/i.test(groupName)) return 'accessibility';
  return 'default';
}
