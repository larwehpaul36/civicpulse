// Emergency numbers shown on "Dangerous right now" reports. CivicPulse is NOT an emergency service: nobody watches reports
// in real time, so for danger to life the person must call, and the app says so plainly.
//
// CHECKED 7 Nov 2026 against: the national 112 announcement (myjoyonline, Mar 2020: police 191, ambulance 193, fire 192, 112 as
// the central number), Wikipedia's list of emergency numbers, and NADMO's own contact page and Graphic Online (7 Jun 2026:
// 112 and 0302 964 884). Numbers change: re-check this list once a year and edit it here only; nothing else holds a number.
export const EMERGENCY = [
  { key: 'general', number: '112' },        // free, 24 hours: police, fire, ambulance and NADMO
  { key: 'police', number: '191' },
  { key: 'fire', number: '192' },
  { key: 'ambulance', number: '193' },
  { key: 'nadmo', number: '0302964884' },   // NADMO headquarters emergency line (floods, disasters)
];

export const telHref = (number) => `tel:${String(number).replace(/[^\d+]/g, '')}`;

// Only reports the resident marked "Dangerous right now" get the notice, and only while the problem is still open.
export const needsEmergencyNotice = (severity, status) => severity === 'hazard' && status !== 'resolved' && status !== 'rejected';

// "0302964884" is easier to read as "0302 964 884"; short numbers stay as they are.
export const spaced = (number) => (/^0\d{9}$/.test(number) ? `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}` : number);
