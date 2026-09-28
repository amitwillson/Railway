/**
 * User accounts, and the contractor/licensee register.
 *
 * The supervisor master is not here: it comes from the division's own structure
 * and lives in `data/bilaspur.js`.
 *
 * The accounts below are POSTS, not people. The system is being set up against
 * the division's real station data, and putting invented names next to it would
 * be worse than useless - so each account is named for the post that holds it,
 * and the division puts the officer's name, mobile and e-mail against it from
 * Admin -> Users on the first day. Nothing in the application depends on the
 * names.
 */

export const users = [
  { employee_id: 'ADMIN01', name: 'System Administrator', designation: 'System Administrator', role: 'admin', email: 'admin@secr.railnet.gov.in', department: 'IT', division: 'BSP', zone: 'SECR' },
  { employee_id: 'SRDCM01', name: 'Sr. Divisional Commercial Manager', designation: 'Sr. Divisional Commercial Manager', role: 'divisional_officer', email: 'srdcm.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR' },
  { employee_id: 'DCM01', name: 'Divisional Commercial Manager', designation: 'Divisional Commercial Manager', role: 'divisional_officer', email: 'dcm.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR' },
  { employee_id: 'ACM01', name: 'Assistant Commercial Manager', designation: 'Assistant Commercial Manager', role: 'inspector', email: 'acm.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR', station: 'BSP' },
  { employee_id: 'CMI01', name: 'Chief Commercial Inspector / Bilaspur', designation: 'Chief Commercial Inspector', role: 'inspector', email: 'cmi1.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR', station: 'BSP' },
  { employee_id: 'CMI02', name: 'Commercial Inspector / Raigarh', designation: 'Commercial Inspector', role: 'inspector', email: 'cmi2.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR', station: 'RIG' },
  { employee_id: 'TI01', name: 'Travelling Ticket Inspector / Bilaspur', designation: 'Travelling Ticket Inspector', role: 'inspector', email: 'ti1.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR', station: 'BSP' },
  { employee_id: 'VIEW01', name: 'Divisional Office (Read only)', designation: 'Office Superintendent', role: 'viewer', email: 'office.bsp@secr.railnet.gov.in', department: 'COM', division: 'BSP', zone: 'SECR' },
];

/**
 * Contractors and licensees.
 *
 * The division's contract register is not in the data supplied, so these are the
 * kinds of party a commercial inspection deals with, placed at the two stations
 * PAMS records as having catering and parking, with no firm names invented. The
 * real register replaces them from Admin -> Contractor / Licensee.
 */
export const contractors = [
  { name: 'Refreshment Room licensee - Bilaspur', party_type: 'licensee', contract_ref: 'BSP/CTG/2024/01', scope: 'Refreshment Room, PF-1', station: 'BSP', department: 'COM', valid_from: '2024-04-01', valid_to: '2027-03-31', security_deposit: 450000, licence_fee: 1250000 },
  { name: 'Food Plaza licensee - Bilaspur', party_type: 'licensee', contract_ref: 'BSP/FP/2024/02', scope: 'Food Plaza, circulating area', station: 'BSP', department: 'COM', valid_from: '2024-06-01', valid_to: '2029-05-31', security_deposit: 800000, licence_fee: 2400000 },
  { name: 'Parking licensee - Bilaspur', party_type: 'licensee', contract_ref: 'BSP/PKG/2023/03', scope: 'Parking area, main entry', station: 'BSP', department: 'COM', valid_from: '2023-07-01', valid_to: '2026-06-30', security_deposit: 300000, licence_fee: 890000 },
  { name: 'Station cleanliness contractor - Bilaspur', party_type: 'contractor', contract_ref: 'BSP/EHM/2024/04', scope: 'Station cleanliness and sanitation', station: 'BSP', department: 'ENGG', valid_from: '2024-01-15', valid_to: '2027-01-14', security_deposit: 800000 },
  { name: 'Pay & Use toilet licensee - Bilaspur', party_type: 'licensee', contract_ref: 'BSP/PU/2022/05', scope: 'Pay & Use toilets, PF 1 and 6', station: 'BSP', department: 'COM', valid_from: '2022-10-01', valid_to: '2026-09-30', security_deposit: 150000, licence_fee: 360000 },
  { name: 'Refreshment Room licensee - Raigarh', party_type: 'licensee', contract_ref: 'RIG/CTG/2024/01', scope: 'Refreshment Room, PF-1', station: 'RIG', department: 'COM', valid_from: '2024-05-01', valid_to: '2027-04-30', licence_fee: 610000 },
  { name: 'Packaged drinking water vendor - division', party_type: 'vendor', contract_ref: 'BSP/RN/2024/06', scope: 'Packaged drinking water stalls', station: 'BSP', department: 'COM', valid_from: '2024-06-01', valid_to: '2026-05-31' },
];
