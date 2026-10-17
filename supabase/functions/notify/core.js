// The logic of the `notify` Edge Function, with everything it talks to passed in,
// so tests/notifyCore.test.mjs can run it in Node without Supabase, a push service, or a mail provider.
// The text below is English only. It mirrors strings.js (a Deno function cannot import it); change both together.

export const TITLE = 'CivicPulse';
export const MESSAGES = {
  verified: 'Neighbours confirmed a report you follow, so it is now verified.',
  sent: 'A report you follow was sent to the responsible party.',
  in_progress: 'Work has started on a report you follow.',
  resolved: 'A report you follow was marked resolved.',
  rejected: 'A report you follow was closed by a moderator.',
};

const GONE = new Set([404, 410]); // the browser removed the subscription: stop sending to it

// event: the Database Webhook body { type, table, record }
// deps: { db, siteUrl, sendPush?, sendEmail? }. Leave sendPush or sendEmail out and that channel is skipped.
export async function handleEvent(event, deps) {
  const { type, table, record } = event ?? {};
  if (table === 'notifications' && type === 'INSERT') return deliver(record, deps);
  if (table === 'notification_contacts' && (type === 'INSERT' || type === 'UPDATE')) return askToConfirm(record, deps);
  return { ignored: true };
}

async function deliver(record, { db, siteUrl, sendPush, sendEmail }) {
  const message = MESSAGES[record?.to_status];
  if (!message || !record.user_id || !record.issue_id) return { ignored: true };
  const url = `/issues/${record.issue_id}`;
  const result = { pushed: 0, removed: 0, emailed: 0, failed: 0 };

  if (sendPush) {
    const payload = JSON.stringify({ title: TITLE, body: message, url, tag: `issue-${record.issue_id}` });
    for (const sub of await db.pushSubscriptions(record.user_id)) {
      try {
        await sendPush(sub, payload);
        result.pushed++;
      } catch (err) {
        if (GONE.has(err?.statusCode)) { await db.deletePushSubscription(sub.endpoint); result.removed++; }
        else result.failed++;
      }
    }
  }

  if (sendEmail) {
    const contact = await db.contact(record.user_id);
    if (contact?.verified_at) {
      const stop = `${siteUrl}/unsubscribe?t=${contact.unsubscribe_token}`;
      try {
        await sendEmail({
          to: contact.email,
          subject: `${TITLE}: update on a report you follow`,
          text: [
            message, '',
            `See it here: ${siteUrl}${url}`, '',
            'You get this email because you asked CivicPulse for updates.',
            `Stop these emails: ${stop}`,
          ].join('\n'),
          headers: { 'List-Unsubscribe': `<${stop}>` },
        });
        result.emailed++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}

// Nothing is sent to an address until its owner opens the link in this email.
async function askToConfirm(record, { siteUrl, sendEmail }) {
  if (!sendEmail || !record?.email || !record.verify_token || record.verified_at) return { ignored: true };
  try {
    await sendEmail({
      to: record.email,
      subject: `${TITLE}: confirm your email`,
      text: [
        'Someone, hopefully you, asked CivicPulse to email updates about reports they follow to this address.', '',
        `Confirm: ${siteUrl}/confirm-email?t=${record.verify_token}`, '',
        'If this was not you, ignore this email. Nothing will be sent until you confirm.',
      ].join('\n'),
    });
    return { verificationSent: true };
  } catch {
    return { verificationSent: false, failed: 1 };
  }
}
