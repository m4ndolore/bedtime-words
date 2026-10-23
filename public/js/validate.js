/* Rules for affirmations shared with other families, used by the page and the Worker alike.
 * Kids read what gets approved, so shared text carries no links, emails or phone numbers.
 */
(function (root) {
  'use strict';

  const MAX_TEXT = 160;
  const MAX_CONTACT = 120;
  const OWN = 'Our Own';
  const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

  function clean(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  /* Returns a reason the text cannot be shared, or null when it can. */
  function problem(text) {
    if (!text) return 'Both halves need words.';
    if (text.length > MAX_TEXT) return `Keep each half under ${MAX_TEXT} characters.`;
    if (/https?/i.test(text) || /www\./i.test(text)) return 'Shared affirmations cannot include links.';
    if (EMAIL.test(text)) return 'Shared affirmations cannot include email addresses.';
    if (/\d{7,}/.test(text.replace(/[\s.()\-]/g, ''))) return 'Shared affirmations cannot include phone numbers.';
    return null;
  }

  /* Checks a submission; `categories` are the names a submission may use. */
  function checkSubmission(input, categories) {
    const challenge = clean(input && input.challenge);
    const response = clean(input && input.response);
    const contact = clean(input && input.contact);
    const reason = problem(challenge) || problem(response)
      || (contact.length > MAX_CONTACT ? `Keep your name or email under ${MAX_CONTACT} characters.` : null);
    if (reason) return { ok: false, reason };
    const category = categories.includes(input.category) ? input.category : OWN;
    return { ok: true, value: { challenge, response, category, contact: contact || null } };
  }

  const api = { clean, problem, checkSubmission, MAX_TEXT, MAX_CONTACT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BedtimeValidate = api;
})(typeof window !== 'undefined' ? window : globalThis);
