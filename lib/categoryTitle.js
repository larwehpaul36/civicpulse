// "Other problem" reports carry the reporter's own few words: show them next to the category name.
export const categoryTitle = (name, otherLabel) => (otherLabel ? `${name}: ${otherLabel}` : name);
