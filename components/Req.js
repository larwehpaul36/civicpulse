// A red star after the name of a required field. Screen readers already hear aria-required, so the star is hidden from them.
export const Req = () => <span className="req" aria-hidden="true"> *</span>;
