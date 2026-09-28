/**
 * Suggested deficiencies - the "what usually fails" dropdown under the
 * observation box.
 *
 * The inspector picks a suggestion and the observation text, the department, the
 * severity and the suggested TDC are filled in; the text stays editable, so a
 * suggestion is a starting point and never a constraint. Everything here is
 * ordinary master data: Admin -> Suggested deficiency adds, rewords or retires a
 * suggestion without a code change.
 *
 * Scope, narrowest first:
 *   item    - offered for that inspection item only
 *   group   - offered for every item in that group of that module
 *   module  - offered for every item of that module
 *   generic - offered everywhere
 *
 * `{item}` in the text is replaced with the name of the item the inspector
 * selected, which is how one row reads correctly under two hundred items.
 *
 *   dept     - overrides the department in "Action By" when this is picked
 *   severity - overrides the severity
 *   tdc      - suggested target date of compliance, in days from today
 */

/** Offered for every item, in every module. */
export const genericDeficiencies = [
  { text: '{item} not available', sort_order: 10 },
  { text: '{item} not functioning', sort_order: 20 },
  { text: '{item} not working satisfactorily', sort_order: 30 },
  { text: '{item} damaged / broken', sort_order: 40 },
  { text: '{item} not clean, requires attention', sort_order: 50 },
  { text: '{item} insufficient for the passenger load at this location', sort_order: 60 },
  { text: '{item} not provided as per prescribed norms', sort_order: 70 },
  { text: '{item} not maintained, requires immediate attention', sort_order: 80 },
];

/** Offered for every item of one module. */
export const moduleDeficiencies = [
  { module: 'PA', text: 'Amenity provided but unusable by passengers in its present condition', sort_order: 100 },
  { module: 'PA', text: 'Amenity not accessible to Divyangjan / elderly passengers', sort_order: 110 },
  { module: 'CI', text: 'Prescribed record not maintained / not available for inspection', sort_order: 100 },
  { module: 'CI', text: 'Statutory / contractual display not made at the prescribed place', sort_order: 110 },
  { module: 'CI', text: 'Irregularity noticed in accountal; detailed check advised', sort_order: 120 },
  { module: 'SR', text: 'Condition affecting safe movement of passengers - immediate action required', severity: 'Critical', tdc: 1, sort_order: 100 },
  { module: 'SR', text: 'Commercial activity obstructing the passenger path / boarding area', sort_order: 110 },
];

/**
 * Offered for every item of one group. `module` + `group` must match the
 * catalogue in data/catalogue.js.
 */
export const groupDeficiencies = [
  /* ---------------------------- Module A - PA ---------------------------- */
  { module: 'PA', group: 'Water & Sanitation', items: [
    { text: 'Water supply not available at the time of inspection', dept: 'ENGG', severity: 'Major', tdc: 3 },
    { text: 'Water flow inadequate / pressure very low', dept: 'ENGG' },
    { text: 'Tap leaking, water being wasted', dept: 'ENGG', tdc: 7 },
    { text: 'Surroundings wet and slippery, drainage choked', dept: 'ENGG', severity: 'Major', tdc: 3 },
    { text: 'Foul smell noticed; cleaning not done as per schedule', dept: 'ENGG', severity: 'Major', tdc: 2 },
  ] },
  { module: 'PA', group: 'Passenger Facilities', items: [
    { text: 'Seating capacity inadequate for the passenger load', dept: 'ENGG' },
    { text: 'Seats / benches broken and unsafe for use', dept: 'ENGG', severity: 'Major', tdc: 7 },
    { text: 'Floor and walls dirty, cleaning not done', dept: 'ENGG', tdc: 3 },
    { text: 'Facility found locked / not opened for passengers', dept: 'STN', severity: 'Major', tdc: 1 },
  ] },
  { module: 'PA', group: 'Passenger Information', items: [
    { text: 'Display blank / not switched on', dept: 'SNT', severity: 'Major', tdc: 2 },
    { text: 'Information displayed is incorrect or not updated', dept: 'SNT', severity: 'Major', tdc: 1 },
    { text: 'Board faded, not legible from the platform', dept: 'ENGG', tdc: 15 },
    { text: 'Announcement not audible at this location', dept: 'SNT', tdc: 7 },
  ] },
  { module: 'PA', group: 'Accessibility', items: [
    { text: 'Facility for Divyangjan passengers not available at this location', dept: 'ENGG', severity: 'Major' },
    { text: 'Access obstructed by material / vendor encroachment', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Provided but not usable in its present condition', dept: 'ENGG', severity: 'Major', tdc: 7 },
  ] },
  { module: 'PA', group: 'Other Amenities', items: [
    { text: 'Dustbins not placed at the prescribed interval', dept: 'ENGG', tdc: 7 },
    { text: 'Waste not lifted; garbage accumulated', dept: 'ENGG', severity: 'Major', tdc: 1 },
    { text: 'Illumination below the prescribed level', dept: 'ELEC', severity: 'Major', tdc: 3 },
  ] },

  /* ---------------------------- Module B - CI ---------------------------- */
  { module: 'CI', group: 'Ticketing', items: [
    { text: 'Counter not opened at the prescribed time', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Long queue; additional counter not opened', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Rate list / fare chart not displayed at the counter', dept: 'COM', tdc: 3 },
    { text: 'Cash on hand does not tally with the accountal', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Ticket stock not verified / balance not recorded', dept: 'COM', tdc: 7 },
  ] },
  { module: 'CI', group: 'Catering Units', items: [
    { text: 'Unit not functioning during the notified hours', dept: 'COM', severity: 'Major', tdc: 3 },
    { text: 'Unit operating beyond the sanctioned area', dept: 'COM', severity: 'Major', tdc: 3 },
    { text: 'Approved menu and rate list not displayed', dept: 'COM', tdc: 2 },
  ] },
  { module: 'CI', group: 'Catering Inspection Items', items: [
    { text: 'Overcharging noticed; amount recovered and passenger refunded', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Bill / receipt not issued to the passenger', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Unapproved brand / unauthorised item being sold', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Staff without uniform and identity card', dept: 'COM', tdc: 3 },
    { text: 'Food handling hygiene not up to the prescribed standard', dept: 'MED', severity: 'Major', tdc: 3 },
    { text: 'Items stored beyond the expiry date', dept: 'COM', severity: 'Critical', tdc: 1 },
  ] },
  { module: 'CI', group: 'Parcel', items: [
    { text: 'Weighment not done in the presence of the party', dept: 'COM', severity: 'Major', tdc: 3 },
    { text: 'Parcel lying undelivered beyond the free time', dept: 'COM', tdc: 7 },
    { text: 'Prescribed register not maintained up to date', dept: 'COM', tdc: 7 },
    { text: 'Parcel stacked so as to obstruct passenger movement', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'CI', group: 'Commercial Contracts', items: [
    { text: 'Contract conditions not being complied with by the licensee', dept: 'COM', severity: 'Major', tdc: 7 },
    { text: 'Agreement / licence not available at the unit for inspection', dept: 'COM', tdc: 3 },
    { text: 'Contract has expired; extension not on record', dept: 'COM', severity: 'Major', tdc: 7 },
  ] },
  { module: 'CI', group: 'Revenue', items: [
    { text: 'Short collection noticed; recovery to be effected', dept: 'COM', severity: 'Critical', tdc: 3 },
    { text: 'Dues outstanding beyond the prescribed period', dept: 'ACC', severity: 'Major', tdc: 15 },
    { text: 'Revenue leakage suspected; detailed check to be conducted', dept: 'COM', severity: 'Major', tdc: 7 },
  ] },
  { module: 'CI', group: 'Licensing', items: [
    { text: 'Licence not displayed at the unit', dept: 'COM', tdc: 3 },
    { text: 'Security deposit not kept alive / short by the required amount', dept: 'ACC', severity: 'Major', tdc: 15 },
    { text: 'Licence fee not paid for the current period', dept: 'ACC', severity: 'Major', tdc: 15 },
    { text: 'Staff police verification not on record', dept: 'COM', severity: 'Major', tdc: 7 },
  ] },

  /* ---------------------------- Module C - SR ---------------------------- */
  { module: 'SR', group: 'A. Passenger Entry/Exit & Boarding', items: [
    { text: 'Passenger movement obstructed at the boarding point', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Crowd not being regulated; no staff deployed at this point', dept: 'STN', severity: 'Major', tdc: 1 },
    { text: 'Commercial activity encroaching on the passenger path', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'SR', group: 'B. Coach/Train Commercial Working', items: [
    { text: 'Coach identification not legible to boarding passengers', dept: 'MECH', severity: 'Major', tdc: 3 },
    { text: 'Coach guidance display showing wrong coach position', dept: 'SNT', severity: 'Critical', tdc: 1 },
    { text: 'Reservation chart not displayed on the coach', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'SR', group: 'C. Catering-Related Passenger Movement & Safety', items: [
    { text: 'Unauthorised vendors noticed on the platform / in the train', dept: 'RPF', severity: 'Major', tdc: 1 },
    { text: 'Catering trolley movement obstructing passengers during boarding', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Catering material stored in the passenger circulating area', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'SR', group: 'D. Parcel/Luggage', items: [
    { text: 'Luggage placed so as to obstruct the coach doorway', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Parcel loading in progress at the passenger boarding point', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Gangway / emergency access obstructed by material', dept: 'COM', severity: 'Critical', tdc: 1 },
  ] },
  { module: 'SR', group: 'E. Passenger Amenities Affecting Safe Train Working', items: [
    { text: 'Incorrect information displayed, causing passengers to move along the train', dept: 'SNT', severity: 'Critical', tdc: 1 },
    { text: 'Lighting inadequate at the boarding area', dept: 'ELEC', severity: 'Major', tdc: 2 },
    { text: 'Announcement not made for the train at this platform', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'SR', group: 'F. Commercial Staff / Vendor Conduct', items: [
    { text: 'Person found without a valid identity card / authority', dept: 'RPF', severity: 'Major', tdc: 1 },
    { text: 'Staff conduct towards passengers not satisfactory', dept: 'COM', tdc: 7 },
    { text: 'Commercial instructions not being followed by the staff on duty', dept: 'COM', tdc: 7 },
  ] },
  { module: 'SR', group: 'G. Emergency/Passenger Facilitation', items: [
    { text: 'Emergency signage not provided / not visible at this location', dept: 'ENGG', severity: 'Major', tdc: 7 },
    { text: 'Access to the emergency exit obstructed', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'No staff available to guide passengers at this point', dept: 'STN', severity: 'Major', tdc: 1 },
  ] },
];

/**
 * Offered for one inspection item. `item` must match a name in the catalogue;
 * the first entry of each list is the one the inspector sees first.
 */
export const specificDeficiencies = [
  { module: 'PA', item: 'Water Cooler', items: [
    { text: 'Water cooler is not functioning.', dept: 'ELEC', severity: 'Major', tdc: 3 },
    { text: 'Water cooler functioning but water is not cool', dept: 'ELEC', tdc: 7 },
    { text: 'Water cooler taps leaking / broken', dept: 'ENGG', tdc: 7 },
    { text: 'Water cooler not cleaned; filter not changed on schedule', dept: 'ELEC', tdc: 7 },
  ] },
  { module: 'PA', item: 'Drinking Water', items: [
    { text: 'Drinking water not available at this location', dept: 'ENGG', severity: 'Major', tdc: 2 },
    { text: 'Drinking water supply intermittent during peak hours', dept: 'ENGG', tdc: 7 },
    { text: 'Water quality doubtful; testing to be arranged', dept: 'MED', severity: 'Major', tdc: 3 },
  ] },
  { module: 'PA', item: 'Toilet', items: [
    { text: 'Toilet found in unhygienic condition; cleaning not done', dept: 'ENGG', severity: 'Major', tdc: 1 },
    { text: 'Water not available in the toilet', dept: 'ENGG', severity: 'Major', tdc: 1 },
    { text: 'Doors / latches broken, privacy not ensured', dept: 'ENGG', severity: 'Major', tdc: 7 },
    { text: 'Toilet found locked during the inspection', dept: 'STN', severity: 'Major', tdc: 1 },
    { text: 'Light / exhaust fan in the toilet not working', dept: 'ELEC', tdc: 3 },
  ] },
  { module: 'PA', item: 'Divyangjan Toilet', items: [
    { text: 'Divyangjan toilet not provided at this location', dept: 'ENGG', severity: 'Major' },
    { text: 'Divyangjan toilet locked / being used as a store', dept: 'STN', severity: 'Major', tdc: 1 },
    { text: 'Ramp / grab bar of the Divyangjan toilet damaged', dept: 'ENGG', severity: 'Major', tdc: 7 },
  ] },
  { module: 'PA', item: 'Lighting', items: [
    { text: 'Lights not working at this location', dept: 'ELEC', severity: 'Major', tdc: 2 },
    { text: 'Illumination inadequate for passenger movement after dark', dept: 'ELEC', severity: 'Major', tdc: 3 },
    { text: 'Light fittings damaged / hanging loose', dept: 'ELEC', severity: 'Major', tdc: 2 },
  ] },
  { module: 'PA', item: 'Fan', items: [
    { text: 'Fans not working at this location', dept: 'ELEC', tdc: 3 },
    { text: 'Fans provided are inadequate in number', dept: 'ELEC', tdc: 15 },
    { text: 'Fan regulator / switch defective', dept: 'ELEC', tdc: 7 },
  ] },
  { module: 'PA', item: 'Seating', items: [
    { text: 'Seating inadequate for the passenger load at this platform', dept: 'ENGG', tdc: 30 },
    { text: 'Seats broken / unsafe for passengers', dept: 'ENGG', severity: 'Major', tdc: 7 },
    { text: 'Seating occupied by vendors and their material', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'PA', item: 'Platform Shelter', items: [
    { text: 'Shelter does not cover the required length of the platform', dept: 'ENGG', tdc: 90 },
    { text: 'Shelter sheets damaged; water dripping during rain', dept: 'ENGG', severity: 'Major', tdc: 15 },
  ] },
  { module: 'PA', item: 'Lift', items: [
    { text: 'Lift not working at the time of inspection', dept: 'ELEC', severity: 'Major', tdc: 1 },
    { text: 'Lift working but attendant not available', dept: 'ELEC', tdc: 3 },
    { text: 'Lift emergency alarm / intercom not working', dept: 'ELEC', severity: 'Major', tdc: 3 },
  ] },
  { module: 'PA', item: 'Escalator', items: [
    { text: 'Escalator not working at the time of inspection', dept: 'ELEC', severity: 'Major', tdc: 1 },
    { text: 'Escalator handrail / comb plate damaged', dept: 'ELEC', severity: 'Major', tdc: 3 },
  ] },
  { module: 'PA', item: 'Coach Guidance', items: [
    { text: 'Coach guidance display not working at this platform', dept: 'SNT', severity: 'Major', tdc: 2 },
    { text: 'Coach guidance showing the position of the previous train', dept: 'SNT', severity: 'Critical', tdc: 1 },
  ] },
  { module: 'PA', item: 'Public Address System', items: [
    { text: 'Public address system not audible at this location', dept: 'SNT', severity: 'Major', tdc: 3 },
    { text: 'Announcement not made in all three prescribed languages', dept: 'COM', tdc: 7 },
  ] },
  { module: 'PA', item: 'Train Display Board', items: [
    { text: 'Display board blank / not switched on', dept: 'SNT', severity: 'Major', tdc: 2 },
    { text: 'Train information on the display board not updated', dept: 'SNT', severity: 'Major', tdc: 1 },
  ] },
  { module: 'PA', item: 'Station Name Board', items: [
    { text: 'Station name board not provided at the prescribed position', dept: 'ENGG', tdc: 30 },
    { text: 'Station name board faded / not legible', dept: 'ENGG', tdc: 15 },
    { text: 'Station name board not in all three prescribed languages', dept: 'ENGG', tdc: 30 },
  ] },
  { module: 'PA', item: 'Dustbin', items: [
    { text: 'Dustbins not provided at the prescribed interval', dept: 'ENGG', tdc: 15 },
    { text: 'Dustbins overflowing; not cleared', dept: 'ENGG', severity: 'Major', tdc: 1 },
  ] },
  { module: 'PA', item: 'Cleanliness', items: [
    { text: 'Cleanliness not up to the prescribed standard at this location', dept: 'ENGG', severity: 'Major', tdc: 1 },
    { text: 'Platform surface littered; sweeping not done as per schedule', dept: 'ENGG', tdc: 1 },
    { text: 'Track area adjoining the platform not cleaned', dept: 'ENGG', severity: 'Major', tdc: 3 },
  ] },
  { module: 'PA', item: 'Pay & Use Toilet', items: [
    { text: 'Charges collected in excess of the approved rate', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Approved rate list not displayed at the entrance', dept: 'COM', tdc: 3 },
    { text: 'Free-of-charge urinal facility not provided as required', dept: 'COM', severity: 'Major', tdc: 3 },
  ] },
  { module: 'PA', item: 'Wheelchair', items: [
    { text: 'Wheelchair not available at the station', dept: 'COM', severity: 'Major', tdc: 3 },
    { text: 'Wheelchair available but in unserviceable condition', dept: 'COM', severity: 'Major', tdc: 7 },
    { text: 'No attendant available to assist with the wheelchair', dept: 'COM', tdc: 3 },
  ] },
  { module: 'CI', item: 'UTS', items: [
    { text: 'UTS terminal down; tickets being issued manually', dept: 'IT', severity: 'Major', tdc: 1 },
    { text: 'UTS counter not opened at the notified time', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'CI', item: 'Booking Counter', items: [
    { text: 'Counter unattended at the time of inspection', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Queue not being regulated; passengers waiting beyond a reasonable time', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Change / coins not kept ready at the counter', dept: 'COM', tdc: 3 },
  ] },
  { module: 'CI', item: 'Rate Display', items: [
    { text: 'Approved rate list not displayed', dept: 'COM', tdc: 2 },
    { text: 'Rate list displayed is outdated', dept: 'COM', tdc: 2 },
    { text: 'Rate list not legible to passengers from the counter', dept: 'COM', tdc: 3 },
  ] },
  { module: 'CI', item: 'Overcharging', items: [
    { text: 'Overcharging detected; excess amount refunded to the passenger', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Overcharging detected; penalty imposed on the licensee', dept: 'COM', severity: 'Critical', tdc: 3 },
  ] },
  { module: 'CI', item: 'Licence', items: [
    { text: 'Licence not available at the unit for inspection', dept: 'COM', tdc: 3 },
    { text: 'Licence has expired; renewal not on record', dept: 'COM', severity: 'Major', tdc: 7 },
  ] },
  { module: 'CI', item: 'Hygiene', items: [
    { text: 'Hygiene at the unit not up to the prescribed standard', dept: 'MED', severity: 'Major', tdc: 2 },
    { text: 'Staff handling food without hand gloves / head cover', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Waste not disposed of from the unit premises', dept: 'COM', tdc: 1 },
  ] },
  { module: 'CI', item: 'Parking Contract', items: [
    { text: 'Parking charges collected in excess of the approved rate', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Printed receipt not issued to the vehicle owner', dept: 'COM', severity: 'Major', tdc: 1 },
    { text: 'Parking area extended beyond the sanctioned limit', dept: 'COM', severity: 'Major', tdc: 7 },
  ] },
  { module: 'CI', item: 'Licence Validity', items: [
    { text: 'Licence has expired; renewal not on record', dept: 'COM', severity: 'Major', tdc: 7 },
    { text: 'Unit working without a valid licence', dept: 'COM', severity: 'Critical', tdc: 3 },
    { text: 'Licence valid but the conditions are not being observed', dept: 'COM', tdc: 15 },
  ] },
  { module: 'CI', item: 'Rate List', items: [
    { text: 'Approved rate list not displayed at the unit', dept: 'COM', severity: 'Major', tdc: 2 },
    { text: 'Rate list displayed does not match the approved rates', dept: 'COM', severity: 'Critical', tdc: 1 },
  ] },
  { module: 'SR', item: 'Unauthorised vending near coach doors', items: [
    { text: 'Unauthorised vendors operating at the coach doors during boarding', dept: 'RPF', severity: 'Critical', tdc: 1 },
    { text: 'Vending activity obstructing passengers boarding the train', dept: 'COM', severity: 'Critical', tdc: 1 },
  ] },
  { module: 'SR', item: 'Unauthorised vendors', items: [
    { text: 'Unauthorised vendors found on the platform', dept: 'RPF', severity: 'Major', tdc: 1 },
    { text: 'Unauthorised vendors boarding the train at this station', dept: 'RPF', severity: 'Critical', tdc: 1 },
  ] },
  { module: 'SR', item: 'Crowd management', items: [
    { text: 'Crowd at the boarding point not being regulated', dept: 'STN', severity: 'Critical', tdc: 1 },
    { text: 'No announcement made to regulate the waiting crowd', dept: 'COM', severity: 'Major', tdc: 1 },
  ] },
  { module: 'SR', item: 'Obstruction near coach doors', items: [
    { text: 'Material kept near the coach door obstructing boarding', dept: 'COM', severity: 'Critical', tdc: 1 },
    { text: 'Vendors operating at the coach door during boarding', dept: 'RPF', severity: 'Critical', tdc: 1 },
  ] },
];
