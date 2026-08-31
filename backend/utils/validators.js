//   if (!phone) return true;
//   return /^03\d{9}$/.test(String(phone).trim());
// }


/**
 * Validates Pakistani CNIC format.
 * Accepts these common input variations:
 *   - 12345-1234567-1
 *   - 1234512345671    (without dashes)
 *   - 12345 1234567 1  (with spaces)
 *   - 12345-1234567-1 (with extra spaces)
 *
 * Returns true if valid or empty.
 */
export function isValidPakCnic(cnic) {
  if (!cnic) return true;

  // Remove everything except digits
  const digits = String(cnic).trim().replace(/\D/g, '');

  // Must be exactly 13 digits
  if (digits.length !== 13) return false;

  // Optional: you can add check for valid CNIC ranges if needed later
  // e.g. first 5 digits shouldn't be all zeros, etc.

  return true;
}

/**
 * Validates Pakistani mobile phone number.
 * Accepts these common input variations:
 *   - 03001234567
 *   - 3001234567
 *   - +923001234567
 *   - 00923001234567
 *   - 03 00 1234567
 *   - 0300-1234567
 *
 * Returns true if valid or empty.
 */
export function isValidPakPhone(phone) {
  if (!phone) return true;

  // Remove everything except digits
  let digits = String(phone).trim().replace(/\D/g, '');

  // Handle common international prefixes
  if (digits.startsWith('92') && digits.length === 12) {
    digits = '0' + digits.slice(2); // 923001234567 → 03001234567
  } else if (digits.startsWith('0092') && digits.length === 13) {
    digits = '0' + digits.slice(4); // 00923001234567 → 03001234567
  }

  // Final check: must be exactly 11 digits and start with 03
  return digits.length === 11 && digits.startsWith('03');
}